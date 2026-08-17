// Matching conservateur pour petites listes éditoriales sans GPS :
// nom normalisé exact et unique dans la base canonique.

import 'dotenv/config'
import { supabase } from './lib/supabase.js'
import { persistIdentity } from './lib/match.js'
import { normalizeName } from './lib/normalize.js'

const source = process.argv.find(arg => arg.startsWith('--source='))?.split('=')[1]
const apply = process.argv.includes('--apply')
if (!source) throw new Error('Usage: node scripts/match_named_source.js --source=<source> [--apply]')

async function all(table, select, filter) {
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

const [sourceRows, restaurants] = await Promise.all([
  all('source_records', 'id,source_id,name,payload', q => q.eq('source', source)),
  all('restaurants', 'id,nombre'),
])
const index = new Map()
for (const row of restaurants) {
  const key = normalizeName(row.nombre)
  if (!key) continue
  if (!index.has(key)) index.set(key, [])
  index.get(key).push(row)
}

const accepted = []
let ambiguous = 0
let noMatch = 0
for (const row of sourceRows) {
  const candidates = index.get(normalizeName(row.name)) || []
  if (candidates.length === 1) accepted.push({ row, restaurant: candidates[0] })
  else if (candidates.length > 1) ambiguous++
  else noMatch++
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', total: sourceRows.length, exact_unique: accepted.length, ambiguous, no_match: noMatch }, null, 2))
for (const item of accepted) console.log(`  ${item.row.name} -> ${item.restaurant.nombre}`)

if (apply) {
  const now = new Date().toISOString()
  for (const { row, restaurant } of accepted) {
    const { error } = await supabase.from('source_records').update({
      matched_restaurant_id: restaurant.id,
      match_method: 'exact_name_unique',
      match_confidence: 0.98,
      processed_at: now,
    }).eq('id', row.id)
    if (error) throw new Error(error.message)
    await persistIdentity({ restaurantId: restaurant.id, source, sourceId: row.source_id, sourceUrl: row.payload?.source_url, confidence: 0.98, method: 'exact_name_unique' })
  }
}
