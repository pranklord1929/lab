// Consolidates unmatched source records into a reviewable local sub-database.
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { normalizeName } from './lib/normalize.js'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()
const TRUST = {
  worlds50best: 0.99, wikidata: 0.97, opentable: 0.95, resy: 0.94,
  reservandonos: 0.93, cdmx_invea_suspendidos: 0.9, cdmx_mercados_publicos: 0.88,
  ubereats: 0.85, restaurantguru: 0.82, didifood_web: 0.8,
  foursquare: 0.78, editorial: 0.76, chilango: 0.72,
}

function json(value) { try { return value ? JSON.parse(value) : {} } catch { return {} } }
function num(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}
function fold(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
}
function clusterKey(row) {
  const name = normalizeName(row.name)
  const lat = num(row.latitude), lon = num(row.longitude)
  if (lat !== null && lon !== null) return `${name}::${lat.toFixed(3)}::${lon.toFixed(3)}`
  const postal = String(row.address || '').match(/\b\d{5}\b/)?.[0] || ''
  const address = fold(row.address).slice(0, 80)
  return `${name}::${postal}::${address}`
}
function imageCount(payload) {
  const values = [payload.gallery, payload.photos, payload.images, payload.image_url, payload.heroImage, payload.image]
  return values.reduce((sum, value) => sum + (Array.isArray(value) ? value.length : value ? 1 : 0), 0)
}
function isOutsideCdmx(lat, lon, address) {
  if (lat !== null && lon !== null && (lat < 19.15 || lat > 19.65 || lon < -99.40 || lon > -98.90)) return true
  const postalCode = String(address || '').match(/\b\d{5}\b/)?.[0]
  if (postalCode && !/^[01]/.test(postalCode)) return true
  const place = fold(address)
  return /state of mexico|estado de mexico|edo de mexico|edomex|naucalpan|tlalnepantla|tlanepantla|cuautitlan|chimalhuacan|nezahualcoyotl|\bneza\b|ecatepec|chalco|atizapan|ciudad lopez mateos|ixtapaluca|los reyes ixtacala|huixquilucan|texcoco|tecamac|bosque real|la paz|ocoyoacac|metepec/.test(place)
}
function isReferenceEntity(row) {
  if (row.source === 'cdmx_mercados_publicos') return true
  if (row.source === 'ubereats' && /circle k|decathlon|fantas[ií]as miguel|florer[ií]a|\blego\b|\bpetco\b|\bsally\b|\bsumesa\b/i.test(row.name || '')) return true
  if (/\bmercado\b|restaurante liverpool|dulceria liverpool|domino.?s superama|casino campo marte/i.test(row.name || '')) return true
  const category = row.payload?.categories?.[0]?.name || row.payload?.category || ''
  return /^(Department Store|Miscellaneous Store|Fuel Station|Hotel|Grocery Store|Gourmet Store|Office|Structure|Farmers Market|Flea Market|Garden Center|Event Space|Community Center|Bridge)$/i.test(category)
}

const rows = db.prepare(`
  SELECT * FROM source_records
  WHERE matched_restaurant_id IS NULL
    AND match_method IN ('new_insert', 'quarantined_conflict')
    AND name IS NOT NULL
  ORDER BY scrape_date DESC, scraped_at DESC
`).all()
const latest = new Map()
for (const row of rows) {
  const key = `${row.source}:${row.source_id}`
  if (!latest.has(key)) latest.set(key, { ...row, payload: json(row.payload) })
}
const groups = new Map()
for (const row of latest.values()) {
  const key = clusterKey(row)
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(row)
}

db.exec(`
  DROP TABLE IF EXISTS restaurant_candidate_members;
  DROP TABLE IF EXISTS restaurant_candidate_pool;
  CREATE TABLE restaurant_candidate_pool (
    candidate_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    latitude REAL,
    longitude REAL,
    address TEXT,
    phone TEXT,
    website TEXT,
    rating REAL,
    price_level TEXT,
    image_count INTEGER NOT NULL,
    best_source TEXT NOT NULL,
    source_count INTEGER NOT NULL,
    sources TEXT NOT NULL,
    quality_score INTEGER NOT NULL,
    review_status TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );
  CREATE TABLE restaurant_candidate_members (
    candidate_id TEXT NOT NULL,
    source_record_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    trust REAL NOT NULL
  );
  CREATE INDEX idx_candidate_quality ON restaurant_candidate_pool(review_status, quality_score DESC);
`)
const insertPool = db.prepare(`INSERT INTO restaurant_candidate_pool VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
const insertMember = db.prepare(`INSERT INTO restaurant_candidate_members VALUES (?,?,?,?,?)`)

db.exec('BEGIN')
try {
  for (const [key, members] of groups) {
    members.sort((a, b) => (TRUST[b.source] || 0.5) - (TRUST[a.source] || 0.5))
    const best = members[0]
    const payload = best.payload
    const sources = [...new Set(members.map(row => row.source))]
    const trust = TRUST[best.source] || 0.5
    const lat = num(best.latitude), lon = num(best.longitude)
    const rating = num(payload.rating?.average ?? payload.rating ?? payload.score)
    const price = payload.price_range || payload.priceBand || payload.priceLevel || null
    const images = Math.max(...members.map(row => imageCount(row.payload)), 0)
    const score = Math.min(100, Math.round(trust * 50 +
      (lat !== null && lon !== null ? 12 : 0) + (best.phone ? 8 : 0) +
      (best.address ? 7 : 0) + (best.website ? 5 : 0) + (images ? 6 : 0) +
      (rating !== null ? 4 : 0) + Math.min(8, (sources.length - 1) * 4)))
    const refreshedYear = Number(String(payload.date_refreshed || '').slice(0, 4)) || null
    const category = payload.categories?.[0]?.name || payload.category || ''
    const status = isReferenceEntity(best)
      ? 'reference_entity'
      : isOutsideCdmx(lat, lon, `${best.name} ${best.address || ''}`) ? 'out_of_scope'
      : best.source === 'ubereats' && (lat === null || lon === null) ? 'review'
      : best.source === 'foursquare' && refreshedYear && refreshedYear < 2026 ? 'review'
      : best.source === 'foursquare' && /^Restaurant$/i.test(category) ? 'review'
      : score >= 75 && trust >= 0.9 ? 'ready_for_review' : score >= 58 ? 'high' : 'review'
    const candidateId = createHash('sha256').update(key).digest('hex').slice(0, 32)
    insertPool.run(candidateId, best.name, lat, lon, best.address, best.phone, best.website,
      rating, price, images, best.source, sources.length, JSON.stringify(sources), score, status, now)
    for (const member of members) insertMember.run(candidateId, member.id, member.source, member.source_id, TRUST[member.source] || 0.5)
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

const stats = db.prepare(`SELECT review_status,COUNT(*) candidates FROM restaurant_candidate_pool GROUP BY 1 ORDER BY candidates DESC`).all()
console.table(stats)
console.log(`${groups.size} candidats consolidés depuis ${latest.size} identités source.`)
db.close()
