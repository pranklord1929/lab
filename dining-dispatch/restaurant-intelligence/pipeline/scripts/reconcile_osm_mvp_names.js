// Corrige les noms commerciaux des restaurants MVP a partir d'OSM.
// Objectif: garder les lignes DENUE, mais afficher le nom commercial utile.
// Par defaut: dry-run. Utiliser --write pour appliquer.

import { createClient } from '@supabase/supabase-js'
import { isMvpZoneRestaurant } from './mvp_zone.js'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const allowLocationOnly = args.has('--allow-location-only')
const limit = Number(getArg('limit', 0))
const radiusMeters = Number(getArg('radius', 30))
const maxAmbiguousMeters = Number(getArg('ambiguous-gap', 8))

const MVP_BBOX = {
  south: 19.3955,
  west: -99.1905,
  north: 19.4265,
  east: -99.155,
}

const BAD_OSM_NAMES = new Set(['restaurant', 'restaurante', 'cafe', 'bar', 'food'])

function getArg(name, fallback) {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`))
  return raw ? raw.split('=').slice(1).join('=') : fallback
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

function cleanName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
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

function isUsefulOsmName(name) {
  const normalized = normalize(name)
  return normalized.length >= 3 && !BAD_OSM_NAMES.has(normalized)
}

function sameName(left, right) {
  return normalize(left) === normalize(right)
}

async function fetchOSMPlaces() {
  const query = `
    [out:json][timeout:180];
    (
      node["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub)$"](${MVP_BBOX.south},${MVP_BBOX.west},${MVP_BBOX.north},${MVP_BBOX.east});
      way["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub)$"](${MVP_BBOX.south},${MVP_BBOX.west},${MVP_BBOX.north},${MVP_BBOX.east});
      relation["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub)$"](${MVP_BBOX.south},${MVP_BBOX.west},${MVP_BBOX.north},${MVP_BBOX.east});
    );
    out center tags;
  `

  let lastError = null
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'cdmx-restaurants-osm-mvp-name-reconcile/1.0',
        },
      })

      if (!res.ok) {
        lastError = new Error(`Overpass ${url} HTTP ${res.status}: ${await res.text()}`)
        continue
      }

      const json = await res.json()
      return json.elements
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Overpass indisponible')
}

async function fetchExistingRestaurants() {
  const rows = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('restaurants')
      .select('id, denue_id, nombre, colonia, alcaldia, latitud, longitud, osm_id, sitio_web, telefono, instagram, cuisine_type, horaires, notes, source')
      .gte('latitud', MVP_BBOX.south)
      .lte('latitud', MVP_BBOX.north)
      .gte('longitud', MVP_BBOX.west)
      .lte('longitud', MVP_BBOX.east)
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Supabase restaurants: ${error.message}`)
    if (!data || data.length === 0) break

    rows.push(...data)
    if (data.length < pageSize) break
  }

  return rows.filter(isMvpZoneRestaurant)
}

function nearbyCandidates(place, restaurants) {
  return restaurants
    .map(restaurant => ({
      restaurant,
      distance: haversineMeters(place.lat, place.lon, Number(restaurant.latitud), Number(restaurant.longitud)),
      exactOsm: restaurant.osm_id === place.osmId || restaurant.denue_id === `osm:${place.osmId}`,
    }))
    .filter(candidate => candidate.distance <= radiusMeters || candidate.exactOsm)
    .sort((a, b) => a.distance - b.distance)
}

function chooseClearMatch(place, restaurants) {
  const candidates = nearbyCandidates(place, restaurants)
  if (candidates.length === 0) return { match: null, reason: 'no_nearby', candidates }

  const exact = candidates.find(candidate => candidate.exactOsm)
  if (exact) return { match: exact, reason: 'exact_osm', candidates }

  if (!allowLocationOnly) return { match: null, reason: 'location_only_disabled', candidates }

  const [best, second] = candidates
  if (best.distance <= 12) return { match: best, reason: 'very_close', candidates }
  if (best.distance <= radiusMeters && !second) return { match: best, reason: 'single_nearby', candidates }
  if (best.distance <= 22 && second && second.distance - best.distance >= maxAmbiguousMeters) {
    return { match: best, reason: 'clear_nearest', candidates }
  }

  return { match: null, reason: 'ambiguous', candidates }
}

function buildPatch(place, match) {
  const tags = place.tags || {}
  const restaurant = match.restaurant
  const newName = cleanName(tags.name)
  const oldName = cleanName(restaurant.nombre)
  const patch = {
    osm_id: restaurant.osm_id || place.osmId,
  }

  if (!sameName(oldName, newName)) {
    patch.nombre = newName
    patch.notes = [
      restaurant.notes,
      `Nom commercial OSM applique: "${newName}". Ancien nom base: "${oldName}". Source OSM ${place.osmId}. Match ${Math.round(match.distance)}m.`,
    ].filter(Boolean).join('\n')
  }

  if (!restaurant.sitio_web && (tags.website || tags['contact:website'])) {
    patch.sitio_web = tags.website || tags['contact:website']
  }
  if (!restaurant.telefono && (tags.phone || tags['contact:phone'])) {
    patch.telefono = tags.phone || tags['contact:phone']
  }
  if (!restaurant.instagram && tags['contact:instagram']) {
    patch.instagram = tags['contact:instagram']
  }
  if (!restaurant.cuisine_type && tags.cuisine) {
    patch.cuisine_type = tags.cuisine
  }
  if (!restaurant.horaires && tags.opening_hours) {
    patch.horaires = tags.opening_hours
  }

  return patch
}

async function applyPatch(restaurantId, patch) {
  const { error } = await supabase
    .from('restaurants')
    .update(patch)
    .eq('id', restaurantId)

  if (error) throw new Error(`Supabase update: ${error.message}`)
}

async function main() {
  console.log(`Mode: ${write ? 'ecriture Supabase' : 'dry-run'}`)
  console.log(`Zone: Roma Norte + Condesa | rayon: ${radiusMeters}m`)

  const [osmElements, restaurants] = await Promise.all([
    fetchOSMPlaces(),
    fetchExistingRestaurants(),
  ])

  const places = osmElements
    .map(element => ({
      osmId: `${element.type}/${element.id}`,
      lat: element.lat ?? element.center?.lat,
      lon: element.lon ?? element.center?.lon,
      tags: element.tags || {},
    }))
    .filter(place => place.lat && place.lon && isUsefulOsmName(place.tags.name))
    .slice(0, limit || undefined)

  let changed = 0
  let alreadyOk = 0
  let ambiguous = 0
  let noNearby = 0
  let locationOnly = 0
  let metadataOnly = 0

  for (const place of places) {
    const { match, reason, candidates } = chooseClearMatch(place, restaurants)

    if (!match) {
      if (reason === 'ambiguous') {
        ambiguous++
        const nearby = candidates.slice(0, 3).map(candidate => `${candidate.restaurant.nombre} ${Math.round(candidate.distance)}m`).join(' | ')
        console.log(`[ambiguous] ${place.tags.name} | ${nearby}`)
      } else if (reason === 'location_only_disabled') {
        locationOnly++
        const nearby = candidates.slice(0, 3).map(candidate => `${candidate.restaurant.nombre} ${Math.round(candidate.distance)}m`).join(' | ')
        if (locationOnly <= 80) console.log(`[needs-review] ${place.tags.name} | ${nearby}`)
      } else {
        noNearby++
      }
      continue
    }

    const patch = buildPatch(place, match)
    const patchKeys = Object.keys(patch).filter(key => !(key === 'osm_id' && match.restaurant.osm_id))
    if (patchKeys.length === 0) {
      alreadyOk++
      continue
    }

    if (patch.nombre) changed++
    else metadataOnly++

    console.log(
      `[${write ? 'write' : 'dry-run'}:${reason}] ${match.restaurant.nombre} -> ${patch.nombre || match.restaurant.nombre} | OSM "${place.tags.name}" | ${Math.round(match.distance)}m | ${patchKeys.join(', ')}`
    )

    if (write) await applyPatch(match.restaurant.id, patch)
  }

  console.log('\nTermine.')
  console.log(`OSM places analysees: ${places.length}`)
  console.log(`Noms corrigibles/corriges: ${changed}`)
  console.log(`Metadata seulement: ${metadataOnly}`)
  console.log(`Deja OK: ${alreadyOk}`)
  console.log(`Ambigus ignores: ${ambiguous}`)
  console.log(`Proximite seule a auditer: ${locationOnly}`)
  console.log(`Sans voisin DB: ${noNearby}`)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
