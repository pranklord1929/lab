// Quarantines only manifestly wrong source→restaurant matches in local SQLite.
// Default is dry-run. Use --execute to unlink while preserving full rollback data.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const EXECUTE = process.argv.includes('--execute')
const TOP500 = process.argv.includes('--top500')
const DB_PATH = resolve('data/local_db/cdmx_local.sqlite')
const db = new DatabaseSync(DB_PATH)
const GEO_RELIABLE = new Set([
  'google_places', 'foursquare', 'resy', 'opentable', 'reservandonos',
  'wikidata', 'restaurantguru', 'ubereats',
])

function clean(value) {
  if (value === null || value === undefined) return null
  const result = String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return result || null
}

function fold(value) {
  return clean(value)?.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null
}

function nameTokens(value) {
  const normalized = fold(value)?.replace(/\b(restaurante|restaurant|cafe|cafeteria|taqueria|sucursal)\b/g, ' ')
  return new Set(normalized?.split(/\s+/).filter(token => token.length > 1) || [])
}

function compactName(value) {
  return fold(value)?.replace(/\b(restaurante|restaurant|cafe|cafeteria|taqueria|sucursal)\b/g, '')
    .replace(/\s+/g, '') || null
}

function similarity(a, b) {
  const left = nameTokens(a), right = nameTokens(b)
  if (!left.size || !right.size) return null
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection++
  return intersection / (left.size + right.size - intersection)
}

function num(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function distanceMeters(a, b) {
  if ([a.latitude, a.longitude, b.latitude, b.longitude].some(value => value === null)) return null
  const toRad = degrees => degrees * Math.PI / 180
  const earth = 6371000
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude), lat2 = toRad(b.latitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * earth * Math.asin(Math.sqrt(h))
}

const restaurants = new Map(db.prepare(
  'SELECT id,nombre,latitud,longitud FROM restaurants'
).all().map(row => [row.id, row]))
const top500Ids = TOP500
  ? new Set(db.prepare('SELECT restaurant_id FROM top500_enrichment_status').all().map(row => row.restaurant_id))
  : null

const allRows = db.prepare(`
  SELECT * FROM source_records
  WHERE matched_restaurant_id IS NOT NULL
  ORDER BY scrape_date DESC, scraped_at DESC
`).all()

const latestByIdentity = new Map()
const rowsByIdentity = new Map()
for (const row of allRows) {
  const identityKey = `${row.matched_restaurant_id}:${row.source}:${row.source_id}`
  if (!latestByIdentity.has(identityKey)) latestByIdentity.set(identityKey, row)
  if (!rowsByIdentity.has(identityKey)) rowsByIdentity.set(identityKey, [])
  rowsByIdentity.get(identityKey).push(row)
}

const latestByRestaurant = new Map()
for (const row of latestByIdentity.values()) {
  if (!latestByRestaurant.has(row.matched_restaurant_id)) latestByRestaurant.set(row.matched_restaurant_id, [])
  latestByRestaurant.get(row.matched_restaurant_id).push(row)
}

const candidates = []
for (const [restaurantId, rows] of latestByRestaurant) {
  if (top500Ids && !top500Ids.has(restaurantId)) continue
  const restaurant = restaurants.get(restaurantId)
  if (!restaurant) continue
  const canonicalCoords = { latitude: num(restaurant.latitud), longitude: num(restaurant.longitud) }
  const alignedSources = rows.filter(row => (similarity(restaurant.nombre, row.name) ?? 0) >= 0.5)

  for (const row of rows) {
    const sourceCoords = { latitude: num(row.latitude), longitude: num(row.longitude) }
    const distance = distanceMeters(canonicalCoords, sourceCoords)
    // A canonical record represents one physical location. Even an exact brand
    // name is a wrong association when a venue-level source points >300m away.
    if (distance !== null && distance > 300 && GEO_RELIABLE.has(row.source)) {
      candidates.push({
        restaurantId,
        restaurantName: restaurant.nombre,
        source: row.source,
        sourceId: row.source_id,
        sourceName: row.name,
        nameSimilarity: similarity(restaurant.nombre, row.name),
        distanceMeters: Math.round(distance),
        supportingSources: 1,
        supportingGeoSources: 0,
        reason: 'venue_location_outlier_300m',
      })
      continue
    }
    // Joined/spaced spellings such as RosaNegra/Rosa Negra are the same identity.
    if (compactName(restaurant.nombre) === compactName(row.name)) continue
    const nameScore = similarity(restaurant.nombre, row.name)
    if (nameScore === null) continue
    // Branch-aware matches are explicitly validated by same-brand proximity.
    if (row.match_method === 'candidate_brand_coords' && distance !== null && distance <= 250) continue
    // Canonical identity is one independent vote; one aligned external source is
    // therefore enough to reject a completely unrelated source name.
    const support = 1 + new Set(alignedSources.filter(other => other.source !== row.source).map(other => other.source)).size
    const geoSupport = rows.filter(other => {
      if (other.source === row.source) return false
      const otherCoords = { latitude: num(other.latitude), longitude: num(other.longitude) }
      const otherDistance = distanceMeters(canonicalCoords, otherCoords)
      return otherDistance !== null && otherDistance <= 300
    }).length

    let reason = null
    if (nameScore === 0 && support >= 2) reason = 'consensus_name_outlier'
    else if (distance !== null && distance > 5000) reason = 'geo_outlier_5km'
    else if (distance !== null && distance > 1000 && geoSupport >= 2) reason = 'consensus_geo_outlier'
    else if (distance !== null && distance > 1000 && nameScore < 0.3) reason = 'geo_name_outlier'
    if (!reason) continue

    candidates.push({
      restaurantId,
      restaurantName: restaurant.nombre,
      source: row.source,
      sourceId: row.source_id,
      sourceName: row.name,
      nameSimilarity: nameScore,
      distanceMeters: distance === null ? null : Math.round(distance),
      supportingSources: support,
      supportingGeoSources: geoSupport,
      reason,
    })
  }
}

const unique = [...new Map(candidates.map(candidate => [
  `${candidate.restaurantId}:${candidate.source}:${candidate.sourceId}`, candidate,
])).values()]

console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} — ${unique.length} associations manifestement fausses`)
const byReason = Object.groupBy(unique, candidate => candidate.reason)
for (const [reason, rows] of Object.entries(byReason)) console.log(`${reason}: ${rows.length}`)
const bySource = Object.groupBy(unique, candidate => candidate.source)
console.log(`Sources: ${Object.entries(bySource).sort((a, b) => b[1].length - a[1].length).map(([source, rows]) => `${source}=${rows.length}`).join(', ')}`)
for (const row of unique.slice(0, 25)) {
  console.log(`${row.restaurantName} ←/→ ${row.source}:${row.sourceName} | ${row.reason} | ${row.distanceMeters ?? '-'}m | support=${row.supportingSources}`)
}

if (!EXECUTE) {
  console.log('\nRelance avec --execute pour appliquer la quarantaine locale réversible.')
  db.close()
  process.exit(0)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS source_match_quarantine (
    source_record_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    original_restaurant_id TEXT NOT NULL,
    original_match_confidence REAL,
    original_match_method TEXT,
    reason TEXT NOT NULL,
    evidence TEXT NOT NULL,
    quarantined_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS identity_match_quarantine (
    identity_id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_url TEXT,
    confidence REAL,
    match_method TEXT,
    notes TEXT,
    created_at TEXT,
    updated_at TEXT,
    reason TEXT NOT NULL,
    evidence TEXT NOT NULL,
    quarantined_at TEXT NOT NULL
  );
`)

const saveRecord = db.prepare(`
  INSERT OR IGNORE INTO source_match_quarantine VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const unlinkRecord = db.prepare(`
  UPDATE source_records
  SET matched_restaurant_id = NULL, match_confidence = NULL, match_method = 'quarantined_conflict'
  WHERE id = ?
`)
const findIdentities = db.prepare(`
  SELECT * FROM restaurant_identities
  WHERE restaurant_id = ? AND source = ? AND source_id = ?
`)
const saveIdentity = db.prepare(`
  INSERT OR IGNORE INTO identity_match_quarantine VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)
const deleteIdentity = db.prepare('DELETE FROM restaurant_identities WHERE id = ?')
const quarantinedAt = new Date().toISOString()
let recordsUnlinked = 0
let identitiesRemoved = 0

db.exec('BEGIN')
try {
  for (const candidate of unique) {
    const evidence = JSON.stringify(candidate)
    const identityKey = `${candidate.restaurantId}:${candidate.source}:${candidate.sourceId}`
    for (const row of rowsByIdentity.get(identityKey) || []) {
      saveRecord.run(
        row.id, row.source, row.source_id, row.matched_restaurant_id,
        row.match_confidence, row.match_method, candidate.reason, evidence, quarantinedAt,
      )
      recordsUnlinked += Number(unlinkRecord.run(row.id).changes)
    }
    for (const identity of findIdentities.all(candidate.restaurantId, candidate.source, candidate.sourceId)) {
      saveIdentity.run(
        identity.id, identity.restaurant_id, identity.source, identity.source_id, identity.source_url,
        identity.confidence, identity.match_method, identity.notes, identity.created_at, identity.updated_at,
        candidate.reason, evidence, quarantinedAt,
      )
      identitiesRemoved += Number(deleteIdentity.run(identity.id).changes)
    }
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

console.log(`\nQuarantaine appliquée : ${recordsUnlinked} source_records déliés, ${identitiesRemoved} identities retirées`)
console.log('Rollback disponible dans source_match_quarantine et identity_match_quarantine.')
db.close()
