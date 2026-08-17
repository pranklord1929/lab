// Resy CDMX — Playwright pour bootstrap du contexte (Imperva / cookies),
// puis pagination via page.evaluate() qui réutilise auth + cookies de la session.
// 1er call POST /3/venuesearch/search expose 926 venues / 47 pages.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { chromium } from 'playwright'

const SOURCE = 'resy'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)
const CITY_URL = 'https://resy.com/cities/mexico-city-mexico/search'

function normalizeHit(h) {
  const id = h.id?.resy ?? h.id ?? h.objectID
  const sourceId = id ? String(id) : (h.url_slug || null)
  const loc = h.location || {}
  const address = [loc.address_1, loc.locality, loc.region].filter(Boolean).join(', ') || null
  const cuisine = Array.isArray(h.cuisine) ? h.cuisine.filter(Boolean).join(', ') : null
  return {
    source_id: sourceId,
    name: h.name || null,
    latitude: h._geoloc?.lat ?? null,
    longitude: h._geoloc?.lng ?? null,
    address,
    phone: h.contact?.phone_number || null,
    website: h.website || null,
    payload: {
      slug: h.url_slug || null,
      neighborhood: h.neighborhood?.name || null,
      locality: h.locality?.name || null,
      region: h.region?.name || null,
      cuisine: cuisine || null,
      cuisines: h.cuisine || [],
      priceRangeId: h.price_range_id || null,
      currency: h.currency_code || null,
      rating: h.rating?.average ?? null,
      ratingCount: h.rating?.count ?? null,
      maxPartySize: h.max_party_size || null,
      isGlobalDiningAccess: h.is_global_dining_access || false,
      hasAvailability: Array.isArray(h.availability?.slots) && h.availability.slots.length > 0,
      reopen: h.reopen || null,
      collections: h.collections || [],
      image: h.images?.[0] || null,
      images: h.images || [],
      resyUrl: h.url_slug ? `https://resy.com/cities/mexico-city-mexico/venues/${h.url_slug}` : null,
      source: SOURCE,
      raw: h,
    },
  }
}

async function scrape() {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  })
  const page = await ctx.newPage()

  let bootstrap = null  // { url, method, headers, body }
  page.on('request', (req) => {
    const url = req.url()
    if (bootstrap) return
    if (!/\/3\/venuesearch\/search/.test(url)) return
    bootstrap = {
      url,
      method: req.method(),
      headers: req.headers(),
      body: req.postData(),
    }
  })

  console.error(`[${SOURCE}] navigate ${CITY_URL}`)
  await page.goto(CITY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(8000)

  if (!bootstrap) {
    console.error('  no venuesearch call captured, abort')
    await browser.close()
    return []
  }

  console.error(`  bootstrap captured: ${bootstrap.method} ${bootstrap.url}`)

  // Décrypter et remplacer la pagination dans le body
  let bodyObj
  try { bodyObj = JSON.parse(bootstrap.body || '{}') } catch { bodyObj = {} }
  console.error('  body keys:', Object.keys(bodyObj))

  const venuesById = new Map()
  let nbPages = 1

  for (let pageNum = 1; pageNum <= nbPages; pageNum++) {
    bodyObj.page = pageNum
    const resp = await page.request.post(bootstrap.url, {
      headers: bootstrap.headers,
      data: JSON.stringify(bodyObj),
    })
    if (!resp.ok()) {
      console.error(`  page ${pageNum} HTTP ${resp.status()}, stop`)
      break
    }
    const json = await resp.json()
    const hits = json.search?.hits || []
    nbPages = json.search?.nbPages || 1
    const before = venuesById.size
    for (const h of hits) {
      const rec = normalizeHit(h)
      if (rec.source_id && rec.name) venuesById.set(rec.source_id, rec)
    }
    console.error(`  page ${pageNum}/${nbPages} → ${hits.length} hits (+${venuesById.size - before} new, total ${venuesById.size}/${json.search?.nbHits || '?'})`)
    await page.waitForTimeout(400)
  }

  await browser.close()
  return [...venuesById.values()]
}

async function main() {
  console.error(`[${SOURCE}] scrape…`)
  await mkdir(OUT_DIR, { recursive: true })
  const records = await scrape()
  await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
  console.error(`Écrit : ${OUT_FILE} (${records.length} records)`)
}

main().catch(e => { console.error(e); process.exit(1) })
