// Scrape l'API interne de Rappi pour tous les restaurants CDMX upscale.
// Stratégie : Playwright une fois pour capturer le Bearer token,
// puis POST direct sur l'API catalog-paged avec différents lat/lng par quartier.
// L'API renvoie 50 restaurants par page, on pagine via "page" dans le body.
// Output : data/rappi_cdmx.json
// Flags : --import (upsert Supabase)

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { writeFile } from 'fs/promises'
import { resolve } from 'path'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const args = new Set(process.argv.slice(2))
const importDb = args.has('--import')
const OUTPUT = resolve('data/rappi_cdmx.json')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const API_URL = 'https://services.mxgrability.rappi.com/api/restaurant-bus/stores/catalog-paged/home'

// Quartiers upscale CDMX — coordonnées GPS au cœur de chaque zone
const NEIGHBORHOODS = [
  { name: 'Roma Norte',     lat: 19.4183, lng: -99.1625 },
  { name: 'Condesa',        lat: 19.4110, lng: -99.1750 },
  { name: 'Polanco',        lat: 19.4300, lng: -99.1960 },
  { name: 'Juárez',         lat: 19.4230, lng: -99.1600 },
  { name: 'San Ángel',      lat: 19.3470, lng: -99.1860 },
  { name: 'Coyoacán',       lat: 19.3460, lng: -99.1610 },
  { name: 'Nápoles',        lat: 19.3950, lng: -99.1770 },
  { name: 'Lomas Chapultepec', lat: 19.4250, lng: -99.2200 },
]

// ─── Step 1 : récupérer le Bearer token via Playwright ────────────────────────

async function getToken() {
  console.log('Lancement Playwright pour obtenir le Bearer token...')
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'es-MX',
  })

  let token = null
  let extraHeaders = {}

  page.on('request', req => {
    if (req.url().includes('catalog-paged')) {
      const h = req.headers()
      token = h['authorization']
      extraHeaders = {
        'app-version-name': h['app-version-name'] || '1.162.2',
        'app-version':      h['app-version'] || '1.162.2',
        'deviceid':         h['deviceid'] || 'cdmx-scraper-001',
      }
    }
  })

  await page.goto('https://www.rappi.com.mx/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(2000)

  // Entrer une adresse pour déclencher le chargement des restaurants
  const input = await page.$('[placeholder*="irección"], input[type="text"]').catch(() => null)
  if (input) {
    await input.click()
    await input.fill('Álvaro Obregón 100, Roma Norte, CDMX')
    await sleep(1500)
    await page.keyboard.press('Enter')
    await sleep(2500)
  }

  await page.goto('https://www.rappi.com.mx/restaurantes', { waitUntil: 'networkidle', timeout: 35000 })
  await sleep(3000)

  await browser.close()

  if (!token) throw new Error('Bearer token non trouvé — relancer le script')
  console.log(`Token obtenu : ${token.slice(0, 40)}...`)
  return { token, extraHeaders }
}

// ─── Step 2 : POST vers l'API catalog-paged ───────────────────────────────────

async function fetchPage(token, extraHeaders, lat, lng, page) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept': 'application/json',
      'Accept-Language': 'es-MX',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Referer': 'https://www.rappi.com.mx/',
      'Origin': 'https://www.rappi.com.mx',
      ...extraHeaders,
    },
    body: JSON.stringify({
      lat,
      lng,
      store_type: 'restaurant',
      states: ['opened', 'unavailable', 'closed'],
      prime_config: {},
      page,
    }),
  })

  if (!res.ok) return null
  return await res.json().catch(() => null)
}

// ─── Step 3 : nettoyer un store Rappi ─────────────────────────────────────────

function cleanStore(raw, neighborhood) {
  const [lng, lat] = raw.location || [null, null]
  return {
    rappiId: raw.store_id,
    name: raw.name || raw.brand_name || null,
    brandName: raw.brand_name || null,
    address: raw.address || null,
    lat: lat || null,
    lon: lng || null,
    rating: raw.rating?.score || null,
    reviewCount: raw.rating?.total_reviews || null,
    avgPrice: raw.avg_price > 0 ? raw.avg_price : null,
    schedules: raw.schedules || [],
    friendlyUrl: raw.friendly_url?.friendly_url || null,
    rappiUrl: raw.friendly_url?.friendly_url
      ? `https://www.rappi.com.mx/restaurantes/${raw.friendly_url.friendly_url}`
      : null,
    isOpen: raw.is_currently_available || false,
    neighborhood,
    source: 'rappi',
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Rappi CDMX scraper | ${NEIGHBORHOODS.length} quartiers`)
  console.log(`Import DB : ${importDb ? 'OUI (--import)' : 'NON'}`)
  console.log('')

  const { token, extraHeaders } = await getToken()
  console.log('')

  const seen = new Map()   // store_id → données
  let totalPages = 0

  for (const zone of NEIGHBORHOODS) {
    console.log(`\n[${zone.name}] lat=${zone.lat} lng=${zone.lng}`)

    let page = 1
    let emptyStreak = 0       // pages consécutives sans nouveau restaurant
    const MAX_EMPTY = 3       // stopper après 3 pages vides consécutives

    while (emptyStreak < MAX_EMPTY) {
      const data = await fetchPage(token, extraHeaders, zone.lat, zone.lng, page)

      if (!data || !data.stores || data.stores.length === 0) break

      let newCount = 0
      for (const store of data.stores) {
        if (!seen.has(store.store_id)) {
          seen.set(store.store_id, cleanStore(store, zone.name))
          newCount++
        }
      }

      totalPages++
      process.stdout.write(`  page ${page}: ${data.stores.length} stores (${newCount} nouveaux, total unique: ${seen.size})\n`)

      if (newCount === 0) emptyStreak++
      else emptyStreak = 0

      // Si la page retourne moins de 50 stores, c'est la dernière page
      if (data.stores.length < 50) break
      page++
      await sleep(400)
    }
  }

  const results = [...seen.values()]

  // Stats
  const withGps     = results.filter(r => r.lat)
  const withRating  = results.filter(r => r.rating)
  const withUrl     = results.filter(r => r.rappiUrl)
  const withHours   = results.filter(r => r.schedules.length > 0)
  const open        = results.filter(r => r.isOpen)

  await writeFile(OUTPUT, JSON.stringify(results, null, 2))

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Total pages API   : ${totalPages}`)
  console.log(`Restaurants uniques : ${results.length}`)
  console.log(`Avec GPS          : ${withGps.length}`)
  console.log(`Avec rating       : ${withRating.length}`)
  console.log(`Avec URL Rappi    : ${withUrl.length}`)
  console.log(`Avec horaires     : ${withHours.length}`)
  console.log(`Actuellement ouverts : ${open.length}`)
  console.log(`Export            : ${OUTPUT}`)

  // Sample
  console.log('\nÉchantillon :')
  results.slice(0, 8).forEach(r => {
    console.log(`  ${r.name?.slice(0,40).padEnd(40)} | ${r.address?.slice(0,35) || '—'} | ★${r.rating || '?'}`)
  })

  if (importDb) {
    await importToSupabase(results)
  } else {
    console.log(`\nRelancer avec --import pour upserter ${results.length} restaurants.`)
  }
}

// ─── Import Supabase ──────────────────────────────────────────────────────────

async function importToSupabase(records) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Import Supabase : ${records.length} restaurants Rappi...`)
  let newCount = 0, enriched = 0, errs = 0

  for (const r of records) {
    if (!r.name) continue

    // Chercher par nom exact (insensible à la casse)
    const { data: existing } = await supabase
      .from('restaurants')
      .select('id, sitio_web, cuisine_type, latitud')
      .ilike('nombre', r.name)
      .limit(1)

    if (existing?.length > 0) {
      const patch = {}
      if (r.lat && !existing[0].latitud) { patch.latitud = r.lat; patch.longitud = r.lon }
      if (Object.keys(patch).length > 0) {
        await supabase.from('restaurants').update(patch).eq('id', existing[0].id)
      }
      enriched++
    } else {
      const { error } = await supabase.from('restaurants').insert({
        nombre: r.name,
        latitud: r.lat,
        longitud: r.lon,
        colonia: r.neighborhood,
        source: 'rappi',
        statut: 'actif',
        verified_open: r.isOpen || false,
      })
      if (error) { errs++ }
      else { newCount++ }
    }
  }

  console.log(`Nouveaux : ${newCount} | Enrichis : ${enriched} | Erreurs : ${errs}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
