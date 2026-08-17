// Reconciles internal derived sources with the canonical ID they originated from.
// This only updates source_records matching metadata, never restaurants.
import 'dotenv/config'
import { supabase } from './lib/supabase.js'

const EXECUTE = process.argv.includes('--execute')
const ALLOWED = new Set(['official_website', 'official_website_deep', 'official_menus'])
const requested = process.argv.find(arg => arg.startsWith('--source='))?.split('=').slice(1).join('=')
if (!requested || !ALLOWED.has(requested)) {
  throw new Error(`--source requis parmi: ${[...ALLOWED].join(', ')}`)
}
function payload(value) { try { return typeof value === 'string' ? JSON.parse(value) : value || {} } catch { return {} } }
async function fetchAll(build, size = 1000) {
  const rows = []
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < size) break
  }
  return rows
}

const rows = await fetchAll(() => supabase.from('source_records')
  .select('id,source_id,matched_restaurant_id,match_method,payload')
  .eq('source', requested))
const candidates = rows.map(row => ({ ...row, canonicalId: payload(row.payload).canonical_restaurant_id }))
  .filter(row => row.canonicalId)
const ids = [...new Set(candidates.map(row => row.canonicalId))]
const valid = new Set()
for (let i = 0; i < ids.length; i += 150) {
  const { data, error } = await supabase.from('restaurants').select('id').in('id', ids.slice(i, i + 150))
  if (error) throw new Error(error.message)
  for (const row of data || []) valid.add(row.id)
}
const updates = candidates.filter(row => valid.has(row.canonicalId) &&
  (row.matched_restaurant_id !== row.canonicalId || row.match_method !== 'canonical_origin'))
const mismatches = updates.filter(row => row.matched_restaurant_id && row.matched_restaurant_id !== row.canonicalId)

console.log(JSON.stringify({ mode: EXECUTE ? 'execute' : 'dry-run', source: requested,
  source_records: rows.length, canonical_ids: ids.length, valid_ids: valid.size,
  updates: updates.length, previous_mismatches: mismatches.length }))

if (EXECUTE) {
  for (const row of updates) {
    const { error } = await supabase.from('source_records').update({
      matched_restaurant_id: row.canonicalId,
      match_confidence: 1,
      match_method: 'canonical_origin',
      processed_at: new Date().toISOString(),
    }).eq('id', row.id)
    if (error) throw new Error(`${row.id}: ${error.message}`)
  }
  console.log(`${updates.length} matches dérivés réconciliés.`)
}
