// Classifies high-quality unmatched candidates without mutating canonical rows.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { distanceMeters, nameSimilarity, normalizeName, normalizePhoneMx } from './lib/normalize.js'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()
const candidates = db.prepare("SELECT * FROM restaurant_candidate_pool WHERE review_status='high'").all()
const restaurants = db.prepare('SELECT id,nombre,telefono,sitio_web,latitud,longitud FROM restaurants').all()
const memberPayloads = db.prepare(`
  SELECT m.candidate_id,m.source,sr.payload
  FROM restaurant_candidate_members m JOIN source_records sr ON sr.id=m.source_record_id
`).all()
const payloadByCandidate = new Map()
for (const row of memberPayloads) {
  if (!payloadByCandidate.has(row.candidate_id)) payloadByCandidate.set(row.candidate_id, new Map())
  try { payloadByCandidate.get(row.candidate_id).set(row.source, JSON.parse(row.payload || '{}')) } catch {}
}

function num(value) { const n = Number(value); return value === null || value === '' || !Number.isFinite(n) ? null : n }
function validCoord(lat, lon) { return lat !== null && lon !== null && lat >= 19.15 && lat <= 19.65 && lon >= -99.40 && lon <= -98.90 }
function gridKey(lat, lon) { return `${Math.floor(lat / 0.003)}:${Math.floor(lon / 0.003)}` }
function phone(value) { return normalizePhoneMx(value)?.replace(/\D/g, '').slice(-10) || null }
function host(value) {
  if (!value) return null
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, '') } catch { return null }
}
function tokens(value) { return new Set((normalizeName(value) || '').split(/\s+/).filter(token => token.length > 2)) }
function tokenScore(a, b) {
  const left = tokens(a), right = tokens(b)
  if (!left.size || !right.size) return 0
  const common = [...left].filter(token => right.has(token)).length
  return common / (left.size + right.size - common)
}

const grid = new Map(), byPhone = new Map(), byHost = new Map()
for (const row of restaurants) {
  const lat = num(row.latitud), lon = num(row.longitud)
  if (validCoord(lat, lon)) {
    const key = gridKey(lat, lon)
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key).push(row)
  }
  const p = phone(row.telefono)
  if (p) { if (!byPhone.has(p)) byPhone.set(p, []); byPhone.get(p).push(row) }
  const h = host(row.sitio_web)
  if (h && !/facebook|instagram|opentable|rappi|ubereats|tripadvisor/.test(h)) {
    if (!byHost.has(h)) byHost.set(h, []); byHost.get(h).push(row)
  }
}
function nearby(lat, lon) {
  const x = Math.floor(lat / 0.003), y = Math.floor(lon / 0.003), found = []
  for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) found.push(...(grid.get(`${x+dx}:${y+dy}`) || []))
  return found
}

db.exec(`
  DROP TABLE IF EXISTS restaurant_candidate_triage;
  CREATE TABLE restaurant_candidate_triage (
    candidate_id TEXT PRIMARY KEY,
    classification TEXT NOT NULL,
    auto_promote INTEGER NOT NULL,
    nearest_restaurant_id TEXT,
    nearest_restaurant_name TEXT,
    distance_meters REAL,
    name_similarity REAL,
    token_similarity REAL,
    evidence TEXT NOT NULL,
    generated_at TEXT NOT NULL
  );
  CREATE INDEX idx_candidate_triage_class ON restaurant_candidate_triage(classification,auto_promote);
`)
const insert = db.prepare('INSERT INTO restaurant_candidate_triage VALUES (?,?,?,?,?,?,?,?,?,?)')
const stats = new Map()
db.exec('BEGIN')
try {
  for (const candidate of candidates) {
    const sourcePayload = payloadByCandidate.get(candidate.candidate_id)?.get(candidate.best_source) || {}
    const primaryCategory = sourcePayload.categories?.[0]?.name || sourcePayload.category || null
    const lat = num(candidate.latitude), lon = num(candidate.longitude)
    const hasCoords = validCoord(lat, lon)
    const ranked = hasCoords ? nearby(lat, lon).map(row => ({
      row,
      distance: distanceMeters(lat, lon, num(row.latitud), num(row.longitud)),
      name: nameSimilarity(candidate.name, row.nombre),
      token: tokenScore(candidate.name, row.nombre),
    })).filter(item => item.distance <= 300).sort((a,b) =>
      b.name-a.name || b.token-a.token || a.distance-b.distance) : []
    const nearest = ranked[0] || null
    const p = phone(candidate.phone), h = host(candidate.website)
    const phoneMatches = p ? (byPhone.get(p) || []) : []
    const hostMatches = h ? (byHost.get(h) || []) : []
    const phonePossible = phoneMatches.some(row => nameSimilarity(candidate.name,row.nombre) >= 0.45)
    const hostPossible = hostMatches.some(row => nameSimilarity(candidate.name,row.nombre) >= 0.4)
    const spatialPossible = Boolean(nearest && nearest.token >= 0.33 &&
      ((nearest.distance <= 150 && nearest.name >= 0.58) || (nearest.distance <= 80 && nearest.name >= 0.45)))
    const possibleDuplicate = phonePossible || hostPossible || spatialPossible
    const sourceTrusted = ['foursquare','restaurantguru','ubereats','wikidata','worlds50best','opentable'].includes(candidate.best_source)
    const classification = !hasCoords
      ? 'insufficient_evidence'
      : possibleDuplicate ? 'possible_duplicate'
      : sourceTrusted ? 'new_high_confidence' : 'insufficient_evidence'
    const noisyName = /distribuidora|banquetes|alquiladora|impulsora|manteles|hotel|comedor|club\s*house|city market|cremeria|proveedora|alimentos|asociaci[oó]n|^sanborns$|^wings$|\boxxo\b|restaurante liverpool|^lago algo$/i.test(candidate.name)
    const autoPromote = classification === 'new_high_confidence' && (
      (candidate.source_count >= 2 && candidate.quality_score >= 67) ||
      (candidate.best_source === 'foursquare' && candidate.quality_score >= 71 && !noisyName &&
        /Restaurant|Taquer|Taco|Pizzeria|Pizza|Bakery|Bistro|Diner|Steakhouse|Barbecue|BBQ|Burger|Breakfast|Coffee|Caf[eé]|Bar$/i.test(primaryCategory || '') &&
        !/^Restaurant$/i.test(primaryCategory || '') && (candidate.phone || candidate.website || candidate.image_count > 0)) ||
      (candidate.best_source === 'restaurantguru' && candidate.quality_score >= 73) ||
      (['wikidata','worlds50best'].includes(candidate.best_source) && candidate.quality_score >= 61)
    )
    const evidence = {
      best_source: candidate.best_source, quality_score: candidate.quality_score,
      source_count: candidate.source_count, has_coords: hasCoords,
      primary_category: primaryCategory,
      phone_matches: phoneMatches.length, host_matches: hostMatches.length,
      possible_duplicate: possibleDuplicate, noisy_name: noisyName,
    }
    insert.run(candidate.candidate_id, classification, autoPromote ? 1 : 0,
      nearest?.row.id || null, nearest?.row.nombre || null, nearest?.distance ?? null,
      nearest?.name ?? null, nearest?.token ?? null, JSON.stringify(evidence), now)
    const key = `${classification}:${autoPromote ? 'auto' : 'hold'}`
    stats.set(key, (stats.get(key) || 0) + 1)
  }
  db.exec('COMMIT')
} catch (error) { db.exec('ROLLBACK'); throw error }

console.table([...stats].map(([bucket,count]) => ({ bucket,count })).sort((a,b)=>b.count-a.count))
console.log(`${candidates.length} candidats high classifiés.`)
db.close()
