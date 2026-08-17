// Reservandonos public listing API -> immutable CDMX raw dump.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SOURCE = 'reservandonos'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)
const ENDPOINT = 'https://reservandonos.com/api/places-by-filter'
const CDMX_STATE_ID = 9
const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isCdmx(place) {
  const lat = number(place.position?.lat)
  const lon = number(place.position?.lng)
  return Number(place.position?.stateId) === CDMX_STATE_ID &&
    lat >= 19.15 && lat <= 19.65 && lon >= -99.40 && lon <= -98.90
}

function record(place) {
  const profile = `https://reservandonos.com/lugar/${place.url}`
  return {
    source_id: String(place.id),
    name: String(place.name || place.shortName || '').trim(),
    latitude: number(place.position?.lat),
    longitude: number(place.position?.lng),
    address: place.location || null,
    phone: null,
    website: profile,
    payload: {
      source: SOURCE,
      profile_url: profile,
      slug: place.url,
      categories: place.categories ? String(place.categories).split(',').map(v => v.trim()).filter(Boolean) : [],
      schedule: place.schedule || null,
      rating: number(place.score),
      price_range: place.price_range || null,
      image_url: place.image_url || null,
      logo_url: place.logo_url || null,
      has_delivery: Boolean(place.has_delivery),
      is_outstanding: Boolean(place.isOutstanding),
      benefits: place.withBenefits ? {
        short_title: place.defaultBenefitShortTitle || null,
        title: place.defaultBenefitTitle || null,
        description: place.defaultBenefitDescription || null,
        type: place.defaultBenefitType || null,
      } : null,
      location_ids: place.position || null,
      raw: place,
    },
  }
}

async function fetchPage(page) {
  const response = await fetch(`${ENDPOINT}?page=${page}&mode=web`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`page ${page}: HTTP ${response.status}`)
  return response.json()
}

const first = await fetchPage(1)
const lastPage = Math.min(Number(first.last_page) || 1, 100)
const byId = new Map()
for (const place of first.data || []) if (isCdmx(place)) byId.set(String(place.id), record(place))
console.log(`[${SOURCE}] ${lastPage} pages publiques; ${byId.size} CDMX sur page 1`)

for (let page = 2; page <= lastPage; page++) {
  const result = await fetchPage(page)
  for (const place of result.data || []) if (isCdmx(place)) byId.set(String(place.id), record(place))
  if (page % 10 === 0 || page === lastPage) console.log(`  page ${page}/${lastPage} — ${byId.size} CDMX`)
  await sleep(150)
}

const records = [...byId.values()].filter(row => row.name).sort((a, b) => a.name.localeCompare(b.name, 'es'))
await mkdir(OUT_DIR, { recursive: true })
await writeFile(OUT_FILE, `${JSON.stringify(records, null, 2)}\n`)
console.log(`Écrit : ${OUT_FILE} (${records.length} records)`)
