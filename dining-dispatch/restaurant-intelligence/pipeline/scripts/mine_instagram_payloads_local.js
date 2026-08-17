// Mines Instagram handles already present in local source payloads. No network.
// Default is audit-only; --execute inserts traceable restaurant_links only.
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { normalizeUrl, hostFromUrl } from './lib/normalize.js'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()
const execute = process.argv.includes('--execute')
const OUT_PATH = resolve('data/exports/instagram_payload_candidates.json')

function payload(value) {
  try { return value ? JSON.parse(value) : {} } catch { return {} }
}

function profile(handle) {
  if (!handle) return null
  let candidate = String(handle).trim()
  const urlMatch = candidate.match(/instagram\.com\/([A-Za-z0-9._-]{2,40})/i)
  if (urlMatch) candidate = urlMatch[1]
  candidate = candidate.replace(/^@/, '').split(/[/?#]/)[0]
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(candidate)) return null
  if (/^(p|reel|stories|explore|accounts)$/i.test(candidate)) return null
  if (/^(reservandonos|opentable|restaurantguru|foursquare|ubereats|didi(?:food)?|rappi|tripadvisor|googlemaps)$/i.test(candidate)) return null
  return `https://www.instagram.com/${candidate}/`
}

function extract(row) {
  const p = payload(row.payload)
  const direct = [
    p.social_media?.instagram, p.instagram, p.instagram_handle,
    p.websiteUri, p.website, p.url,
  ]
  for (const value of direct) {
    const result = profile(value)
    if (result) return result
  }
  const match = String(row.payload || '').match(/instagram(?:\\?"|\.com\\?\/|\/)(?:\\?"|\/)?@?([A-Za-z0-9._-]{2,40})/i)
  return profile(match?.[1])
}

const rows = db.prepare(`
  WITH missing AS (
    SELECT g.restaurant_id, g.name
    FROM restaurant_golden_record g
    JOIN restaurant_search_mv s ON s.id = g.restaurant_id
    WHERE s.is_enriched = 1 AND g.instagram IS NULL
  )
  SELECT sr.*, m.name AS restaurant_name
  FROM source_records sr JOIN missing m ON m.restaurant_id = sr.matched_restaurant_id
  ORDER BY sr.scrape_date DESC, sr.scraped_at DESC
`).all()

const found = new Map()
for (const row of rows) {
  if (found.has(row.matched_restaurant_id)) continue
  const instagram = extract(row)
  if (instagram) found.set(row.matched_restaurant_id, {
    restaurant_id: row.matched_restaurant_id,
    restaurant_name: row.restaurant_name,
    instagram,
    source: row.source,
    source_record_id: row.id,
    scrape_date: row.scrape_date,
  })
}

const exists = db.prepare('SELECT id, provider, link_type FROM restaurant_links WHERE restaurant_id = ? AND normalized_url = ? LIMIT 1')
const classify = db.prepare(`
  UPDATE restaurant_links
  SET provider = 'instagram', link_type = 'social', status = 'valid',
      confidence_score = MAX(COALESCE(confidence_score, 0), 0.9),
      source = ?, checked_at = ?, updated_at = ?
  WHERE id = ?
`)
const insert = db.prepare(`
  INSERT INTO restaurant_links
    (id,restaurant_id,url,normalized_url,host,source,link_type,provider,status,confidence_score,checked_at,created_at,updated_at)
  VALUES (?, ?, ?, ?, ?, ?, 'social', 'instagram', 'valid', 0.9, ?, ?, ?)
`)

if (execute) {
  db.exec('BEGIN')
  try {
    for (const [restaurantId, result] of found) {
      const normalized = normalizeUrl(result.instagram)
      const existing = exists.get(restaurantId, normalized)
      if (!existing) {
        insert.run(randomUUID(), restaurantId, result.instagram, normalized, hostFromUrl(result.instagram), `payload:${result.source}`, now, now, now)
      } else if (existing.provider !== 'instagram' || existing.link_type !== 'social') {
        classify.run(`payload:${result.source}`, now, now, existing.id)
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

mkdirSync(resolve('data/exports'), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify({ generated_at: now, execute, count: found.size, candidates: [...found.values()] }, null, 2))
console.log(`${found.size} Instagram trouvés dans les payloads locaux, sans réseau${execute ? ' et ajoutés à restaurant_links' : ' (dry-run)'}.`)
console.log(OUT_PATH)
db.close()
