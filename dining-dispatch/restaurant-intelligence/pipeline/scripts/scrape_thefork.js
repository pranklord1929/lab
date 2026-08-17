// Scrape TheFork (ElTenedor) Mexico — plateforme réservations restaurants.
// Bonne couverture des restaurants upscale CDMX.
// Stratégie : API GraphQL interne + fallback HTML.
// Output : data/thefork_cdmx.json | Flag : --import

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { writeFile } from 'fs/promises'
import { resolve } from 'path'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const importDb = process.argv.includes('--import')
const OUTPUT = resolve('data/thefork_cdmx.json')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'es-MX,es;q=0.9',
}

// Zones CDMX sur TheFork (IDs de géolocalisation à tester)
const SEARCH_AREAS = [
  { name: 'México D.F.',   geoId: 103001, lat: 19.4326, lng: -99.1332 },
  { name: 'Polanco',       geoId: null,   lat: 19.4300, lng: -99.1960 },
  { name: 'Roma Norte',    geoId: null,   lat: 19.4183, lng: -99.1625 },
  { name: 'Condesa',       geoId: null,   lat: 19.4110, lng: -99.1750 },
]

// ─── Approche 1: API REST TheFork ─────────────────────────────────────────

async function fetchTheForkApi(lat, lng, page = 0) {
  const url = `https://api.thefork.com/restaurants/search?` + new URLSearchParams({
    latitude: lat,
    longitude: lng,
    radius: 2500,
    locale: 'es_MX',
    page,
    perPage: 30,
    sort: 'popularity',
  })

  const res = await fetch(url, { headers: { ...HEADERS, 'Accept': 'application/json' } }).catch(() => null)
  if (!res?.ok) return null
  return res.json().catch(() => null)
}

// ─── Approche 2: Playwright avec interception API ──────────────────────────

async function scrapeWithPlaywright() {
  console.log('Playwright → TheFork Mexico...')
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ userAgent: HEADERS['User-Agent'], locale: 'es-MX' })
  const page = await context.newPage()

  const apiCalls = []
  let graphqlEndpoint = null
  let sessionHeaders = {}

  page.on('response', async res => {
    const url = res.url()
    if (!url.includes('thefork') && !url.includes('eltenedor') && !url.includes('lafourchette')) return
    const ct = res.headers()['content-type'] || ''
    if (!ct.includes('json')) return

    try {
      const json = await res.json()
      const str = JSON.stringify(json)
      if (str.includes('"name"') && str.includes('"address"') && str.length > 1000) {
        apiCalls.push({ url, size: str.length, data: json })
        console.log('  API:', url.slice(0, 80), `(${str.length}b)`)
        await writeFile('/tmp/thefork_api_' + Date.now() + '.json', JSON.stringify({ url, data: json }, null, 2))
      }
    } catch {}

    const h = res.request().headers()
    if (h['authorization'] || h['x-api-key']) {
      sessionHeaders = {
        'authorization': h['authorization'],
        'x-api-key': h['x-api-key'],
        'content-type': h['content-type'],
        'origin': h['origin'],
        'referer': h['referer'],
      }
    }
    if (url.includes('graphql') || url.includes('search')) graphqlEndpoint = url
  })

  // Essayer les URLs TheFork Mexico
  const urls = [
    'https://www.thefork.com.mx/restaurante/a/mexico-dc103001~100/',
    'https://www.thefork.com.mx/restaurantes/ciudad-de-mexico',
    'https://www.eltenedor.com.mx/restaurante/a/ciudad-de-mexico',
    'https://www.thefork.com/restaurant/a/mexico-city-c103001',
  ]

  let restaurants = []
  for (const url of urls) {
    console.log(`\n  Trying: ${url}`)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      await sleep(4000)

      const html = await page.content()
      console.log(`  HTML: ${html.length} bytes | Title: ${await page.title()}`)

      // Extraire JSON-LD
      const jsonLdMatches = [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/gi)]
      const schemas = jsonLdMatches.map(m => { try { return JSON.parse(m[1]) } catch { return null } }).filter(Boolean)
      const restSchemas = schemas.filter(s => s?.['@type'] === 'Restaurant')
      console.log(`  JSON-LD restaurants: ${restSchemas.length}`)

      if (restSchemas.length > 0) {
        restaurants.push(...restSchemas.map(s => ({
          name: s.name,
          address: s.address?.streetAddress || '',
          neighborhood: s.address?.addressLocality,
          lat: s.geo?.latitude ? parseFloat(s.geo.latitude) : null,
          lon: s.geo?.longitude ? parseFloat(s.geo.longitude) : null,
          phone: s.telephone,
          cuisine: Array.isArray(s.servesCuisine) ? s.servesCuisine.join(', ') : s.servesCuisine,
          price: s.priceRange,
          rating: s.aggregateRating?.ratingValue,
          reviewCount: s.aggregateRating?.reviewCount,
          website: s.url?.includes('thefork') ? null : s.url,
          source: 'thefork',
        })))
      }

      // Chercher liens restaurants
      const links = await page.$$eval('a[href*="/restaurant/"], a[href*="/restaurante/"]', els =>
        els.map(el => ({ href: el.getAttribute('href'), text: el.textContent?.trim() })).filter(e => e.href)
      )
      console.log(`  Liens restaurants: ${links.length}`)
      if (links.length > 0) {
        console.log('  Sample:', links.slice(0,3).map(l => l.href).join(', '))
      }

      if (restaurants.length > 0 || apiCalls.length > 0) break
    } catch (e) {
      console.log(`  Erreur: ${e.message.slice(0,60)}`)
    }
  }

  // Extraire depuis les API calls interceptés
  for (const call of apiCalls) {
    const extracted = extractFromApiResponse(call.data)
    restaurants.push(...extracted)
  }

  await browser.close()
  return { restaurants, sessionHeaders, graphqlEndpoint }
}

function extractFromApiResponse(data) {
  const results = []
  const str = JSON.stringify(data)
  if (!str.includes('"name"') || !str.includes('"address"')) return results

  function walk(obj) {
    if (!obj || typeof obj !== 'object') return
    if (obj.name && (obj.address || obj.location) && (obj.rating || obj.cuisine || obj.priceRange)) {
      results.push({
        name: obj.name,
        address: obj.address?.formattedAddress || obj.address,
        lat: obj.location?.lat || obj.latitude,
        lon: obj.location?.lng || obj.longitude,
        cuisine: obj.cuisine || obj.cuisineType,
        price: obj.priceRange || obj.priceCategory,
        rating: obj.rating?.value || obj.averageRating,
        reviewCount: obj.reviewCount || obj.totalReviews,
        website: obj.website,
        source: 'thefork',
      })
    }
    Object.values(obj).forEach(v => { if (typeof v === 'object') walk(v) })
  }
  walk(data)
  return results
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('TheFork Mexico scraper | upscale CDMX')

  // Essayer d'abord l'API directe
  console.log('\nTentative API directe...')
  let directResults = []
  for (const area of SEARCH_AREAS) {
    const data = await fetchTheForkApi(area.lat, area.lng)
    if (data) {
      const rests = data.restaurants || data.items || data.data || []
      console.log(`  ${area.name}: ${rests.length} restaurants`)
      directResults.push(...rests.map(r => ({ ...r, searchArea: area.name, source: 'thefork' })))
    } else {
      console.log(`  ${area.name}: API directe non accessible`)
    }
    await sleep(500)
  }

  // Si API directe ne marche pas → Playwright
  const { restaurants: playwrightResults, sessionHeaders } = await scrapeWithPlaywright()

  // Merger les résultats
  const allMap = new Map()
  const all = [...directResults, ...playwrightResults]
  for (const r of all) {
    const key = (r.name || '').toLowerCase().trim()
    if (key && !allMap.has(key)) allMap.set(key, r)
  }

  const results = [...allMap.values()].filter(r => r.name)

  await writeFile(OUTPUT, JSON.stringify(results, null, 2))
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`Total TheFork: ${results.length} restaurants`)
  console.log(`Avec GPS: ${results.filter(r=>r.lat).length}`)
  console.log(`Avec rating: ${results.filter(r=>r.rating).length}`)
  console.log(`Export: ${OUTPUT}`)

  if (importDb && results.length > 0) {
    await importToSupabase(results)
  }

  if (results.length === 0) {
    console.log('\n⚠ Aucun restaurant trouvé — TheFork Mexico peut avoir une structure différente')
    console.log('Vérifie les fichiers /tmp/thefork_api_*.json pour les données brutes')
  }
}

async function importToSupabase(records) {
  console.log(`\nImport Supabase: ${records.length} restaurants TheFork...`)
  let ok = 0, enrich = 0, err = 0
  for (const r of records) {
    if (!r.name) continue
    const { data: existing } = await supabase.from('restaurants').select('id').ilike('nombre', r.name).limit(1)
    if (existing?.length > 0) {
      await supabase.from('restaurants').update({ sitio_web: r.website, cuisine_type: r.cuisine }).eq('id', existing[0].id)
      enrich++
    } else {
      const { error } = await supabase.from('restaurants').insert({
        nombre: r.name, latitud: r.lat, longitud: r.lon,
        sitio_web: r.website, cuisine_type: r.cuisine, source: 'thefork', statut: 'actif',
      })
      if (error) err++; else ok++
    }
  }
  console.log(`Nouveaux: ${ok} | Enrichis: ${enrich} | Erreurs: ${err}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
