// Rematche la source historique INVEA (suspensions COVID 2020-2021).
//
// IMPORTANT : un match INVEA est un signal historique de conformité.
// Il ne faut PAS en déduire que le restaurant est fermé aujourd'hui.
//
// Usage :
//   node scripts/match_invea.js          # dry-run, aucune écriture
//   node scripts/match_invea.js --apply  # écrit les matches haute confiance

import 'dotenv/config'
import { supabase } from './lib/supabase.js'
import { persistIdentity } from './lib/match.js'
import { normalizeName } from './lib/normalize.js'

const APPLY = process.argv.includes('--apply')
const SOURCE = 'cdmx_invea_suspendidos'

const ALCALDIAS = new Map([
  ['alvaro obregon', 'Álvaro Obregón'],
  ['azcapotzalco', 'Azcapotzalco'],
  ['benito juarez', 'Benito Juárez'],
  ['coyoacan', 'Coyoacán'],
  ['cuajimalpa de morelos', 'Cuajimalpa de Morelos'],
  ['cuauhtemoc', 'Cuauhtémoc'],
  ['gustavo a madero', 'Gustavo A. Madero'],
  ['iztacalco', 'Iztacalco'],
  ['iztapalapa', 'Iztapalapa'],
  ['la magdalena contreras', 'La Magdalena Contreras'],
  ['magdalena contreras', 'La Magdalena Contreras'],
  ['miguel hidalgo', 'Miguel Hidalgo'],
  ['milpa alta', 'Milpa Alta'],
  ['tlahuac', 'Tláhuac'],
  ['tlalpan', 'Tlalpan'],
  ['venustiano carranza', 'Venustiano Carranza'],
  ['xochimilco', 'Xochimilco'],
])

function fold(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

function canonicalAlcaldia(value) {
  return ALCALDIAS.get(fold(value)) || null
}

function isFoodBusiness(giro) {
  const g = fold(giro)
  return [
    'restaurant', 'bar', 'cantina', 'taquer', 'pulquer',
    'venta de alimentos', 'bebidas alcohol', 'al copeo',
    'cerveza en envase abierto', 'club privado', 'billar',
  ].some(term => g.includes(term))
}

const GENERIC_NAMES = new Set([
  'taqueria', 'restaurante', 'restaurant', 'bar', 'cantina', 'terraza',
  'cafeteria', 'fonda', 'antojitos', 'cocina', 'club', 'billar', 'pulqueria',
])

async function loadRestaurantIndex() {
  const index = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('restaurants')
      .select('id, nombre, alcaldia')
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const row of data || []) {
      const alcaldia = canonicalAlcaldia(row.alcaldia)
      const name = normalizeName(row.nombre)
      if (!alcaldia || !name) continue
      const key = `${alcaldia}::${name}`
      if (!index.has(key)) index.set(key, [])
      index.get(key).push(row)
    }
    if (!data || data.length < 1000) break
  }
  return index
}

async function fetchRows() {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('source_records')
      .select('id, source_id, name, payload, matched_restaurant_id, match_method')
      .eq('source', SOURCE)
      .range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`)
  const rows = await fetchRows()
  const relevant = rows.filter(row => isFoodBusiness(row.payload?.giro))
  const irrelevant = rows.filter(row => !isFoodBusiness(row.payload?.giro))
  console.log(`INVEA total: ${rows.length}`)
  console.log(`Food/beverage: ${relevant.length}`)
  console.log(`Hors restauration: ${irrelevant.length}`)

  console.log('Chargement index canonique…')
  const restaurantIndex = await loadRestaurantIndex()
  const stats = { exact_unique: 0, ambiguous: 0, generic: 0, no_match: 0 }
  const accepted = []
  for (let i = 0; i < relevant.length; i++) {
    const row = relevant[i]
    const alcaldia = canonicalAlcaldia(row.payload?.alcaldia)
    const normalized = normalizeName(row.name)
    if (!alcaldia || !normalized || GENERIC_NAMES.has(normalized)) {
      stats.generic++
      continue
    }
    const candidates = restaurantIndex.get(`${alcaldia}::${normalized}`) || []
    if (candidates.length === 1) {
      const candidate = candidates[0]
      const match = {
        restaurantId: candidate.id,
        method: 'exact_name_alcaldia_unique',
        confidence: 0.95,
      }
      accepted.push({ row, match, alcaldia, candidate })
      stats.exact_unique++
    } else if (candidates.length > 1) {
      stats.ambiguous++
    } else {
      stats.no_match++
    }
    if ((i + 1) % 50 === 0) process.stdout.write(`  ${i + 1}/${relevant.length}\r`)
  }
  process.stdout.write('\n')

  console.log('Stats:', stats)
  console.log(`Matches acceptés: ${accepted.length}/${relevant.length}`)

  if (!APPLY) {
    for (const { row, match, alcaldia, candidate } of accepted.slice(0, 30)) {
      console.log(`  ${row.name} [${alcaldia}] -> ${candidate?.nombre || match.restaurantId} (${match.method}, ${match.confidence})`)
    }
    console.log('\nDry-run uniquement. Relancer avec --apply après revue.')
    return
  }

  const now = new Date().toISOString()
  let written = 0
  for (const { row, match } of accepted) {
    const { error } = await supabase.from('source_records').update({
      matched_restaurant_id: match.restaurantId,
      match_method: match.method,
      match_confidence: match.confidence,
      processed_at: now,
    }).eq('id', row.id)
    if (error) { console.warn(`${row.name}: ${error.message}`); continue }

    await persistIdentity({
      restaurantId: match.restaurantId,
      source: SOURCE,
      sourceId: row.source_id,
      sourceUrl: row.payload?.wayback_url || null,
      confidence: match.confidence,
      method: match.method,
    })
    written++
  }

  // Les autres lignes restent dans staging mais sont explicitement hors scope.
  for (let i = 0; i < irrelevant.length; i += 200) {
    const ids = irrelevant.slice(i, i + 200).map(row => row.id)
    const { error } = await supabase.from('source_records').update({
      match_method: 'not_applicable_non_food',
      match_confidence: null,
      matched_restaurant_id: null,
      processed_at: now,
    }).in('id', ids)
    if (error) console.warn(`non-food batch: ${error.message}`)
  }

  console.log(`Écrits: ${written} matches; ${irrelevant.length} lignes hors restauration classées.`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
