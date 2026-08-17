// Michelin Guide CDMX via the public Algolia index exposed by guide.michelin.com.
// Writes normalized staging records to data/raw/michelin/<date>.json.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

// --all-mx : scrape tout le Mexique (pas seulement CDMX) → data/raw/michelin_mx/
const ALL_MX = process.argv.includes('--all-mx')

const SOURCE = ALL_MX ? 'michelin_mx' : 'michelin'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

const ALGOLIA_APP_ID = '8NVHRD7ONV'
const ALGOLIA_API_KEY = '3222e669cf890dc73fa5f38241117ba5'
const INDEX = 'prod-restaurants-es'
const ENDPOINT = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`
const MICHELIN_BASE = 'https://guide.michelin.com'

function absoluteMichelinUrl(path) {
  if (!path) return null
  return path.startsWith('http') ? path : `${MICHELIN_BASE}${path}`
}

function regionName(hit) {
  return typeof hit.region === 'string' ? hit.region : hit.region?.name
}

function cuisineLabel(cuisine) {
  if (!cuisine) return null
  return cuisine.label || cuisine.name || cuisine
}

function starsFromHit(hit) {
  const slug = hit.distinction?.slug || hit.michelin_star || ''
  if (slug.includes('3-estrella')) return 3
  if (slug.includes('2-estrella')) return 2
  if (slug.includes('1-estrella') || slug === 'ONE_STAR') return 1
  return 0
}

function normalizeHit(hit) {
  const path = hit.url || (hit.slug ? `/mx/es/restaurante/${hit.slug}` : hit.objectID)
  const michelinUrl = absoluteMichelinUrl(path)
  const address = [hit.street, hit.postcode, hit.city?.name, regionName(hit)].filter(Boolean).join(', ')
  const cuisine = Array.isArray(hit.cuisines)
    ? hit.cuisines.map(cuisineLabel).filter(Boolean).join(', ')
    : cuisineLabel(hit.cuisines)

  return {
    source_id: path,
    name: hit.name,
    latitude: hit._geoloc?.lat ?? null,
    longitude: hit._geoloc?.lng ?? null,
    address: address || null,
    phone: hit.phone || null,
    website: hit.website || null,
    payload: {
      name: hit.name,
      address: address || null,
      neighborhood: hit.city?.name || null,
      lat: hit._geoloc?.lat ?? null,
      lon: hit._geoloc?.lng ?? null,
      phone: hit.phone || null,
      website: hit.website || null,
      cuisine: cuisine || null,
      price: hit.price || hit.price_category?.label || null,
      review: hit.main_desc || null,
      distinction: hit.distinction?.label || null,
      michelinStars: starsFromHit(hit),
      bibGourmand: hit.distinction?.slug === 'bib-gourmand',
      greenStar: Boolean(hit.green_star),
      guideYear: hit.guide_year || null,
      michelinId: hit.identifier || hit.objectID || null,
      michelinPath: path,
      michelinUrl,
      bookingProvider: hit.booking_provider || null,
      bookingUrl: hit.booking_url || hit.original_booking_url || null,
      image: hit.image || hit.main_image?.url || null,
      images: hit.images || [],
      // Champs riches presents dans le hit Algolia, remontes pour exploitation directe
      chef: hit.chef || null,
      hoursOfOperation: hit.hours_of_operation || null,
      daysOpen: hit.days_open || null,
      mealTimes: Array.isArray(hit.meal_times) && hit.meal_times.length ? hit.meal_times : null,
      facilities: Array.isArray(hit.facilities)
        ? hit.facilities.map(f => f.label || f.slug).filter(Boolean)
        : null,
      delivery: hit.delivery ?? null,
      deliveryProvider: hit.delivery_provider || null,
      onlineBooking: hit.online_booking ?? null,
      offers: Array.isArray(hit.offers) && hit.offers.length ? hit.offers : null,
      distinctionScore: hit.distinction_score ?? null,
      newTable: hit.new_table ?? null,
      lastUpdated: hit.last_updated || null,
      source: SOURCE,
      raw: hit,
    },
  }
}

async function queryMichelin(page) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-algolia-api-key': ALGOLIA_API_KEY,
      'x-algolia-application-id': ALGOLIA_APP_ID,
      'content-type': 'application/json',
      'origin': MICHELIN_BASE,
      'referer': `${MICHELIN_BASE}/mx/es/mexico-city-region/restaurants`,
    },
    body: JSON.stringify({
      query: ALL_MX ? '' : 'Ciudad de México',
      hitsPerPage: 100,
      page,
      filters: 'sites:mx',
    }),
  })

  if (!res.ok) throw new Error(`Michelin Algolia HTTP ${res.status}`)
  return res.json()
}

async function scrape() {
  const records = new Map()
  let page = 0
  let nbPages = 1

  while (page < nbPages) {
    const json = await queryMichelin(page)
    nbPages = json.nbPages || 1

    for (const hit of json.hits || []) {
      if (hit.objectType !== 'RESTAURANT') continue
      if (hit.country?.code !== 'MX') continue
      if (!ALL_MX && regionName(hit) !== 'Ciudad de México') continue

      const record = normalizeHit(hit)
      if (record.name && record.source_id) records.set(record.source_id, record)
    }

    page += 1
  }

  return [...records.values()]
}

async function main() {
  console.log(`[${SOURCE}] scrape...`)
  const records = await scrape()
  console.log(`  ${records.length} records`)

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
  console.log(`Ecrit : ${OUT_FILE}`)
  console.log(`\nProchaine etape :`)
  console.log(`  node scripts/ingest.js --source=${SOURCE} --date=${TODAY} --dry`)
}

main().catch(e => { console.error(e); process.exit(1) })
