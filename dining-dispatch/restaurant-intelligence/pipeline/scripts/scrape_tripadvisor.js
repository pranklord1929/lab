// Scrape TripAdvisor CDMX avec Playwright (Cloudflare bloque le fetch classique).
// Playwright lance un vrai Chrome headless → passe la protection bot.
// Phase 1 : listing pages → collect URLs
// Phase 2 : detail pages → JSON-LD (nom, adresse, GPS, website, cuisine, prix)
// Output : data/tripadvisor_cdmx.json
// Flags : --pages=N (défaut 10), --import (upsert Supabase)

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { writeFile, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { resolve } from 'path'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const args = process.argv.slice(2)
const argSet = new Set(args)
const importDb = argSet.has('--import')
const maxPages = parseInt(args.find(a => a.startsWith('--pages='))?.split('=')[1] ?? '10')

const OUTPUT = resolve('data/tripadvisor_cdmx.json')
const CKPT   = resolve('data/tripadvisor_checkpoint_urls.json')
const BASE   = 'https://www.tripadvisor.com.mx'
const LIST_URL = `${BASE}/Restaurants-g150800-Mexico_City_Central_Mexico_and_Gulf_Coast.html`

const sleep = ms => new Promise(r => setTimeout(r, ms))

const TARGET_ZONES = [
  'polanco','lomas de chapultepec','lomas chapultepec',
  'roma norte','roma sur','condesa','hipodromo','hipódromo',
  'juarez','juárez',
  'san angel','san ángel',
  'coyoacan','coyoacán','del carmen',
  'napoles','nápoles','del valle',
]

function normalize(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')
}
function isTarget(text) {
  const n = normalize(text)
  return TARGET_ZONES.some(z => n.includes(normalize(z)))
}

function extractJsonLd(html) {
  const out = []
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    try { out.push(JSON.parse(m[1])) } catch { /* skip */ }
  }
  return out
}

function extractListingUrls(html) {
  const seen = new Set()
  const re = /href="(\/Restaurant_Review-g150800-d\d+-Reviews-[^"#?]+\.html)"/g
  let m
  while ((m = re.exec(html)) !== null) { seen.add(m[1]) }
  return [...seen]
}

function parseDetail(html, path) {
  const jsonLds = extractJsonLd(html)
  const schema  = jsonLds.find(d => d?.['@type'] === 'Restaurant')

  let name = schema?.name || null
  let address = null, neighborhood = null
  const phone = schema?.telephone || null
  let website = schema?.url || null
  let cuisine = null
  const priceRange = schema?.priceRange || null
  const lat = schema?.geo?.latitude  ? parseFloat(schema.geo.latitude)  : null
  const lon = schema?.geo?.longitude ? parseFloat(schema.geo.longitude) : null

  if (schema?.address) {
    const a = schema.address
    address = [a.streetAddress, a.addressLocality, a.postalCode].filter(Boolean).join(', ')
    neighborhood = a.addressLocality || null
  }

  if (schema?.servesCuisine) {
    cuisine = Array.isArray(schema.servesCuisine)
      ? schema.servesCuisine.join(', ')
      : schema.servesCuisine
  }

  if (!name) {
    const m = html.match(/<h1[^>]*>([^<]{3,80})<\/h1>/)
    if (m) name = m[1].trim()
  }

  // Si le site web est un lien TripAdvisor (redirect), on l'ignore
  if (website?.includes('tripadvisor')) website = null

  // Chercher un lien externe dans le HTML (class ou data-url sur bouton "Visiter le site")
  if (!website) {
    const extMatch = html.match(/data-encoded-url="([^"]+)"/)
      || html.match(/(?:website|sitio)[^>]*href="(https?:\/\/(?!www\.tripadvisor)[^"]+)"/i)
    if (extMatch) website = decodeURIComponent(extMatch[1])
  }

  const ratingM = html.match(/"ratingValue"\s*:\s*"?([\d.]+)"?/)
  const rating  = ratingM ? parseFloat(ratingM[1]) : null

  const reviewM = html.match(/"reviewCount"\s*:\s*"?(\d+)"?/)
  const reviewCount = reviewM ? parseInt(reviewM[1]) : null

  const zoneText = [name, address, neighborhood].join(' ')
  const inTarget = isTarget(zoneText)

  return { name, address, neighborhood, phone, website, cuisine, priceRange, lat, lon, rating, reviewCount, inTarget, tripadvisorUrl: `${BASE}${path}` }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`TripAdvisor CDMX | Playwright headless | ${maxPages} pages (~${maxPages*30} restaurants)`)
  console.log(`Import DB : ${importDb ? 'OUI' : 'NON (ajouter --import)'}`)
  console.log('')

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'es-MX',
    viewport: { width: 1366, height: 768 },
  })
  const page = await context.newPage()

  // Masquer les traces d'automatisation
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  })

  let restaurantUrls = []

  // ── Phase 1 : listing ──
  if (existsSync(CKPT)) {
    restaurantUrls = JSON.parse(await readFile(CKPT, 'utf8'))
    console.log(`Checkpoint restauré : ${restaurantUrls.length} URLs\n`)
  } else {
    console.log('Phase 1 — Pages listing\n')
    const urlSet = new Set()

    for (let p = 0; p < maxPages; p++) {
      const offset = p * 30
      const url = p === 0 ? LIST_URL : LIST_URL.replace('.html', `-oa${offset}.html`)
      process.stdout.write(`  [${p+1}/${maxPages}] offset ${offset} ... `)

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await sleep(3000)  // laisser JS charger

        const html = await page.content()
        const links = extractListingUrls(html)
        links.forEach(l => urlSet.add(l))
        console.log(`+${links.length} (total: ${urlSet.size})`)
      } catch (e) {
        console.log(`ECHEC (${e.message.slice(0,40)})`)
      }

      await sleep(2000 + Math.random() * 2000)
    }

    restaurantUrls = [...urlSet]
    await writeFile(CKPT, JSON.stringify(restaurantUrls, null, 2))
    console.log(`\n→ ${restaurantUrls.length} URLs collectées\n`)
  }

  // ── Phase 2 : pages détail ──
  console.log(`Phase 2 — Pages détail (${restaurantUrls.length} restaurants)\n`)
  const results = []

  for (let i = 0; i < restaurantUrls.length; i++) {
    const path = restaurantUrls[i]
    process.stdout.write(`[${i+1}/${restaurantUrls.length}] `)

    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await sleep(2000)
      const html = await page.content()
      const data = parseDetail(html, path)
      results.push(data)

      const z    = data.inTarget ? '★' : '·'
      const name = (data.name || '?').slice(0, 38).padEnd(38)
      const info = [data.cuisine?.slice(0,20), data.priceRange, data.rating ? `★${data.rating}` : ''].filter(Boolean).join(' ')
      console.log(`${z} ${name} ${info}`)
    } catch (e) {
      console.log(`ECHEC`)
    }

    await sleep(2500 + Math.random() * 2000)
  }

  await browser.close()
  await writeFile(OUTPUT, JSON.stringify(results, null, 2))

  const target   = results.filter(r => r.inTarget)
  const withSite = results.filter(r => r.website)
  const withGps  = results.filter(r => r.lat)

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Total scrapés     : ${results.length}`)
  console.log(`Dans zones cibles : ${target.length}`)
  console.log(`Avec site web     : ${withSite.length}`)
  console.log(`Avec GPS          : ${withGps.length}`)
  console.log(`Export            : ${OUTPUT}`)

  if (importDb && target.length > 0) {
    await importToSupabase(target)
  } else {
    console.log(`\nRelancer avec --import pour upserter ${target.length} records en base.`)
  }
}

async function importToSupabase(records) {
  console.log(`\nImport Supabase : ${records.length} restaurants TripAdvisor...`)
  let ok = 0, enrich = 0, err = 0

  for (const r of records) {
    if (!r.name) continue
    const { data: existing } = await supabase.from('restaurants').select('id, sitio_web, cuisine_type').ilike('nombre', r.name).limit(1)

    if (existing?.length > 0) {
      const patch = {}
      if (r.website && !existing[0].sitio_web) patch.sitio_web = r.website
      if (r.cuisine && !existing[0].cuisine_type) patch.cuisine_type = r.cuisine
      if (r.lat) { patch.latitud = r.lat; patch.longitud = r.lon }
      if (Object.keys(patch).length > 0) await supabase.from('restaurants').update(patch).eq('id', existing[0].id)
      enrich++
    } else {
      const { error } = await supabase.from('restaurants').insert({
        nombre: r.name, sitio_web: r.website, telefono: r.phone,
        cuisine_type: r.cuisine, gamme_prix: r.priceRange,
        latitud: r.lat, longitud: r.lon, colonia: r.neighborhood,
        source: 'tripadvisor', statut: 'actif',
      })
      if (error) err++
      else ok++
    }
  }

  console.log(`Nouveaux : ${ok} | Enrichis : ${enrich} | Erreurs : ${err}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
