// Matching conservateur CANIRAC : nom normalisé exact + code postal exact,
// et une seule ligne canonique possible. Aucun match par nom seul.

import 'dotenv/config'
import { supabase } from './lib/supabase.js'
import { persistIdentity } from './lib/match.js'
import { normalizeName } from './lib/normalize.js'

const APPLY = process.argv.includes('--apply')
const SOURCE = 'canirac_safetravels'

async function fetchAll(table, select, filter) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(select)
    if (filter) query = filter(query)
    const { data, error } = await query.range(from, from + 999)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function main() {
  const [sourceRows, restaurants] = await Promise.all([
    fetchAll('source_records', 'id,source_id,name,payload', q => q.eq('source', SOURCE)),
    fetchAll('restaurants', 'id,nombre,cp'),
  ])

  const index = new Map()
  for (const row of restaurants) {
    const name = normalizeName(row.nombre)
    const cp = String(row.cp || '').replace(/\D/g, '').padStart(5, '0')
    if (!name || cp.length !== 5) continue
    const key = `${cp}:${name}`
    if (!index.has(key)) index.set(key, [])
    index.get(key).push(row)
  }

  const accepted = []
  const stats = { exact_unique: 0, ambiguous: 0, missing_cp: 0, no_match: 0 }
  for (const row of sourceRows) {
    const name = normalizeName(row.name)
    const cp = String(row.payload?.postalCode || '').replace(/\D/g, '')
    if (!name || cp.length !== 5) { stats.missing_cp++; continue }
    const candidates = index.get(`${cp}:${name}`) || []
    if (candidates.length === 1) {
      accepted.push({ row, restaurant: candidates[0] })
      stats.exact_unique++
    } else if (candidates.length > 1) stats.ambiguous++
    else stats.no_match++
  }

  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', total: sourceRows.length, ...stats }, null, 2))
  for (const item of accepted.slice(0, 20)) {
    console.log(`  ${item.row.name} -> ${item.restaurant.nombre} [${item.restaurant.cp}]`)
  }
  if (!APPLY) return

  const now = new Date().toISOString()
  for (const { row, restaurant } of accepted) {
    const { error } = await supabase.from('source_records').update({
      matched_restaurant_id: restaurant.id,
      match_method: 'exact_name_postal_unique',
      match_confidence: 0.97,
      processed_at: now,
    }).eq('id', row.id)
    if (error) throw new Error(error.message)
    await persistIdentity({
      restaurantId: restaurant.id,
      source: SOURCE,
      sourceId: row.source_id,
      sourceUrl: row.payload?.source_url,
      confidence: 0.97,
      method: 'exact_name_postal_unique',
    })
  }
  console.log(`Matches écrits : ${accepted.length}`)
}

main().catch(error => { console.error(error); process.exit(1) })
