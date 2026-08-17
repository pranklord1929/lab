// Detect restaurant duplicate candidates and field divergences.
// This script never executes merges. It writes data/exports/dedupe_plan.json.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { supabase } from './lib/supabase.js'
import { normalizeName, normalizePhoneMx, normalizeUrl, hostFromUrl, distanceMeters, nameSimilarity } from './lib/normalize.js'

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=')
    return [k, v ?? true]
  })
)

const CAP_PER_RULE = Number(args['cap-per-rule'] || 2000)
const INSERT_CANDIDATES = args.insert !== 'false'
const RUN_ID = new Date().toISOString()
const OUT_DIR = resolve('data/exports')
const OUT_FILE = resolve(OUT_DIR, 'dedupe_plan.json')

const RESTAURANT_COLUMNS = [
  'id',
  'denue_id',
  'nombre',
  'razon_social',
  'codigo_scian',
  'actividad',
  'estrato',
  'telefono',
  'correo_electronico',
  'sitio_web',
  'instagram',
  'facebook',
  'tipo_vialidad',
  'nom_vialidad',
  'numero_exterior',
  'numero_interior',
  'colonia',
  'alcaldia',
  'cp',
  'latitud',
  'longitud',
  'osm_id',
  'cuisine_type',
  'horaires',
  'google_place_id',
  'verified_open',
  'verified_at',
  'categorie',
  'gamme_prix',
  'statut',
  'prospect_statut',
  'contact_nom',
  'contact_poste',
  'derniere_contact',
  'notes',
  'created_at',
  'updated_at',
]

const PRICE_MAPPING = {
  legacy: {
    bas: 'bas',
    moyen: 'moyen',
    haut: 'haut',
    luxe: 'luxe',
  },
  google: {
    PRICE_LEVEL_FREE: 'bas',
    PRICE_LEVEL_INEXPENSIVE: 'bas',
    PRICE_LEVEL_MODERATE: 'moyen',
    PRICE_LEVEL_EXPENSIVE: 'haut',
    PRICE_LEVEL_VERY_EXPENSIVE: 'luxe',
  },
  numeric_1_to_4: {
    1: 'bas',
    2: 'moyen',
    3: 'haut',
    4: 'luxe',
  },
  dollar: {
    '$': 'bas',
    '$$': 'moyen',
    '$$$': 'haut',
    '$$$$': 'luxe',
  },
}

function cleanText(value) {
  if (value == null) return null
  const s = String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s || null
}

function normalizedAddressKey(r) {
  const cp = cleanText(r.cp)
  const normalizedCp = cp ? cp.replace(/\D/g, '').padStart(5, '0') : null
  const parts = [normalizedCp, r.tipo_vialidad, r.nom_vialidad, r.numero_exterior]
    .map(cleanText)
    .filter(Boolean)
  return parts.length >= 3 ? parts.join('|') : null
}

function asNumber(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function hasCoords(r) {
  return asNumber(r.latitud) != null && asNumber(r.longitud) != null
}

function richnessScore(r) {
  return RESTAURANT_COLUMNS
    .filter(k => !['id', 'created_at', 'updated_at'].includes(k))
    .reduce((score, k) => {
      const value = r[k]
      if (value == null) return score
      if (typeof value === 'string' && value.trim() === '') return score
      return score + 1
    }, 0)
}

function chooseMaster(a, b) {
  const aScore = a._richness
  const bScore = b._richness
  if (aScore !== bScore) return aScore > bScore ? [a, b] : [b, a]
  if ((a.created_at || '') !== (b.created_at || '')) return (a.created_at || '') < (b.created_at || '') ? [a, b] : [b, a]
  return a.id < b.id ? [a, b] : [b, a]
}

function pairKey(a, b, rule) {
  return `${rule}:${[a.id, b.id].sort().join(':')}`
}

function groupBy(rows, keyFn) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    if (!key) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return groups
}

function toCandidate(rule, a, b, details) {
  const [master, duplicate] = chooseMaster(a, b)
  return {
    master_id: master.id,
    duplicate_id: duplicate.id,
    rule,
    name_similarity: details.name_similarity ?? nameSimilarity(a.nombre, b.nombre),
    distance_meters: details.distance_meters ?? null,
    confidence: details.confidence,
    payload: {
      run_id: RUN_ID,
      rule,
      master: {
        id: master.id,
        nombre: master.nombre,
        denue_id: master.denue_id,
        richness: master._richness,
      },
      duplicate: {
        id: duplicate.id,
        nombre: duplicate.nombre,
        denue_id: duplicate.denue_id,
        richness: duplicate._richness,
      },
      evidence: details.evidence || {},
    },
  }
}

function addCandidate(bucket, seen, candidate) {
  if (bucket.length >= CAP_PER_RULE) return false
  const key = `${candidate.rule}:${candidate.master_id}:${candidate.duplicate_id}`
  if (seen.has(key)) return true
  seen.add(key)
  bucket.push(candidate)
  return true
}

async function pageAll(label, buildQuery, pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await buildQuery().range(from, to)
    if (error) throw new Error(`${label}: ${error.message}`)
    rows.push(...(data || []))
    process.stdout.write(`  ${label}: ${rows.length}\r`)
    if (!data || data.length < pageSize) break
  }
  process.stdout.write('\n')
  return rows
}

function detectDuplicates(restaurants) {
  const candidatesByRule = {
    name_coords: [],
    name_phone: [],
    name_address: [],
    same_place_id: [],
  }
  const seenByRule = {
    name_coords: new Set(),
    name_phone: new Set(),
    name_address: new Set(),
    same_place_id: new Set(),
  }
  const overflow = {
    name_coords: 0,
    name_phone: 0,
    name_address: 0,
    same_place_id: 0,
  }

  const usable = restaurants
    .map(r => ({
      ...r,
      _normName: normalizeName(r.nombre),
      _phone: normalizePhoneMx(r.telefono),
      _addressKey: normalizedAddressKey(r),
      _richness: richnessScore(r),
    }))
    .filter(r => r._normName.length >= 2)

  // R4: identical google_place_id.
  for (const group of groupBy(usable, r => r.google_place_id || null).values()) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const ok = addCandidate(candidatesByRule.same_place_id, seenByRule.same_place_id, toCandidate('same_place_id', group[i], group[j], {
          confidence: 1.0,
          evidence: { google_place_id: group[i].google_place_id },
        }))
        if (!ok) overflow.same_place_id++
      }
    }
  }

  // R3: same normalized name + same normalized address key.
  for (const group of groupBy(usable, r => r._addressKey ? `${r._normName}|${r._addressKey}` : null).values()) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const ok = addCandidate(candidatesByRule.name_address, seenByRule.name_address, toCandidate('name_address', group[i], group[j], {
          name_similarity: 1,
          confidence: 0.99,
          evidence: { normalized_name: group[i]._normName, address_key: group[i]._addressKey },
        }))
        if (!ok) overflow.name_address++
      }
    }
  }

  // R2: same normalized name + same normalized phone.
  for (const group of groupBy(usable, r => r._phone ? `${r._normName}|${r._phone}` : null).values()) {
    if (group.length < 2) continue
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const ok = addCandidate(candidatesByRule.name_phone, seenByRule.name_phone, toCandidate('name_phone', group[i], group[j], {
          name_similarity: 1,
          confidence: 0.98,
          evidence: { normalized_name: group[i]._normName, phone: group[i]._phone },
        }))
        if (!ok) overflow.name_phone++
      }
    }
  }

  // R1: same normalized name + distance < 50m. Grid keeps large name groups cheap.
  for (const group of groupBy(usable.filter(hasCoords), r => r._normName).values()) {
    if (group.length < 2) continue
    const grid = new Map()
    for (const r of group) {
      const lat = asNumber(r.latitud)
      const lng = asNumber(r.longitud)
      const gx = Math.floor(lat / 0.0005)
      const gy = Math.floor(lng / 0.0005)
      const key = `${gx}:${gy}`
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key).push(r)
    }

    for (const r of group) {
      const lat = asNumber(r.latitud)
      const lng = asNumber(r.longitud)
      const gx = Math.floor(lat / 0.0005)
      const gy = Math.floor(lng / 0.0005)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const other of grid.get(`${gx + dx}:${gy + dy}`) || []) {
            if (r.id >= other.id) continue
            const dist = distanceMeters(lat, lng, asNumber(other.latitud), asNumber(other.longitud))
            if (dist >= 50) continue
            const ok = addCandidate(candidatesByRule.name_coords, seenByRule.name_coords, toCandidate('name_coords', r, other, {
              name_similarity: 1,
              distance_meters: Number(dist.toFixed(2)),
              confidence: 0.95,
              evidence: { normalized_name: r._normName, distance_meters: Number(dist.toFixed(2)) },
            }))
            if (!ok) overflow.name_coords++
          }
        }
      }
    }
  }

  return { candidatesByRule, overflow }
}

function latestByRestaurant(records, source) {
  const map = new Map()
  for (const r of records.filter(r => r.source === source && r.matched_restaurant_id)) {
    const prev = map.get(r.matched_restaurant_id)
    const stamp = `${r.scrape_date || ''}T${r.scraped_at || ''}`
    const prevStamp = prev ? `${prev.scrape_date || ''}T${prev.scraped_at || ''}` : ''
    if (!prev || stamp > prevStamp) map.set(r.matched_restaurant_id, r)
  }
  return map
}

function valueOrNull(value) {
  if (value == null) return null
  if (typeof value === 'string' && value.trim() === '') return null
  return value
}

function normalizeDollar(value) {
  if (value == null) return null
  if (typeof value === 'object') {
    if (value.priceBandId != null) return PRICE_MAPPING.numeric_1_to_4[value.priceBandId] || null
    if (value.tier != null) return PRICE_MAPPING.numeric_1_to_4[value.tier] || null
    return null
  }
  const raw = String(value).trim()
  if (!raw) return null
  if (PRICE_MAPPING.dollar[raw]) return PRICE_MAPPING.dollar[raw]
  const n = Number(raw)
  if (Number.isFinite(n)) return PRICE_MAPPING.numeric_1_to_4[n] || null
  return PRICE_MAPPING.legacy[raw.toLowerCase()] || null
}

function canonicalPrice(source, value) {
  if (value == null) return null
  if (source === 'legacy') return PRICE_MAPPING.legacy[String(value).toLowerCase()] || null
  if (source === 'google') return PRICE_MAPPING.google[String(value)] || null
  return normalizeDollar(value)
}

function normalizeHours(value) {
  if (value == null) return null
  const text = Array.isArray(value) ? value.join(' | ') : String(value)
  return cleanText(text)?.replace(/\b(de|a|hrs|horas)\b/g, ' ').replace(/\s+/g, ' ').trim() || null
}

function normalizedHost(value) {
  const url = normalizeUrl(value)
  return url ? hostFromUrl(url) : null
}

function uniqueNonNull(values) {
  return [...new Set(values.filter(Boolean))]
}

function priceBandFromOpenTable(payload) {
  return payload?.priceBandId
    ?? payload?.priceBand?.priceBandId
    ?? payload?.raw?.priceBand?.priceBandId
    ?? payload?.raw?.priceBand
    ?? payload?.priceBand
}

function extractDivergenceRows(restaurants, sourceRecords) {
  const google = latestByRestaurant(sourceRecords, 'google_places')
  const fsq = latestByRestaurant(sourceRecords, 'foursquare')
  const ot = latestByRestaurant(sourceRecords, 'opentable')
  const rows = []

  for (const r of restaurants) {
    const g = google.get(r.id)?.payload || null
    const f = fsq.get(r.id)?.payload || null
    const o = ot.get(r.id)?.payload || null
    if (!g && !f && !o) continue

    const prices = {
      legacy_gamme: valueOrNull(r.gamme_prix),
      google_price: valueOrNull(g?.priceLevel),
      fsq_price: valueOrNull(f?.price ?? f?.price_tier),
      ot_price: valueOrNull(priceBandFromOpenTable(o)),
    }
    const canonicalPrices = {
      legacy_gamme: canonicalPrice('legacy', prices.legacy_gamme),
      google_price: canonicalPrice('google', prices.google_price),
      fsq_price: canonicalPrice('foursquare', prices.fsq_price),
      ot_price: canonicalPrice('opentable', prices.ot_price),
    }

    const hours = {
      legacy_horaires: valueOrNull(r.horaires),
      google_hours: valueOrNull(g?.regularOpeningHours?.weekdayDescriptions),
      fsq_hours: valueOrNull(f?.hours?.display ?? f?.hours),
      ot_hours: valueOrNull(o?.hours ?? o?.raw?.hours),
    }

    const websites = {
      legacy_website: valueOrNull(r.sitio_web),
      google_website: valueOrNull(g?.websiteUri),
      fsq_website: valueOrNull(f?.website ?? f?.url),
      ot_website: valueOrNull(o?.profileLink ?? o?.raw?.profileLink),
    }

    const phones = {
      legacy_phone: valueOrNull(r.telefono),
      google_phone: valueOrNull(g?.internationalPhoneNumber ?? g?.nationalPhoneNumber),
      fsq_phone: valueOrNull(f?.tel ?? f?.contact?.phone),
      ot_phone: valueOrNull(o?.phone ?? o?.raw?.phone),
    }

    const divergentFields = []
    if (uniqueNonNull(Object.values(canonicalPrices)).length > 1) divergentFields.push('price')
    if (uniqueNonNull(Object.values(hours).map(normalizeHours)).length > 1) divergentFields.push('hours')
    if (uniqueNonNull(Object.values(websites).map(normalizedHost)).length > 1) divergentFields.push('website')
    if (uniqueNonNull(Object.values(phones).map(normalizePhoneMx)).length > 1) divergentFields.push('phone')

    if (divergentFields.length === 0) continue
    rows.push({
      id: r.id,
      nombre: r.nombre,
      divergent_fields: divergentFields,
      raw: { prices, hours, websites, phones },
      canonical: {
        prices: canonicalPrices,
        hours: Object.fromEntries(Object.entries(hours).map(([k, v]) => [k, normalizeHours(v)])),
        websites: Object.fromEntries(Object.entries(websites).map(([k, v]) => [k, normalizedHost(v)])),
        phones: Object.fromEntries(Object.entries(phones).map(([k, v]) => [k, normalizePhoneMx(v)])),
      },
    })
  }

  return rows.sort((a, b) => b.divergent_fields.length - a.divergent_fields.length || a.nombre.localeCompare(b.nombre))
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function mergeSql(candidate) {
  const master = sqlLiteral(candidate.master_id)
  const dup = sqlLiteral(candidate.duplicate_id)
  return [
    'BEGIN;',
    `UPDATE restaurant_links SET restaurant_id = ${master} WHERE restaurant_id = ${dup};`,
    `UPDATE source_records SET matched_restaurant_id = ${master} WHERE matched_restaurant_id = ${dup};`,
    `UPDATE restaurant_identities SET restaurant_id = ${master} WHERE restaurant_id = ${dup};`,
    `UPDATE menu_documents SET restaurant_id = ${master} WHERE restaurant_id = ${dup};`,
    `UPDATE menu_items SET restaurant_id = ${master} WHERE restaurant_id = ${dup};`,
    `DELETE FROM restaurants WHERE id = ${dup};`,
    'COMMIT;',
  ].join('\n')
}

function consolidateForPlan(candidatesByRule) {
  const byPair = new Map()
  const priority = { same_place_id: 4, name_address: 3, name_phone: 2, name_coords: 1 }
  for (const [rule, candidates] of Object.entries(candidatesByRule)) {
    for (const candidate of candidates) {
      const key = `${candidate.master_id}:${candidate.duplicate_id}`
      const existing = byPair.get(key)
      const payloadRule = {
        rule,
        confidence: candidate.confidence,
        name_similarity: candidate.name_similarity,
        distance_meters: candidate.distance_meters,
        evidence: candidate.payload.evidence,
      }
      if (!existing) {
        byPair.set(key, { ...candidate, rules: [payloadRule] })
        continue
      }
      existing.rules.push(payloadRule)
      if (priority[rule] > priority[existing.rule] || candidate.confidence > existing.confidence) {
        existing.rule = rule
        existing.confidence = candidate.confidence
        existing.name_similarity = candidate.name_similarity
        existing.distance_meters = candidate.distance_meters
      }
    }
  }

  const rows = [...byPair.values()]
    .map(c => ({ ...c, sql: mergeSql(c) }))
    .sort((a, b) => b.confidence - a.confidence || a.rule.localeCompare(b.rule))

  return {
    auto: rows.filter(c => c.rules.some(r => r.rule === 'same_place_id' || r.rule === 'name_address')),
    manual: rows.filter(c => !c.rules.some(r => r.rule === 'same_place_id' || r.rule === 'name_address')),
  }
}

async function insertCandidatesIfPossible(consolidatedRows) {
  if (!INSERT_CANDIDATES) return { attempted: false, inserted: 0, skipped: 0, error: null }

  const { error: existsError } = await supabase
    .from('restaurant_duplicate_candidates')
    .select('id')
    .limit(1)

  if (existsError) {
    return { attempted: true, inserted: 0, skipped: 0, error: existsError.message }
  }

  const all = consolidatedRows.map(row => ({
    master_id: row.master_id,
    duplicate_id: row.duplicate_id,
    rule: row.rule,
    name_similarity: row.name_similarity,
    distance_meters: row.distance_meters,
    confidence: row.confidence,
    payload: {
      ...row.payload,
      rules: row.rules,
    },
  }))
  if (all.length === 0) return { attempted: true, inserted: 0, skipped: 0, error: null }

  const { data: existing, error: existingError } = await supabase
    .from('restaurant_duplicate_candidates')
    .select('master_id, duplicate_id, rule')
    .is('resolved_at', null)

  if (existingError) return { attempted: true, inserted: 0, skipped: 0, error: existingError.message }

  const existingKeys = new Set((existing || []).map(r => `${r.master_id}:${r.duplicate_id}`))
  const rows = all.filter(r => !existingKeys.has(`${r.master_id}:${r.duplicate_id}`))
  if (rows.length === 0) return { attempted: true, inserted: 0, skipped: all.length, error: null }

  let inserted = 0
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200)
    const { error } = await supabase.from('restaurant_duplicate_candidates').insert(slice)
    if (error) return { attempted: true, inserted, skipped: all.length - inserted, error: error.message }
    inserted += slice.length
  }
  return { attempted: true, inserted, skipped: all.length - inserted, error: null }
}

async function logEvent(status, pct, records, notes, blocker = null) {
  const { error } = await supabase.from('pipeline_events').insert({
    agent_name: 'codex-dedupe',
    terminal: 'T4',
    status,
    task: 'dedupe + field divergence audit',
    blocker,
    pct,
    records,
    notes,
  })
  if (error) console.warn(`[pipeline_events] ${error.message}`)
}

async function main() {
  console.log('Fetch restaurants...')
  const restaurants = await pageAll('restaurants', () => supabase
    .from('restaurants')
    .select(RESTAURANT_COLUMNS.join(','))
    .order('id', { ascending: true }))

  console.log('Detect duplicate candidates...')
  const { candidatesByRule, overflow } = detectDuplicates(restaurants)
  const ruleStats = Object.fromEntries(Object.entries(candidatesByRule).map(([rule, rows]) => [rule, rows.length]))
  const totalCandidates = Object.values(ruleStats).reduce((sum, n) => sum + n, 0)

  console.log('Fetch source_records for divergence audit...')
  const sourceRecords = await pageAll('source_records', () => supabase
    .from('source_records')
    .select('matched_restaurant_id, source, scrape_date, scraped_at, payload, name')
    .in('source', ['google_places', 'foursquare', 'opentable'])
    .not('matched_restaurant_id', 'is', null)
    .order('scrape_date', { ascending: false }))

  console.log('Compute field divergence...')
  const divergenceRows = extractDivergenceRows(restaurants, sourceRecords)
  const divergenceTop20 = divergenceRows.slice(0, 20)

  const plan = consolidateForPlan(candidatesByRule)

  console.log('Try quarantine insert...')
  await logEvent(
    'working',
    75,
    0,
    `Inserting consolidated duplicate candidates: auto=${plan.auto.length}, manual=${plan.manual.length}`,
  )
  const quarantine = await insertCandidatesIfPossible([...plan.auto, ...plan.manual])
  const output = {
    generated_at: RUN_ID,
    cap_per_rule: CAP_PER_RULE,
    ddl_status: quarantine.error
      ? 'not_applied_or_not_visible_via_rest; apply schema.sql DDL for restaurant_duplicate_candidates and restaurant_field_divergence'
      : 'quarantine_table_visible',
    duplicate_candidate_stats: {
      by_rule: ruleStats,
      total_rule_rows: totalCandidates,
      overflow,
      quarantine,
      consolidated_pairs: {
        auto_applicable: plan.auto.length,
        manual_review: plan.manual.length,
      },
    },
    field_divergence_stats: {
      enriched_restaurants_checked: new Set(sourceRecords.map(r => r.matched_restaurant_id)).size,
      divergent_restaurants: divergenceRows.length,
      top20: divergenceTop20,
    },
    canonical_mapping_proposal: {
      price: {
        target: 'restaurants.gamme_prix',
        allowed_values: ['bas', 'moyen', 'haut', 'luxe'],
        mapping: PRICE_MAPPING,
      },
      hours: {
        target: 'structured JSONB column recommended, e.g. restaurants.opening_hours',
        precedence: ['google_places.regularOpeningHours', 'canonical legacy horaires as fallback'],
      },
      website: {
        target: 'restaurant_links official_site as source of truth; restaurants.sitio_web as denormalized primary URL',
        precedence: ['verified restaurant_links official_site', 'google_places.websiteUri', 'legacy sitio_web', 'foursquare/opentable profile only as non-official link'],
      },
      phone: {
        target: 'restaurants.telefono normalized E.164',
        precedence: ['google_places.internationalPhoneNumber', 'google_places.nationalPhoneNumber normalized MX', 'legacy telefono', 'source payload phones'],
      },
    },
    merges_to_validate_manually: plan.manual,
    merges_auto_applicable_after_manual_sanity_check: plan.auto,
  }

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(output, null, 2))

  console.log('\nDuplicate candidates by rule:')
  for (const [rule, count] of Object.entries(ruleStats)) console.log(`  ${rule}: ${count}`)
  console.log(`Plan written: ${OUT_FILE}`)
  console.log(`Manual review pairs: ${plan.manual.length}`)
  console.log(`Auto-applicable pairs: ${plan.auto.length}`)
  console.log(`Divergent enriched restaurants: ${divergenceRows.length}`)
  console.log(`Quarantine: ${quarantine.error ? quarantine.error : `${quarantine.inserted} inserted, ${quarantine.skipped} skipped`}`)

  const top10Pairs = [...plan.auto, ...plan.manual]
    .slice()
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .map(r => `${r.rule}:${r.payload.master.nombre}<-${r.payload.duplicate.nombre}`)
    .join(' | ')

  await logEvent(
    'done',
    100,
    quarantine.inserted,
    `Inserted ${quarantine.inserted} duplicate candidates; skipped=${quarantine.skipped}; rule_rows=${totalCandidates}; plan auto=${plan.auto.length}, manual=${plan.manual.length}; top10=${top10Pairs}; divergence=${divergenceRows.length}; quarantine=${quarantine.error || 'ok'}`,
  )
}

main().catch(async e => {
  console.error(e)
  await logEvent('blocked', 100, 0, 'dedupe audit failed', e.message)
  process.exit(1)
})
