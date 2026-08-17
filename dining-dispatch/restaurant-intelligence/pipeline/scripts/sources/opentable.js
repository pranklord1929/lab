// OpenTable CDMX — Playwright. Navigate vers la page Mexico City restaurants,
// intercepter le call API (GraphQL ou listings REST), puis paginer en réutilisant
// auth + cookies du contexte browser.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { chromium } from 'playwright'

const SOURCE = 'opentable'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

// Page principale Mexico City sur OpenTable.com.mx (preference espagnole)
const CITY_URLS = [
  'https://www.opentable.com.mx/mexico-city-restaurants',
  'https://www.opentable.com/mexico-city-restaurants',
]

function normalizeRest(r) {
  // OpenTable Next.js listings exposent généralement :
  //   restaurantId / id, name, address: {line1, city, region, country},
  //   coordinates: {latitude, longitude}, phoneNumber, neighborhood,
  //   priceBand: {priceBandId, name}, statistics: {reviews: {…, allTimeTextReviewCount}, ratings: {overall: {…, rating}}},
  //   primaryCuisine: {name}, urls: {profileLink}, photos: [{small/large}]
  const id = r.restaurantId || r.id || r.profileId || r.coreRestaurantId
  const sourceId = id ? String(id) : (r.urls?.profileLink?.link?.split('/r/')[1]?.split('?')[0] || null)
  const addr = r.address || r.location || {}
  const coords = r.coordinates || r.geo || {}
  const stats = r.statistics || {}
  const rating = stats.ratings?.overall?.rating ?? stats.rating ?? r.rating ?? null
  const reviewCount = stats.reviews?.allTimeTextReviewCount ?? stats.reviews?.total ?? r.reviewCount ?? null

  const fullAddress = [addr.line1 || addr.address1, addr.city, addr.region, addr.country]
    .filter(Boolean).join(', ') || null

  return {
    source_id: sourceId,
    name: r.name || null,
    latitude: coords.latitude ?? coords.lat ?? null,
    longitude: coords.longitude ?? coords.lng ?? null,
    address: fullAddress,
    phone: r.phoneNumber || r.phone || null,
    website: r.urls?.profileLink?.link || null,
    payload: {
      neighborhood: r.neighborhood?.name || r.neighborhood || null,
      city: addr.city || null,
      region: addr.region || null,
      country: addr.country || null,
      cuisine: r.primaryCuisine?.name || r.cuisine || null,
      priceBand: r.priceBand?.name || r.priceBand || null,
      priceBandId: r.priceBand?.priceBandId ?? null,
      rating,
      reviewCount,
      averagePartySize: stats.bookings?.averagePartySize ?? null,
      bookingCount: stats.bookings?.recentReservationCount ?? null,
      profileLink: r.urls?.profileLink?.link || null,
      photo: r.primaryPhoto?.small || r.primaryPhoto?.large || r.photos?.[0]?.small || null,
      photos: (r.photos || []).slice(0, 5),
      source: SOURCE,
      raw: r,
    },
  }
}

function extractFromNextData(json) {
  // OpenTable utilise Next.js → __NEXT_DATA__.props.pageProps contient les listings
  const pp = json?.props?.pageProps || json?.pageProps || {}
  // Différents shapes possibles selon la page
  return (
    pp.initialState?.searchResults?.restaurants ||
    pp.windfall?.restaurants ||
    pp.restaurants ||
    pp.data?.restaurants ||
    []
  )
}

async function scrape() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-http2',
      '--no-sandbox',
    ],
  })
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'es-MX',
    extraHTTPHeaders: {
      'accept-language': 'es-MX,es;q=0.9,en;q=0.8',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    },
  })
  // Masquer webdriver
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    Object.defineProperty(navigator, 'languages', { get: () => ['es-MX', 'es', 'en'] })
  })
  const page = await ctx.newPage()

  // Capture la moindre API json qui passe
  const apiCalls = []
  let bootstrapPaging = null
  page.on('response', async (resp) => {
    const url = resp.url()
    if (!/opentable\./.test(url)) return
    const ct = resp.headers()['content-type'] || ''
    if (!ct.includes('json')) return
    if (!/listings|search|restaurant|graphql|dapi/.test(url)) return
    try {
      const json = await resp.json()
      apiCalls.push({ url, json })
      // candidate paging endpoints
      if (/dapi.*listings|listings\/category|search/.test(url) && !bootstrapPaging) {
        const req = resp.request()
        bootstrapPaging = {
          url, method: req.method(), headers: req.headers(), body: req.postData(),
        }
      }
    } catch {}
  })

  let landed = null
  for (const url of CITY_URLS) {
    console.error(`[${SOURCE}] navigate ${url}`)
    try {
      const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      if (r && r.ok()) { landed = url; break }
    } catch (e) {
      console.error('  failed:', e.message)
    }
  }
  if (!landed) {
    console.error('  no city URL reachable')
    await browser.close()
    return []
  }

  await page.waitForTimeout(8000)
  // scroll pour déclencher les loads suivants si pagination infinie
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 2500)
    await page.waitForTimeout(1500)
  }

  // 1) Tenter __NEXT_DATA__ inline du HTML
  const nextData = await page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__')
    return el ? JSON.parse(el.textContent) : null
  }).catch(() => null)

  const byId = new Map()
  let added

  if (nextData) {
    const fromNd = extractFromNextData(nextData)
    added = 0
    for (const r of fromNd || []) {
      const rec = normalizeRest(r)
      if (rec.source_id && rec.name) { byId.set(rec.source_id, rec); added++ }
    }
    console.error(`  __NEXT_DATA__ → ${fromNd?.length || 0} extracted (+${added})`)
  } else {
    console.error('  __NEXT_DATA__ absent ou non parsable')
  }

  // 2) Parcourir les API calls interceptés
  console.error(`  intercepted ${apiCalls.length} JSON API calls`)
  for (const { url, json } of apiCalls) {
    // chercher restaurants[] dans différents path
    const candidates = []
    function walk(obj, depth = 0) {
      if (depth > 6 || !obj || typeof obj !== 'object') return
      if (Array.isArray(obj)) {
        if (obj.length > 0 && obj[0] && typeof obj[0] === 'object' && (obj[0].name || obj[0].restaurantName) && (obj[0].restaurantId || obj[0].id || obj[0].coordinates || obj[0].address)) {
          candidates.push(obj)
          return
        }
        obj.forEach(x => walk(x, depth + 1))
        return
      }
      for (const k of Object.keys(obj)) walk(obj[k], depth + 1)
    }
    walk(json)
    for (const arr of candidates) {
      added = 0
      for (const r of arr) {
        const rec = normalizeRest(r)
        if (rec.source_id && rec.name) {
          if (!byId.has(rec.source_id)) added++
          byId.set(rec.source_id, rec)
        }
      }
      if (added > 0) console.error(`  ${url.slice(0, 80)} → +${added} (total ${byId.size})`)
    }
  }

  // 3) Si on a un bootstrapPaging, tenter de paginer
  if (bootstrapPaging && byId.size > 0 && byId.size < 2000) {
    console.error(`  attempting pagination via ${bootstrapPaging.url}`)
    let body = {}
    try { body = JSON.parse(bootstrapPaging.body || '{}') } catch {}
    let stopReason = null
    for (let pageNum = 2; pageNum <= 50; pageNum++) {
      // OpenTable utilise parfois page, parfois offset, parfois start
      const variants = [
        { ...body, page: pageNum },
        { ...body, pageNumber: pageNum },
        { ...body, offset: (pageNum - 1) * 50 },
        { ...body, start: (pageNum - 1) * 50 },
      ]
      let progressed = false
      for (const v of variants) {
        try {
          const resp = await page.request.post(bootstrapPaging.url, {
            headers: bootstrapPaging.headers, data: JSON.stringify(v),
          })
          if (!resp.ok()) continue
          const json = await resp.json()
          const before = byId.size
          function walk(obj, depth=0){
            if (depth>6||!obj||typeof obj!=='object') return
            if (Array.isArray(obj)){
              if (obj.length>0 && obj[0] && (obj[0].name||obj[0].restaurantName) && (obj[0].restaurantId||obj[0].id)) {
                for (const r of obj) { const rec=normalizeRest(r); if (rec.source_id && rec.name) byId.set(rec.source_id, rec) }
                return
              }
              obj.forEach(x=>walk(x,depth+1)); return
            }
            for (const k of Object.keys(obj)) walk(obj[k], depth+1)
          }
          walk(json)
          if (byId.size > before) { progressed = true; console.error(`  page ${pageNum} → +${byId.size - before} (total ${byId.size})`); break }
        } catch {}
      }
      if (!progressed) { stopReason = `no progress on page ${pageNum}`; break }
      await page.waitForTimeout(500)
    }
    if (stopReason) console.error(`  pagination stopped: ${stopReason}`)
  }

  await browser.close()
  return [...byId.values()]
}

async function main() {
  console.error(`[${SOURCE}] scrape…`)
  await mkdir(OUT_DIR, { recursive: true })
  const records = await scrape()
  await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
  console.error(`Écrit : ${OUT_FILE} (${records.length} records)`)
}

main().catch(e => { console.error(e); process.exit(1) })
