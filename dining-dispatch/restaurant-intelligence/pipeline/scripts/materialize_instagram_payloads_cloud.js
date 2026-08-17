// Persists validated Instagram links mined from existing source payloads.
// Never touches restaurants. Default: dry-run; --execute writes restaurant_links.
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { supabase } from './lib/supabase.js'
import { normalizeUrl, hostFromUrl } from './lib/normalize.js'

const EXECUTE = process.argv.includes('--execute')
const input = JSON.parse(await readFile(resolve('data/exports/instagram_payload_candidates.json'), 'utf8'))
const candidates = Array.isArray(input.candidates) ? input.candidates : []
const now = new Date().toISOString()
function uuidFor(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32)
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`
}

const restaurantIds = [...new Set(candidates.map(row => row.restaurant_id))]
const existing = []
for (let i = 0; i < restaurantIds.length; i += 150) {
  const { data, error } = await supabase.from('restaurant_links')
    .select('id,restaurant_id,normalized_url,provider,link_type').in('restaurant_id', restaurantIds.slice(i, i + 150))
  if (error) throw new Error(error.message)
  existing.push(...(data || []))
}
const existingByKey = new Map(existing.map(row => [`${row.restaurant_id}\0${normalizeUrl(row.normalized_url)}`, row]))
const classifications = []
const rows = candidates.map(candidate => {
  const url = normalizeUrl(candidate.instagram)
  const key = `${candidate.restaurant_id}\0${url}`
  if (!url) return null
  const current = existingByKey.get(key)
  if (current) {
    if (current.provider !== 'instagram' || current.link_type !== 'social') {
      classifications.push({ id: current.id, source: `payload:${candidate.source}` })
    }
    return null
  }
  return {
    id: uuidFor(`payload-instagram\0${key}`), restaurant_id: candidate.restaurant_id,
    url, normalized_url: url, host: hostFromUrl(url), source: `payload:${candidate.source}`,
    link_type: 'social', provider: 'instagram', status: 'valid', confidence_score: 0.9,
    checked_at: now, created_at: now, updated_at: now,
  }
}).filter(Boolean)

console.log(JSON.stringify({ mode: EXECUTE ? 'execute' : 'dry-run', candidates: candidates.length,
  new_links: rows.length, reclassifications: classifications.length }))
if (EXECUTE) {
  if (rows.length) {
    const { error } = await supabase.from('restaurant_links').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw new Error(error.message)
  }
  for (const row of classifications) {
    const { error } = await supabase.from('restaurant_links').update({
      provider: 'instagram', link_type: 'social', status: 'valid',
      confidence_score: 0.9, source: row.source, checked_at: now, updated_at: now,
    }).eq('id', row.id)
    if (error) throw new Error(error.message)
  }
  console.log(`${rows.length} Instagram ajoutés, ${classifications.length} liens reclassifiés.`)
}
