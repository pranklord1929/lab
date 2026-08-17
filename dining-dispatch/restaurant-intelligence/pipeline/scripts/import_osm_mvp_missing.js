// Trouve les lieux food/drink OSM presents dans Roma Norte + Condesa
// mais absents de la base. Par defaut: dry-run. Utiliser --write pour inserer.

import { createClient } from '@supabase/supabase-js'
import { normalizeText } from './mvp_zone.js'
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
const onlyWithWebsite = args.has('--only-with-website')
const onlyWithContact = args.has('--only-with-contact')
const limit = Number(getArg('limit', 0))
const skip = Number(getArg('skip', 0))
const radiusMeters = Number(getArg('radius', 75))
const minNameScore = Number(getArg('min-name-score', 0.45))
const timeoutMs = Number(getArg('timeout', 30000))

// Bbox volontairement serree autour de Roma Norte + Condesa/Hipodromo.
const MVP_BBOX = {
  south: 19.3955,
  west: -99.1905,
  north: 19.4265,
  east: -99.155,
}

const GENERIC_WORDS = new Set([
  'restaurante',
  'restaurant',
  'cafe',
  'cafeteria',
  'bar',
  'cocina',
  'comida',
  'taqueria',
  'tacos',
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

function inferColonia(place) {
  const tags = place.tags || {}
  const raw =
    tags['addr:neighbourhood'] ||
    tags['addr:suburb'] ||
    tags['is_in:neighbourhood'] ||
    tags['is_in:suburb'] ||
    ''
  const normalized = normalizeText(raw)

  if (normalized.includes('ROMA NORTE')) return 'ROMA NORTE'
  if (normalized.includes('HIPODROMO CONDESA')) return 'HIPODROMO CONDESA'
  if (normalized.includes('HIPODROMO')) return 'HIPODROMO'
  if (normalized.includes('CONDESA')) return 'CONDESA'

  // Fallback spatial grossier: le sud-ouest de la bbox correspond majoritairement
  // a Condesa/Hipodromo, le nord-est a Roma Norte.
  if (place.lat < 19.412 && place.lon < -99.165) return 'HIPODROMO'
  return 'ROMA NORTE'
}

function toRestaurantRow(place) {
  const tags = place.tags || {}
  const website = tags.website || tags['contact:website'] || null
  const phone = tags.phone || tags['contact:phone'] || null

  return {
    denue_id: `osm:${place.osmId}`,
    nombre: tags.name,
    codigo_scian: null,
    actividad: tags.amenity || 'restaurant',
    telefono: phone,
    correo_electronico: tags.email || tags['contact:email'] || null,
    sitio_web: website,
    instagram: tags['contact:instagram'] || null,
    facebook: tags['contact:facebook'] || null,
    tipo_vialidad: null,
    nom_vialidad: tags['addr:street'] || null,
    numero_exterior: tags['addr:housenumber'] || null,
    colonia: inferColonia(place),
    alcaldia: 'Cuauhtemoc',
    cp: tags['addr:postcode'] || null,
    latitud: place.lat,
    longitud: place.lon,
    osm_id: place.osmId,
    cuisine_type: tags.cuisine || null,
    horaires: tags.opening_hours || null,
    statut: 'actif',
    source: 'osm_mvp',
    notes: `Ajout OSM MVP. Amenity=${tags.amenity || 'n/a'}. Import automatique apres absence de match DENUE/curated dans ${radiusMeters}m.`,
  }
}

function hasWebsite(place) {
  const tags = place.tags || {}
  return Boolean(tags.website || tags['contact:website'] || tags.url)
}

function hasContact(place) {
  const tags = place.tags || {}
  return Boolean(
    tags.website ||
    tags['contact:website'] ||
    tags.url ||
    tags.phone ||
    tags['contact:phone'] ||
    tags.email ||
    tags['contact:email'] ||
    tags['contact:instagram'] ||
    tags.instagram ||
    tags['contact:facebook'] ||
    tags.facebook
  )
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
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      console.log(`Overpass: ${url}`)
      const res = await fetch(url, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'cdmx-restaurants-osm-mvp-gapfill/1.0',
        },
        signal: controller.signal,
      })

      if (!res.ok) {
        lastError = new Error(`Overpass ${url} HTTP ${res.status}: ${await res.text()}`)
        continue
      }

      const json = await res.json()
      return json.elements
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
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
      .select('id, denue_id, nombre, colonia, alcaldia, latitud, longitud, osm_id, source')
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

  return rows
}

function findBestMatch(place, restaurants) {
  let best = null

  for (const restaurant of restaurants) {
    if (!restaurant.latitud || !restaurant.longitud) continue

    const distance = haversineMeters(place.lat, place.lon, Number(restaurant.latitud), Number(restaurant.longitud))
    if (distance > radiusMeters) continue

    const nameScore = tokenScore(place.tags.name, restaurant.nombre)
    const exactOsm = restaurant.osm_id === place.osmId || restaurant.denue_id === `osm:${place.osmId}`
    const score = exactOsm ? 1 : (1 - distance / radiusMeters) * 0.45 + nameScore * 0.55

    if (!best || score > best.score) {
      best = { restaurant, distance, nameScore, score, exactOsm }
    }
  }

  return best
}

async function insertMissing(rows) {
  if (rows.length === 0) return

  const { error } = await supabase
    .from('restaurants')
    .upsert(rows, { onConflict: 'denue_id' })

  if (error) throw new Error(`Supabase upsert: ${error.message}`)
}

async function main() {
  console.log(`Mode: ${write ? 'ecriture Supabase' : 'dry-run'}`)
  console.log(`Rayon match: ${radiusMeters}m | nom minimum: ${minNameScore}`)

  console.log('Chargement OSM + Supabase...')
  const [osmElements, existingRestaurants] = await Promise.all([
    fetchOSMPlaces(),
    fetchExistingRestaurants(),
  ])
  console.log(`OSM bruts: ${osmElements.length} | restaurants existants bbox: ${existingRestaurants.length}`)

  const places = osmElements
    .map(element => ({
      osmId: `${element.type}/${element.id}`,
      lat: element.lat ?? element.center?.lat,
      lon: element.lon ?? element.center?.lon,
      tags: element.tags || {},
    }))
    .filter(place => place.lat && place.lon && place.tags.name)
    .slice(skip)
    .slice(0, limit || undefined)

  const missing = []
  let matched = 0
  let weak = 0

  for (const place of places) {
    const best = findBestMatch(place, existingRestaurants)
    const isMatch = best && (best.exactOsm || best.nameScore >= minNameScore || best.distance <= 18)

    if (isMatch) {
      matched++
      continue
    }

    weak += best ? 1 : 0
    if (onlyWithWebsite && !hasWebsite(place)) continue
    if (onlyWithContact && !hasContact(place)) continue

    missing.push(toRestaurantRow(place))
  }

  console.log(`OSM places exploitables: ${places.length}`)
  console.log(`Deja couverts/matches: ${matched}`)
  console.log(`Potentiels doublons faibles: ${weak}`)
  console.log(`Manquants candidats${onlyWithWebsite ? ' avec site' : onlyWithContact ? ' avec contact' : ''}: ${missing.length}`)

  for (const row of missing.slice(0, 40)) {
    console.log(`- ${row.nombre} | ${row.colonia} | ${row.sitio_web || 'sans site'} | ${row.denue_id}`)
  }

  if (write) {
    console.log(`Insertion/upsert Supabase: ${missing.length} lignes...`)
    await insertMissing(missing)
    console.log(`\nRestaurants OSM MVP upserted: ${missing.length}`)
  } else {
    console.log('\nDry-run seulement. Relancer avec --write pour inserer ces candidats.')
  }
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
