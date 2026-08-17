// Enrichit/corrige Roma Norte + Condesa via Google Places Text Search (New).
// Par defaut: dry-run. Utiliser --write pour appliquer.
//
// Garde-fous:
// - zone MVP uniquement
// - limite obligatoire raisonnable
// - correction du nom seulement avec score fort
// - conservation de l'ancien nom dans notes

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { isMvpZoneRestaurant } from './mvp_zone.js'

config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY
const GOOGLE_TEXT_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText'

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const forceName = args.has('--force-name')
const limit = Number(getArg('limit', 25))
const offset = Number(getArg('offset', 0))
const delayMs = Number(getArg('delay', 250))
const searchRadius = Number(getArg('radius', 180))
const minMatchScore = Number(getArg('min-score', 0.68))
const minRenameScore = Number(getArg('min-rename-score', 0.86))

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.businessStatus',
  'places.websiteUri',
  'places.googleMapsUri',
  'places.nationalPhoneNumber',
  'places.types',
].join(',')

const GENERIC_WORDS = new Set([
  'restaurante',
  'restaurant',
  'cafe',
  'cafeteria',
  'bar',
  'taqueria',
  'tacos',
  'cocina',
  'comida',
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
])

function getArg(name, fallback) {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`))
  return raw ? raw.split('=').slice(1).join('=') : fallback
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(value) {
  return normalize(value)
    .split(' ')
    .filter(token => token.length > 1 && !GENERIC_WORDS.has(token))
}

function tokenScore(left, right) {
  const leftTokens = new Set(tokens(left))
  const rightTokens = new Set(tokens(right))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0

  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++
  }

  return (2 * overlap) / (leftTokens.size + rightTokens.size)
}

function haversineMeters(aLat, aLon, bLat, bLon) {
  const earthRadius = 6371000
  const toRad = deg => (deg * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2

  return 2 * earthRadius * Math.asin(Math.sqrt(h))
}

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) return null
  try {
    const url = new URL(rawUrl)
    url.hash = ''
    if (url.pathname === '/') url.pathname = ''
    return url.href
  } catch {
    return rawUrl
  }
}

function isGoogleBetterWebsite(current, googleWebsite) {
  if (!googleWebsite) return false
  if (!current) return true

  const currentNorm = normalizeUrl(/^https?:\/\//i.test(current) ? current : `https://${current}`)
  const googleNorm = normalizeUrl(googleWebsite)
  return currentNorm !== googleNorm
}

async function fetchMvpRestaurants() {
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, denue_id, nombre, colonia, alcaldia, nom_vialidad, numero_exterior, latitud, longitud, sitio_web, telefono, google_place_id, notes, source')
    .in('alcaldia', ['Cuauhtémoc', 'Cuauhtemoc'])
    .not('latitud', 'is', null)
    .not('longitud', 'is', null)
    .order('nombre')
    .limit(Math.max((limit + offset) * 20, 500))

  if (error) throw new Error(`Supabase restaurants: ${error.message}`)

  return (data || [])
    .filter(isMvpZoneRestaurant)
    .slice(offset)
    .slice(0, limit)
}

function buildTextQuery(restaurant) {
  const address = [
    restaurant.nom_vialidad,
    restaurant.numero_exterior,
    restaurant.colonia,
    'Cuauhtemoc',
    'Ciudad de Mexico',
  ].filter(Boolean).join(' ')

  return `${restaurant.nombre} ${address}`
}

async function searchGoogle(restaurant) {
  const body = {
    textQuery: buildTextQuery(restaurant),
    languageCode: 'es-MX',
    regionCode: 'MX',
    locationBias: {
      circle: {
        center: {
          latitude: Number(restaurant.latitud),
          longitude: Number(restaurant.longitud),
        },
        radius: searchRadius,
      },
    },
  }

  const res = await fetch(GOOGLE_TEXT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
  })

  const json = await res.json()
  if (!res.ok) {
    const message = json.error?.message || JSON.stringify(json)
    throw new Error(`Google HTTP ${res.status}: ${message}`)
  }

  return json.places || []
}

function scoreCandidate(restaurant, place) {
  const googleName = place.displayName?.text || ''
  const location = place.location || {}
  const distance = haversineMeters(
    Number(restaurant.latitud),
    Number(restaurant.longitud),
    Number(location.latitude),
    Number(location.longitude)
  )
  const distanceScore = Math.max(0, 1 - distance / searchRadius)
  const nameScore = tokenScore(restaurant.nombre, googleName)

  return {
    place,
    googleName,
    distance,
    nameScore,
    score: distanceScore * 0.52 + nameScore * 0.48,
  }
}

function bestCandidate(restaurant, places) {
  return places
    .filter(place => place.location?.latitude && place.location?.longitude)
    .map(place => scoreCandidate(restaurant, place))
    .sort((a, b) => b.score - a.score)[0] || null
}

function buildRestaurantPatch(restaurant, best) {
  const place = best.place
  const googleName = cleanName(best.googleName)
  const oldName = cleanName(restaurant.nombre)
  const patch = {
    google_place_id: place.id,
    verified_at: new Date().toISOString(),
    verified_open: place.businessStatus === 'OPERATIONAL',
    statut: place.businessStatus === 'OPERATIONAL'
      ? 'actif'
      : (place.businessStatus ? 'ferme' : restaurant.statut || 'actif'),
  }

  if (isGoogleBetterWebsite(restaurant.sitio_web, place.websiteUri)) {
    patch.sitio_web = normalizeUrl(place.websiteUri)
  }

  if (!restaurant.telefono && place.nationalPhoneNumber) {
    patch.telefono = place.nationalPhoneNumber
  }

  const shouldRename =
    googleName &&
    normalize(googleName) !== normalize(oldName) &&
    (forceName || best.score >= minRenameScore)

  if (shouldRename) {
    patch.nombre = googleName
    patch.notes = [
      restaurant.notes,
      `Nom commercial Google applique: "${googleName}". Ancien nom base: "${oldName}". Place ID ${place.id}. Match Google score ${best.score.toFixed(2)}, distance ${Math.round(best.distance)}m.`,
    ].filter(Boolean).join('\n')
  }

  return patch
}

function classifyProvider(url) {
  if (!url) return { linkType: 'unknown', provider: null }
  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  if (host.includes('opentable')) return { linkType: 'reservation', provider: 'opentable' }
  if (host.includes('tripadvisor')) return { linkType: 'review', provider: 'tripadvisor' }
  if (host.includes('ubereats')) return { linkType: 'delivery', provider: 'ubereats' }
  if (host.includes('rappi')) return { linkType: 'delivery', provider: 'rappi' }
  if (host.includes('instagram')) return { linkType: 'social', provider: 'instagram' }
  if (host.includes('facebook')) return { linkType: 'social', provider: 'facebook' }
  return { linkType: 'official_site', provider: 'website' }
}

async function upsertLink(restaurant, url, source) {
  const normalized = normalizeUrl(url)
  if (!normalized) return

  const parsed = new URL(normalized)
  const classified = classifyProvider(normalized)
  const row = {
    restaurant_id: restaurant.id,
    url: normalized,
    normalized_url: normalized,
    host: parsed.hostname.replace(/^www\./, '').toLowerCase(),
    source,
    link_type: classified.linkType,
    provider: classified.provider,
    status: 'valid',
    confidence_score: 0.85,
    final_url: normalized,
    final_host: parsed.hostname.replace(/^www\./, '').toLowerCase(),
    checked_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('restaurant_links')
    .upsert(row, { onConflict: 'restaurant_id,normalized_url' })

  if (error && !error.message.includes('restaurant_links')) {
    throw new Error(`Supabase restaurant_links: ${error.message}`)
  }
}

async function applyPatch(restaurant, best, patch) {
  const { error } = await supabase
    .from('restaurants')
    .update(patch)
    .eq('id', restaurant.id)

  if (error) throw new Error(`Supabase update: ${error.message}`)

  if (best.place.websiteUri) {
    await upsertLink(restaurant, best.place.websiteUri, 'google')
  }
  if (best.place.googleMapsUri) {
    await upsertLink(restaurant, best.place.googleMapsUri, 'google')
  }
}

function printResult(prefix, restaurant, best, patch) {
  const keys = Object.keys(patch)
  console.log(
    `[${prefix}] ${restaurant.nombre} -> ${best.googleName} | score ${best.score.toFixed(2)} | ${Math.round(best.distance)}m | ${keys.join(', ')}${best.place.websiteUri ? ` | ${best.place.websiteUri}` : ''}`
  )
}

async function main() {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_PLACES_API_KEY manquant dans .env')
  }

  console.log(`Mode: ${write ? 'ecriture Supabase' : 'dry-run'}`)
  console.log(`Zone: Roma Norte + Condesa | limite: ${limit} | offset: ${offset}`)
  console.log(`FieldMask: ${FIELD_MASK}`)

  const restaurants = await fetchMvpRestaurants()
  let matched = 0
  let updated = 0
  let renamed = 0
  let rejected = 0
  let noResult = 0

  for (const restaurant of restaurants) {
    try {
      const places = await searchGoogle(restaurant)
      const best = bestCandidate(restaurant, places)

      if (!best) {
        noResult++
        console.log(`[none] ${restaurant.nombre}`)
        await sleep(delayMs)
        continue
      }

      if (best.score < minMatchScore) {
        rejected++
        console.log(`[reject] ${restaurant.nombre} -> ${best.googleName} | score ${best.score.toFixed(2)} | ${Math.round(best.distance)}m`)
        await sleep(delayMs)
        continue
      }

      matched++
      const patch = buildRestaurantPatch(restaurant, best)
      if (patch.nombre) renamed++

      printResult(write ? 'write' : 'dry-run', restaurant, best, patch)

      if (write) {
        await applyPatch(restaurant, best, patch)
        updated++
      }
    } catch (error) {
      rejected++
      console.log(`[error] ${restaurant.nombre} | ${error.message}`)
    }

    await sleep(delayMs)
  }

  console.log('\nTermine.')
  console.log(`Restaurants lus: ${restaurants.length}`)
  console.log(`Matches acceptes: ${matched}`)
  console.log(`Updates ecrits: ${updated}`)
  console.log(`Renommages proposes/ecrits: ${renamed}`)
  console.log(`Rejects/erreurs: ${rejected}`)
  console.log(`Sans resultat: ${noResult}`)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
