// Enrichissement via OpenStreetMap (Overpass API) - gratuit.
// Ajoute cuisine, horaires, liens et contacts quand un match fiable est trouve.

import { createClient } from '@supabase/supabase-js'
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
const DEFAULT_RADIUS_METERS = 80
const DEFAULT_MIN_SCORE = 0.72
const DEFAULT_MIN_NAME_SCORE = 0.55

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const force = args.has('--force')
const limit = Number(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] || 0)
const radiusMeters = Number(process.argv.find(arg => arg.startsWith('--radius='))?.split('=')[1] || DEFAULT_RADIUS_METERS)
const minScore = Number(process.argv.find(arg => arg.startsWith('--min-score='))?.split('=')[1] || DEFAULT_MIN_SCORE)
const minNameScore = Number(process.argv.find(arg => arg.startsWith('--min-name-score='))?.split('=')[1] || DEFAULT_MIN_NAME_SCORE)

const GENERIC_WORDS = new Set([
  'restaurante',
  'restaurant',
  'rest',
  'cocina',
  'comida',
  'alimentos',
  'antojitos',
  'taqueria',
  'taquerias',
  'tacos',
  'fonda',
  'cafeteria',
  'cafe',
  'bar',
  'de',
  'del',
  'la',
  'las',
  'el',
  'los',
  'y',
])

function parseArg(name, fallback) {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`))
  return raw ? raw.split('=')[1] : fallback
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

function coordinateDelta(meters, latitude) {
  const latDelta = meters / 111320
  const lonDelta = meters / (111320 * Math.cos((latitude * Math.PI) / 180))
  return { latDelta, lonDelta }
}

async function fetchOSMFoodPlaces() {
  console.log('Telechargement OSM CDMX...')

  const amenityFilter = parseArg('amenities', 'restaurant|cafe|fast_food|food_court|bar|pub')
  const query = `
    [out:json][timeout:180];
    (
      node["amenity"~"^(${amenityFilter})$"](19.0,-99.4,19.6,-98.9);
      way["amenity"~"^(${amenityFilter})$"](19.0,-99.4,19.6,-98.9);
      relation["amenity"~"^(${amenityFilter})$"](19.0,-99.4,19.6,-98.9);
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
          'User-Agent': 'cdmx-restaurants-enrichment/1.0',
        },
      })

      if (!res.ok) {
        lastError = new Error(`Overpass ${url} HTTP ${res.status}: ${await res.text()}`)
        continue
      }

      const json = await res.json()
      console.log(`OSM: ${json.elements.length} lieux trouves`)
      return json.elements
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Overpass indisponible')
}

async function findCandidates(osmPlace) {
  const { latDelta, lonDelta } = coordinateDelta(radiusMeters, osmPlace.lat)

  const { data, error } = await supabase
    .from('restaurants')
    .select('id, nombre, latitud, longitud, osm_id, cuisine_type, horaires, sitio_web, telefono, instagram')
    .gte('latitud', osmPlace.lat - latDelta)
    .lte('latitud', osmPlace.lat + latDelta)
    .gte('longitud', osmPlace.lon - lonDelta)
    .lte('longitud', osmPlace.lon + lonDelta)
    .limit(25)

  if (error) throw new Error(`Supabase read: ${error.message}`)
  return data || []
}

function scoreCandidate(osmPlace, candidate) {
  const distance = haversineMeters(
    Number(osmPlace.lat),
    Number(osmPlace.lon),
    Number(candidate.latitud),
    Number(candidate.longitud)
  )
  const distanceScore = Math.max(0, 1 - distance / radiusMeters)
  const nameScore = tokenScore(osmPlace.name, candidate.nombre)

  return {
    candidate,
    distance,
    nameScore,
    score: distanceScore * 0.55 + nameScore * 0.45,
  }
}

function buildUpdate(osmPlace, candidate) {
  const tags = osmPlace.tags
  const update = {}

  if (force || !candidate.osm_id) update.osm_id = osmPlace.osmId
  if ((force || !candidate.cuisine_type) && tags.cuisine) update.cuisine_type = tags.cuisine
  if ((force || !candidate.horaires) && tags.opening_hours) update.horaires = tags.opening_hours
  if ((force || !candidate.sitio_web) && (tags.website || tags['contact:website'])) {
    update.sitio_web = tags.website || tags['contact:website']
  }
  if ((force || !candidate.telefono) && (tags.phone || tags['contact:phone'])) {
    update.telefono = tags.phone || tags['contact:phone']
  }
  if ((force || !candidate.instagram) && tags['contact:instagram']) {
    update.instagram = tags['contact:instagram']
  }

  return update
}

async function enrichFromOSM() {
  console.log(`Mode: ${dryRun ? 'dry-run' : 'ecriture Supabase'}`)
  console.log(`Rayon: ${radiusMeters}m | score minimum: ${minScore} | nom minimum: ${minNameScore}`)

  const osmData = await fetchOSMFoodPlaces()
  const places = osmData
    .map(element => ({
      osmId: `${element.type}/${element.id}`,
      lat: element.lat ?? element.center?.lat,
      lon: element.lon ?? element.center?.lon,
      tags: element.tags || {},
      name: element.tags?.name || '',
    }))
    .filter(place => place.lat && place.lon && place.name)
    .slice(0, limit || undefined)

  let matched = 0
  let updated = 0
  let skippedLowConfidence = 0
  let skippedNoPatch = 0

  for (const place of places) {
    const candidates = await findCandidates(place)
    if (candidates.length === 0) continue

    const best = candidates
      .map(candidate => scoreCandidate(place, candidate))
      .sort((a, b) => b.score - a.score)[0]

    if (!best || best.score < minScore || best.nameScore < minNameScore) {
      skippedLowConfidence++
      continue
    }

    matched++
    const patch = buildUpdate(place, best.candidate)

    if (Object.keys(patch).length === 0) {
      skippedNoPatch++
      continue
    }

    if (dryRun) {
      console.log(
        `[dry-run] ${place.name} -> ${best.candidate.nombre} | ${Math.round(best.distance)}m | score ${best.score.toFixed(2)} | ${Object.keys(patch).join(', ')}`
      )
      updated++
      continue
    }

    const { error } = await supabase
      .from('restaurants')
      .update(patch)
      .eq('id', best.candidate.id)

    if (error) throw new Error(`Supabase update: ${error.message}`)
    updated++

    if (updated % 100 === 0) {
      console.log(`${updated} restaurants enrichis...`)
    }
  }

  console.log('\nTermine.')
  console.log(`OSM exploitables: ${places.length}`)
  console.log(`Matches fiables: ${matched}`)
  console.log(`${dryRun ? 'Mises a jour possibles' : 'Mises a jour ecrites'}: ${updated}`)
  console.log(`Ignorés faible confiance: ${skippedLowConfidence}`)
  console.log(`Ignorés sans nouveau champ: ${skippedNoPatch}`)
}

enrichFromOSM().catch(error => {
  console.error(error.message)
  process.exit(1)
})
