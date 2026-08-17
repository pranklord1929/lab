// Generic raw JSON -> local SQLite staging + conservative entity resolution.
// Never contacts Supabase and never creates canonical restaurants automatically.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { distanceMeters, nameSimilarity, normalizeName, normalizePhoneMx, normalizeUrl } from './lib/normalize.js'

const args = Object.fromEntries(process.argv.slice(2).filter(v => v.startsWith('--')).map(v => {
  const [key, value] = v.slice(2).split('='); return [key, value ?? true]
}))
if (!args.source || !args.date) {
  console.error('Usage: node scripts/ingest_local.js --source=<source> --date=YYYY-MM-DD [--file=...] [--dry]')
  process.exit(1)
}

const source = String(args.source)
const date = String(args.date)
const file = resolve(String(args.file || `data/raw/${source}/${date}.json`))
const dry = Boolean(args.dry)
const refresh = Boolean(args.refresh)
const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()
const records = JSON.parse(readFileSync(file, 'utf8'))
if (!Array.isArray(records)) throw new Error('Le raw doit être un tableau JSON')

const restaurants = db.prepare('SELECT id,nombre,latitud,longitud FROM restaurants').all()
const exactNames = new Map()
for (const row of restaurants) {
  const key = normalizeName(row.nombre)
  if (!key) continue
  if (!exactNames.has(key)) exactNames.set(key, [])
  exactNames.get(key).push(row)
}
const identity = db.prepare('SELECT restaurant_id,confidence FROM restaurant_identities WHERE source=? AND source_id=? ORDER BY confidence DESC LIMIT 1')
const nearby = db.prepare(`SELECT id,nombre,latitud,longitud FROM restaurants WHERE latitud BETWEEN ? AND ? AND longitud BETWEEN ? AND ?`)

function match(record) {
  const known = identity.get(source, String(record.source_id))
  if (known) return { restaurantId: known.restaurant_id, confidence: known.confidence || 1, method: 'identity' }
  const name = normalizeName(record.name)
  const lat = Number(record.latitude), lon = Number(record.longitude)
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon)
  const same = exactNames.get(name) || []
  if (same.length) {
    if (hasCoords) {
      const ranked = same.map(row => ({ row, distance: distanceMeters(lat, lon, row.latitud, row.longitud) })).sort((a, b) => a.distance - b.distance)
      if (ranked[0]?.distance <= 500) return { restaurantId: ranked[0].row.id, confidence: 0.99, method: 'coords_name' }
    }
    if (same.length === 1 && name.length >= 7) return { restaurantId: same[0].id, confidence: 0.92, method: 'name_only_high_conf' }
  }
  if (hasCoords && name.length >= 4) {
    const candidates = nearby.all(lat - 0.003, lat + 0.003, lon - 0.003, lon + 0.003)
      .map(row => ({ row, similarity: nameSimilarity(name, row.nombre), distance: distanceMeters(lat, lon, row.latitud, row.longitud) }))
      .filter(v => v.distance <= 200 && v.similarity >= 0.72)
      .sort((a, b) => b.similarity - a.similarity || a.distance - b.distance)
    if (candidates[0]) return { restaurantId: candidates[0].row.id, confidence: 0.9, method: 'coords_name_fuzzy' }
  }
  return { restaurantId: null, confidence: 0, method: 'new_insert' }
}

const existing = db.prepare('SELECT id FROM source_records WHERE source=? AND source_id=? AND scrape_date=?')
const refreshRecord = db.prepare(`UPDATE source_records SET
  scraped_at=?,name=?,latitude=?,longitude=?,address=?,phone=?,website=?,payload=? WHERE id=?`)
const insertRecord = db.prepare(`INSERT INTO source_records
  (id,source,source_id,scrape_date,scraped_at,name,latitude,longitude,address,phone,website,payload,processed_at,matched_restaurant_id,match_confidence,match_method,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
const identityExists = db.prepare('SELECT 1 FROM restaurant_identities WHERE restaurant_id=? AND source=? AND source_id=?')
const insertIdentity = db.prepare(`INSERT INTO restaurant_identities VALUES (?,?,?,?,?,?,?,?,?,?)`)
const stats = { staged: 0, refreshed: 0, skipped: 0, identity: 0, coords_name: 0, coords_name_fuzzy: 0, name_only_high_conf: 0, new_insert: 0 }

if (!dry) db.exec('BEGIN')
try {
  for (const record of records) {
    if (record.source_id === null || record.source_id === undefined || !record.name) continue
    const sourceId = String(record.source_id)
    const current = existing.get(source, sourceId, date)
    if (current) {
      if (refresh) {
        stats.refreshed++
        if (!dry) refreshRecord.run(now, String(record.name).trim(), record.latitude ?? null, record.longitude ?? null,
          record.address ?? null, normalizePhoneMx(record.phone), normalizeUrl(record.website),
          JSON.stringify(record.payload || record), current.id)
      } else stats.skipped++
      continue
    }
    const result = match(record)
    stats[result.method]++
    stats.staged++
    if (dry) continue
    const id = randomUUID()
    insertRecord.run(id, source, sourceId, date, now, String(record.name).trim(),
      record.latitude ?? null, record.longitude ?? null, record.address ?? null,
      normalizePhoneMx(record.phone), normalizeUrl(record.website), JSON.stringify(record.payload || record),
      now, result.restaurantId, result.confidence || null, result.method, now)
    if (result.restaurantId && result.confidence >= 0.9 && !identityExists.get(result.restaurantId, source, sourceId)) {
      const url = record.payload?.url || record.payload?.source_url || record.website || null
      insertIdentity.run(randomUUID(), result.restaurantId, source, sourceId, url, result.confidence, result.method, 'local conservative matcher', now, now)
    }
  }
  if (!dry) db.exec('COMMIT')
} catch (error) {
  if (!dry) db.exec('ROLLBACK')
  throw error
}
console.log(JSON.stringify({ mode: dry ? 'dry' : 'local-write', source, date, ...stats }))
db.close()
