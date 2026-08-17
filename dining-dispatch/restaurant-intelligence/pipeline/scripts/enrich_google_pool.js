// Enrichit la POOL PREMIUM via Google Places API (New).
//
// Pour chaque resto de fetchPool() :
//   1. Text Search avec biais géographique → meilleur candidat
//   2. Si score >= seuil → écrit dans source_records + restaurant_identities + maj restaurants
//   3. Pousse websiteUri / googleMapsUri dans restaurant_links
//
// Signaux capturés (Atmosphere tier — $25 / 1k reqs) :
//   - rating, userRatingCount, priceLevel  → signal volume / segment prix
//   - regularOpeningHours                  → horaires structurés
//   - photos (refs)                        → visuels officiels
//   - businessStatus                       → vivant / mort / temporairement fermé
//
// Usage :
//   node scripts/enrich_google_pool.js --limit=10           # smoke test
//   node scripts/enrich_google_pool.js --limit=10 --dry     # sans écriture
//   node scripts/enrich_google_pool.js                      # full pool (~3273, ≈$80)
//   node scripts/enrich_google_pool.js --skip-verified      # skip ceux qui ont déjà un google_place_id

import 'dotenv/config'
import { supabase, sanitizeText } from './lib/supabase.js'
import { fetchPool } from './lib/pool.js'
import { persistIdentity } from './lib/match.js'
import { normalizeUrl, hostFromUrl, distanceMeters, nameSimilarity } from './lib/normalize.js'

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=')
    return [k, v ?? true]
  })
)

const DRY = !!args.dry
const LIMIT = args.limit ? Number(args.limit) : null
const SKIP_VERIFIED = !!args['skip-verified']
const DELAY_MS = args.delay ? Number(args.delay) : 250
const SEARCH_RADIUS = args.radius ? Number(args.radius) : 200
const MIN_MATCH_SCORE = args['min-score'] ? Number(args['min-score']) : 0.65
const TODAY = new Date().toISOString().slice(0, 10)

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY
if (!GOOGLE_KEY) throw new Error('GOOGLE_PLACES_API_KEY manquant')

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'
const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.businessStatus',
  'places.types',
  'places.primaryType',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.regularOpeningHours',
  'places.photos',
  'places.editorialSummary',
].join(',')

const sleep = ms => new Promise(r => setTimeout(r, ms))

// ─── scoring ─────────────────────────────────────────────────────────────────
function scoreCandidate(resto, place) {
  const loc = place.location || {}
  const dist = distanceMeters(resto.latitud, resto.longitud, loc.latitude, loc.longitude)
  const distScore = Math.max(0, 1 - dist / SEARCH_RADIUS)
  const nameScore = nameSimilarity(resto.nombre, place.displayName?.text || '')
  return { place, dist, nameScore, score: distScore * 0.4 + nameScore * 0.6 }
}

// ─── Google API call ─────────────────────────────────────────────────────────
async function searchGoogle(resto) {
  if (resto.latitud == null || resto.longitud == null) return []
  const body = {
    textQuery: `${resto.nombre} ${resto.colonia || ''} Ciudad de Mexico`.trim(),
    languageCode: 'es-MX',
    regionCode: 'MX',
    locationBias: {
      circle: {
        center: { latitude: Number(resto.latitud), longitude: Number(resto.longitud) },
        radius: SEARCH_RADIUS,
      },
    },
  }
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Google HTTP ${res.status}: ${json.error?.message || JSON.stringify(json)}`)
  return json.places || []
}

// ─── mappings ────────────────────────────────────────────────────────────────
function mapPriceLevel(pl) {
  // PRICE_LEVEL_INEXPENSIVE → bas, _MODERATE → moyen, _EXPENSIVE/_VERY_EXPENSIVE → haut
  if (!pl) return null
  if (pl === 'PRICE_LEVEL_INEXPENSIVE') return 'bas'
  if (pl === 'PRICE_LEVEL_MODERATE') return 'moyen'
  if (pl === 'PRICE_LEVEL_EXPENSIVE' || pl === 'PRICE_LEVEL_VERY_EXPENSIVE') return 'haut'
  return null
}

function formatHours(rh) {
  if (!rh?.weekdayDescriptions) return null
  return rh.weekdayDescriptions.join(' | ')
}

// ─── pipeline par resto ──────────────────────────────────────────────────────
async function processOne(resto) {
  let places
  try { places = await searchGoogle(resto) }
  catch (e) { return { status: 'error', reason: e.message } }

  if (!places.length) return { status: 'no_result' }

  const scored = places.map(p => scoreCandidate(resto, p)).sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (best.score < MIN_MATCH_SCORE) return { status: 'rejected', best }

  const place = best.place
  const placeId = place.id

  if (DRY) return { status: 'matched', best, placeId, dry: true }

  // 1. Staging immutable
  await supabase.from('source_records').upsert({
    source: 'google_places',
    source_id: placeId,
    scrape_date: TODAY,
    name: sanitizeText(place.displayName?.text),
    latitude: place.location?.latitude,
    longitude: place.location?.longitude,
    address: sanitizeText(place.formattedAddress),
    phone: place.internationalPhoneNumber || place.nationalPhoneNumber || null,
    website: normalizeUrl(place.websiteUri),
    payload: place,
    processed_at: new Date().toISOString(),
    matched_restaurant_id: resto.id,
    match_confidence: best.score,
    match_method: 'google_text_search',
  }, { onConflict: 'source,source_id,scrape_date' })

  // 2. Identity persistante
  await persistIdentity({
    restaurantId: resto.id,
    source: 'google_places',
    sourceId: placeId,
    sourceUrl: place.googleMapsUri,
    confidence: best.score,
    method: 'google_text_search',
  })

  // 3. Patch canonique
  const patch = {
    google_place_id: placeId,
    verified_at: new Date().toISOString(),
    verified_open: place.businessStatus === 'OPERATIONAL',
    statut: place.businessStatus === 'OPERATIONAL' ? 'actif'
          : place.businessStatus ? 'ferme' : resto.statut || 'actif',
  }
  if (!resto.horaires && formatHours(place.regularOpeningHours)) {
    patch.horaires = formatHours(place.regularOpeningHours)
  }
  if (!resto.gamme_prix && mapPriceLevel(place.priceLevel)) {
    patch.gamme_prix = mapPriceLevel(place.priceLevel)
  }
  if (!resto.sitio_web && place.websiteUri) {
    patch.sitio_web = normalizeUrl(place.websiteUri)
  }
  if (!resto.telefono && (place.nationalPhoneNumber || place.internationalPhoneNumber)) {
    patch.telefono = place.nationalPhoneNumber || place.internationalPhoneNumber
  }
  await supabase.from('restaurants').update(patch).eq('id', resto.id)

  // 4. Liens vers restaurant_links
  const linkRows = []
  if (place.websiteUri) {
    const norm = normalizeUrl(place.websiteUri)
    linkRows.push({
      restaurant_id: resto.id,
      url: place.websiteUri,
      normalized_url: norm,
      host: hostFromUrl(place.websiteUri),
      source: 'google_places',
      link_type: 'official_site',
      provider: 'website',
      status: 'valid',
      confidence_score: 0.9,
      checked_at: new Date().toISOString(),
    })
  }
  if (place.googleMapsUri) {
    linkRows.push({
      restaurant_id: resto.id,
      url: place.googleMapsUri,
      normalized_url: normalizeUrl(place.googleMapsUri),
      host: 'maps.google.com',
      source: 'google_places',
      link_type: 'review',
      provider: 'google_maps',
      status: 'valid',
      confidence_score: 1.0,
      checked_at: new Date().toISOString(),
    })
  }
  if (linkRows.length) {
    await supabase.from('restaurant_links').upsert(linkRows, { onConflict: 'restaurant_id,normalized_url' })
  }

  return { status: 'matched', best, placeId, patch }
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Mode: ${DRY ? 'DRY-RUN' : 'écriture Supabase'}`)
  console.log(`Pool: limit=${LIMIT || 'all'}  skip_verified=${SKIP_VERIFIED}  delay=${DELAY_MS}ms  min_score=${MIN_MATCH_SCORE}`)

  let pool = await fetchPool({ limit: LIMIT ? LIMIT * 2 : null })
  if (SKIP_VERIFIED) pool = pool.filter(r => !r.google_place_id)
  if (LIMIT) pool = pool.slice(0, LIMIT)
  console.log(`→ ${pool.length} restos à traiter`)
  console.log(`→ Coût estimé : ~$${(pool.length * 0.025).toFixed(2)} (Atmosphere tier $25/1k)`)

  const stats = { matched: 0, rejected: 0, no_result: 0, error: 0 }
  const startedAt = Date.now()
  let i = 0
  for (const r of pool) {
    i++
    const res = await processOne(r)
    stats[res.status]++

    if (res.status === 'matched') {
      const fields = Object.keys(res.patch || {})
      console.log(`[ok ${i}/${pool.length}] ${r.nombre} → ${res.best.place.displayName?.text}  score ${res.best.score.toFixed(2)}  ${Math.round(res.best.dist)}m  rating=${res.best.place.rating || '-'} ⌚${res.best.place.userRatingCount || 0}  ${res.best.place.priceLevel || ''}  [${fields.join(',')}]`)
    } else if (res.status === 'rejected') {
      console.log(`[reject ${i}/${pool.length}] ${r.nombre} → ${res.best.place.displayName?.text}  score ${res.best.score.toFixed(2)}`)
    } else if (res.status === 'no_result') {
      console.log(`[none ${i}/${pool.length}] ${r.nombre}`)
    } else if (res.status === 'error') {
      console.log(`[err ${i}/${pool.length}] ${r.nombre} : ${res.reason}`)
    }

    if (i < pool.length) await sleep(DELAY_MS)
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0)
  console.log(`\n═══ Terminé en ${elapsed}s ═══`)
  console.log(`  matched     : ${stats.matched}`)
  console.log(`  rejected    : ${stats.rejected}`)
  console.log(`  no_result   : ${stats.no_result}`)
  console.log(`  error       : ${stats.error}`)
  console.log(`  total cost  : ≈ $${(pool.length * 0.025).toFixed(2)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
