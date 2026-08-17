// =============================================================================
// Foursquare Places API source.
//
// Produit data/raw/foursquare/<YYYY-MM-DD>.json, puis ingestion via:
//   npm run ingest -- --source=foursquare --date=<YYYY-MM-DD>
// =============================================================================

import 'dotenv/config'
import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'foursquare'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

const API_KEY = process.env.FOURSQUARE_API_KEY || process.env.FSQ_API_KEY
const API_URL = 'https://places-api.foursquare.com/places/search'
const API_VERSION = process.env.FOURSQUARE_API_VERSION || '2025-06-17'

// Foursquare new-API category IDs.
// 4d4b7105d754a06374d81259 = Food (parent : restaurants)
// 4d4b7105d754a06376d81259 = Nightlife Spot (parent : bars, cantinas, cafés)
const FOOD_CATEGORY_IDS = '4d4b7105d754a06374d81259,4d4b7105d754a06376d81259'
const REQUEST_DELAY_MS = Number(process.env.FOURSQUARE_DELAY_MS || 250)
const LIMIT = Number(process.env.FOURSQUARE_LIMIT || 50)
const TILE_STEP_DEGREES = Number(process.env.FOURSQUARE_TILE_STEP_DEGREES || 0.035)
const MAX_TILES = process.env.FOURSQUARE_MAX_TILES
  ? Number(process.env.FOURSQUARE_MAX_TILES)
  : null

const CDMX_BBOX = {
  sw: { latitude: 19.047, longitude: -99.365 },
  ne: { latitude: 19.592, longitude: -98.940 },
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function formatPoint(point) {
  return `${point.latitude},${point.longitude}`
}

function buildTiles(bbox) {
  const tiles = []
  for (let south = bbox.sw.latitude; south < bbox.ne.latitude; south += TILE_STEP_DEGREES) {
    const north = Math.min(south + TILE_STEP_DEGREES, bbox.ne.latitude)
    for (let west = bbox.sw.longitude; west < bbox.ne.longitude; west += TILE_STEP_DEGREES) {
      const east = Math.min(west + TILE_STEP_DEGREES, bbox.ne.longitude)
      tiles.push({
        sw: { latitude: Number(south.toFixed(6)), longitude: Number(west.toFixed(6)) },
        ne: { latitude: Number(north.toFixed(6)), longitude: Number(east.toFixed(6)) },
      })
    }
  }
  return MAX_TILES ? tiles.slice(0, MAX_TILES) : tiles
}

function normalizeRecord(place) {
  return {
    source_id: place.fsq_place_id,
    name: place.name,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
    address: place.location?.formatted_address || place.location?.address || null,
    phone: place.tel || null,
    website: place.website || null,
    payload: place,
  }
}

async function fetchTile(tile, index, total) {
  const params = new URLSearchParams({
    fsq_category_ids: FOOD_CATEGORY_IDS,
    limit: String(Math.min(Math.max(LIMIT, 1), 50)),
    sort: 'POPULARITY',
    sw: formatPoint(tile.sw),
    ne: formatPoint(tile.ne),
  })

  const res = await fetch(`${API_URL}?${params}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${API_KEY}`,
      'X-Places-Api-Version': API_VERSION,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Foursquare ${res.status} on tile ${index}/${total}: ${body.slice(0, 500)}`)
  }

  const json = await res.json()
  return json.results || []
}

async function scrape() {
  if (!API_KEY) {
    throw new Error('Missing FOURSQUARE_API_KEY or FSQ_API_KEY in environment')
  }

  const tiles = buildTiles(CDMX_BBOX)
  const byId = new Map()

  for (let i = 0; i < tiles.length; i++) {
    const places = await fetchTile(tiles[i], i + 1, tiles.length)
    for (const place of places) {
      if (place.fsq_place_id && place.name) byId.set(place.fsq_place_id, place)
    }

    process.stdout.write(`[${SOURCE}] tile ${i + 1}/${tiles.length} -> ${byId.size} unique\r`)
    if (REQUEST_DELAY_MS > 0 && i < tiles.length - 1) await sleep(REQUEST_DELAY_MS)
  }
  process.stdout.write('\n')

  return Array.from(byId.values()).map(normalizeRecord)
}

async function main() {
  console.log(`[${SOURCE}] scrape...`)
  const records = await scrape()
  console.log(`  ${records.length} records`)

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
  console.log(`Écrit : ${OUT_FILE}`)
  console.log('\nProchaine étape :')
  console.log(`  npm run ingest -- --source=${SOURCE} --date=${TODAY}`)
}

main().catch(e => { console.error(e); process.exit(1) })
