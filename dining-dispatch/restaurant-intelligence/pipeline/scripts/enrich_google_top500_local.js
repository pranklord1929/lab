// Enriches only top-500 restaurants missing Google Places in local SQLite.
// One API request per restaurant. Writes locally with --execute.
import 'dotenv/config'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { distanceMeters, nameSimilarity, normalizeUrl, hostFromUrl } from './lib/normalize.js'

const EXECUTE = process.argv.includes('--execute')
const KEY = process.env.GOOGLE_PLACES_API_KEY
if (!KEY) throw new Error('GOOGLE_PLACES_API_KEY manquante')

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const today = new Date().toISOString().slice(0, 10)
const now = new Date().toISOString()
const radius = 450
const minScore = 0.68
const endpoint = 'https://places.googleapis.com/v1/places:searchText'
const fieldMask = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
  'places.businessStatus', 'places.types', 'places.primaryType', 'places.websiteUri',
  'places.googleMapsUri', 'places.nationalPhoneNumber', 'places.internationalPhoneNumber',
  'places.rating', 'places.userRatingCount', 'places.priceLevel',
  'places.regularOpeningHours', 'places.photos', 'places.editorialSummary',
].join(',')

const targets = db.prepare(`
  SELECT r.*, s.rank_overall
  FROM restaurant_search_mv s
  JOIN restaurants r ON r.id = s.id
  WHERE s.rank_overall BETWEEN 1 AND 500
    AND NOT EXISTS (
      SELECT 1 FROM source_records sr
      WHERE sr.matched_restaurant_id = r.id AND sr.source = 'google_places'
    )
  ORDER BY s.rank_overall
`).all()

console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} — ${targets.length} requêtes Google maximum (~$${(targets.length * 0.025).toFixed(2)})`)

async function search(resto) {
  const body = {
    textQuery: `${resto.nombre} ${resto.nom_vialidad || ''} ${resto.numero_exterior || ''} ${resto.colonia || ''} Ciudad de Mexico`.trim(),
    languageCode: 'es-MX', regionCode: 'MX',
    locationBias: {
      circle: {
        center: { latitude: Number(resto.latitud), longitude: Number(resto.longitud) },
        radius,
      },
    },
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': fieldMask },
    body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`)
  return result.places || []
}

function score(resto, place) {
  const distance = distanceMeters(resto.latitud, resto.longitud, place.location?.latitude, place.location?.longitude)
  const nameScore = nameSimilarity(resto.nombre, place.displayName?.text || '')
  const distanceScore = Math.max(0, 1 - distance / radius)
  return { place, distance, nameScore, score: nameScore * 0.62 + distanceScore * 0.38 }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS google_local_enrichment_log (
    restaurant_id TEXT NOT NULL,
    restaurant_name TEXT NOT NULL,
    rank_overall INTEGER,
    status TEXT NOT NULL,
    candidate_place_id TEXT,
    candidate_name TEXT,
    score REAL,
    distance_meters REAL,
    reason TEXT,
    created_at TEXT NOT NULL
  );
`)
const log = db.prepare('INSERT INTO google_local_enrichment_log VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
const existingPlace = db.prepare(`
  SELECT id,nombre FROM restaurants
  WHERE google_place_id = ? AND id <> ? LIMIT 1
`)
const existingSourcePlace = db.prepare(`
  SELECT matched_restaurant_id FROM source_records
  WHERE source = 'google_places' AND source_id = ? AND matched_restaurant_id IS NOT NULL AND matched_restaurant_id <> ?
  LIMIT 1
`)
const insertSource = db.prepare(`
  INSERT INTO source_records
    (id,source,source_id,scrape_date,scraped_at,name,latitude,longitude,address,phone,website,payload,
     processed_at,matched_restaurant_id,match_confidence,match_method,created_at)
  VALUES (?, 'google_places', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'google_text_search_local', ?)
`)
const insertIdentity = db.prepare(`
  INSERT INTO restaurant_identities
    (id,restaurant_id,source,source_id,source_url,confidence,match_method,notes,created_at,updated_at)
  VALUES (?, ?, 'google_places', ?, ?, ?, 'google_text_search_local', 'local top500 enrichment', ?, ?)
`)
const identityExists = db.prepare('SELECT 1 FROM restaurant_identities WHERE source = ? AND source_id = ?')
const linkExists = db.prepare('SELECT 1 FROM restaurant_links WHERE restaurant_id = ? AND normalized_url = ?')
const insertLink = db.prepare(`
  INSERT INTO restaurant_links
    (id,restaurant_id,url,normalized_url,host,source,link_type,provider,status,confidence_score,checked_at,created_at,updated_at)
  VALUES (?, ?, ?, ?, ?, 'google_places', ?, ?, 'valid', ?, ?, ?, ?)
`)

function persist(resto, best) {
  const place = best.place
  const duplicate = existingPlace.get(place.id, resto.id) || existingSourcePlace.get(place.id, resto.id)
  if (duplicate) return { status: 'duplicate_place', reason: duplicate.nombre || duplicate.matched_restaurant_id }

  db.exec('BEGIN')
  try {
    insertSource.run(
      randomUUID(), place.id, today, now, place.displayName?.text || null,
      place.location?.latitude || null, place.location?.longitude || null,
      place.formattedAddress || null, place.internationalPhoneNumber || place.nationalPhoneNumber || null,
      normalizeUrl(place.websiteUri), JSON.stringify(place), now, resto.id, best.score, now,
    )
    if (!identityExists.get('google_places', place.id)) {
      insertIdentity.run(randomUUID(), resto.id, place.id, place.googleMapsUri || null, best.score, now, now)
    }
    const updates = {
      google_place_id: place.id,
      verified_open: place.businessStatus === 'OPERATIONAL' ? 1 : 0,
      verified_at: now,
      updated_at: now,
    }
    if (!resto.telefono && (place.internationalPhoneNumber || place.nationalPhoneNumber)) updates.telefono = place.internationalPhoneNumber || place.nationalPhoneNumber
    if (!resto.sitio_web && place.websiteUri) updates.sitio_web = normalizeUrl(place.websiteUri)
    if (!resto.horaires && place.regularOpeningHours?.weekdayDescriptions) updates.horaires = place.regularOpeningHours.weekdayDescriptions.join(' | ')
    db.prepare(`UPDATE restaurants SET ${Object.keys(updates).map(key => `"${key}" = ?`).join(', ')} WHERE id = ?`)
      .run(...Object.values(updates), resto.id)

    for (const candidate of [
      place.websiteUri && { url: place.websiteUri, type: 'official_site', provider: 'website', confidence: 0.9 },
      place.googleMapsUri && { url: place.googleMapsUri, type: 'review', provider: 'google_maps', confidence: 1 },
    ].filter(Boolean)) {
      const normalized = normalizeUrl(candidate.url)
      if (!linkExists.get(resto.id, normalized)) {
        insertLink.run(randomUUID(), resto.id, candidate.url, normalized, hostFromUrl(candidate.url), candidate.type, candidate.provider, candidate.confidence, now, now, now)
      }
    }
    db.exec('COMMIT')
    return { status: 'matched' }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

const stats = { matched: 0, rejected: 0, no_result: 0, duplicate_place: 0, error: 0 }
for (const [index, resto] of targets.entries()) {
  try {
    const places = await search(resto)
    if (!places.length) {
      stats.no_result++
      log.run(resto.id, resto.nombre, resto.rank_overall, 'no_result', null, null, null, null, null, now)
      continue
    }
    const best = places.map(place => score(resto, place)).sort((a, b) => b.score - a.score)[0]
    if (best.score < minScore || best.distance > 700) {
      stats.rejected++
      log.run(resto.id, resto.nombre, resto.rank_overall, 'rejected', best.place.id, best.place.displayName?.text, best.score, best.distance, 'threshold', now)
      console.log(`[reject] ${resto.nombre} → ${best.place.displayName?.text} ${best.score.toFixed(2)} ${Math.round(best.distance)}m`)
      continue
    }
    const result = EXECUTE ? persist(resto, best) : { status: 'matched' }
    stats[result.status]++
    log.run(resto.id, resto.nombre, resto.rank_overall, result.status, best.place.id, best.place.displayName?.text, best.score, best.distance, result.reason || null, now)
    console.log(`[${result.status}] ${resto.nombre} → ${best.place.displayName?.text} ${best.score.toFixed(2)} ${Math.round(best.distance)}m`)
  } catch (error) {
    stats.error++
    log.run(resto.id, resto.nombre, resto.rank_overall, 'error', null, null, null, null, error.message, now)
    console.log(`[error] ${resto.nombre}: ${error.message}`)
  }
  if (index < targets.length - 1) await new Promise(resolve => setTimeout(resolve, 120))
}

console.log(JSON.stringify(stats))
db.close()

