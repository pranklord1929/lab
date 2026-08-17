// Scrape Uber Eats CDMX — même stratégie que Rappi :
// 1. Playwright intercepte le token + endpoint API
// 2. POST direct sur l'API pour chaque quartier
// 3. Pour chaque restaurant, récupère le menu via l'endpoint store
// Output : data/ubereats_cdmx.json | Flag : --import

import { chromium } from 'playwright'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import 'dotenv/config'
import { distanceMeters, nameSimilarity, normalizeName } from './lib/normalize.js'

const importDb = process.argv.includes('--import')
const withMenus = process.argv.includes('--menus')
const targetMissing = process.argv.includes('--target-missing')
const multiSession = process.argv.includes('--multi-session')
const OUTPUT = resolve('data/ubereats_cdmx.json')
const TODAY = new Date().toISOString().slice(0, 10)
const RAW_DIR = resolve('data/raw/ubereats')
const RAW_OUTPUT = resolve(RAW_DIR, `${TODAY}.json`)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const NEIGHBORHOODS = [
  { name: 'Roma Norte',        lat: 19.4183, lng: -99.1625, address:'Álvaro Obregón 51, Roma Norte, Ciudad de México' },
  { name: 'Condesa',           lat: 19.4110, lng: -99.1750, address:'Avenida Tamaulipas 50, Condesa, Ciudad de México' },
  { name: 'Polanco',           lat: 19.4300, lng: -99.1960, address:'Avenida Presidente Masaryk 111, Polanco, Ciudad de México' },
  { name: 'Juárez',            lat: 19.4230, lng: -99.1600, address:'Calle Havre 15, Juárez, Ciudad de México' },
  { name: 'San Ángel',         lat: 19.3470, lng: -99.1860, address:'Avenida de la Paz 32, San Ángel, Ciudad de México' },
  { name: 'Coyoacán',          lat: 19.3460, lng: -99.1610, address:'Ignacio Allende 36, Coyoacán, Ciudad de México' },
  { name: 'Nápoles',           lat: 19.3950, lng: -99.1770, address:'Avenida Insurgentes Sur 686, Nápoles, Ciudad de México' },
  { name: 'Lomas Chapultepec', lat: 19.4250, lng: -99.2200, address:'Paseo de las Palmas 215, Lomas de Chapultepec, Ciudad de México' },
]

// ─── Step 1: Intercepter le token Uber Eats ────────────────────────────────

async function getSession(address = NEIGHBORHOODS[0].address) {
  console.log('Playwright → capture session Uber Eats...')
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
    locale: 'es-MX',
    viewport: { width: 1440, height: 900 },
  })
  const page = await context.newPage()

  let session = { token: null, csrfToken: null, apiBase: null, feedBody: null, storeHeaders: {} }
  let foundFeed = false

  page.on('request', async req => {
    const url = req.url()
    const h = req.headers()
    const auth = h['authorization'] || h['x-csrf-jwt']
    if (auth) session.token = auth

    if (url.includes('getFeed') || url.includes('getHomeFeed') || url.includes('feed')) {
      if (!foundFeed && req.method() === 'POST') {
        try {
          const body = req.postData()
          if (body) {
            session.feedBody = JSON.parse(body)
            session.apiBase = url.replace(/\/[^/]+$/, '')
            session.feedEndpoint = url
            session.storeHeaders = {
              'x-csrf-jwt': h['x-csrf-jwt'] || '',
              'content-type': h['content-type'] || 'application/json',
              'x-uber-client-gitref': h['x-uber-client-gitref'] || '',
              'origin': h['origin'] || 'https://www.ubereats.com',
              'referer': h['referer'] || 'https://www.ubereats.com',
            }
            foundFeed = true
            console.log('  Feed endpoint:', url)
          }
        } catch {}
      }
    }
  })

  // Naviguer sur Uber Eats Mexico
  await page.goto('https://www.ubereats.com/mx', { waitUntil: 'domcontentloaded', timeout: 35000 })
  await sleep(3000)

  // Entrer une adresse
  const input = await page.$('input[placeholder*="irección"], input[placeholder*="delivery"], input[type="text"]')
  if (input) {
    await input.click()
    await page.keyboard.type(address, { delay: 20 })
    await sleep(3000)
    const sug = await page.$('[data-baseweb="menu"] li:first-child, [role="option"]:first-child')
    if (sug) { await sug.click(); console.log('  Adresse sélectionnée') }
    else { await page.keyboard.press('ArrowDown'); await sleep(300); await page.keyboard.press('Enter') }
    await sleep(4000)
  }

  // Naviguer vers la liste des restaurants
  // networkidle ne se declenche jamais (la page stream en continu) → domcontentloaded + pause
  await page.goto('https://www.ubereats.com/mx/category/restaurants', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(8000)

  // Récupérer cookies pour session
  const cookies = await context.cookies()
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')
  session.cookies = cookieStr
  // L'API web Uber Eats accepte le litteral "x" comme csrf token (quirk connu)
  session.allHeaders = { ...session.storeHeaders, 'cookie': cookieStr, 'x-csrf-token': 'x' }

  await browser.close()
  return session
}

// ─── Step 2: Appels API directs ────────────────────────────────────────────

async function fetchRestaurants(session, lat, lng) {
  if (!session.feedEndpoint) return []

  const body = structuredClone(session.feedBody || {})
  // 2026 feed requests use targetLocation; older variants used userLocation.
  // Rewrite every coordinate pair so each neighborhood actually changes feed.
  function rewrite(value) {
    if (!value || typeof value !== 'object') return
    if ('latitude' in value && 'longitude' in value) {
      value.latitude = lat
      value.longitude = lng
    }
    for (const child of Object.values(value)) rewrite(child)
  }
  rewrite(body)
  body.targetLocation = { ...(body.targetLocation || {}), latitude: lat, longitude: lng }
  body.userLocation = { latitude: lat, longitude: lng }
  body.localeCode = 'es-MX'
  body.marketplaces = ['restaurants']

  const res = await fetch(session.feedEndpoint, {
    method: 'POST',
    headers: { ...session.allHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(e => { console.log(`  [debug] fetch feed: ${e.message}`); return null })

  if (!res || !res.ok) {
    if (res) console.log(`  [debug] feed HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
    return []
  }

  const json = await res.json().catch(() => null)
  if (!json) { console.log('  [debug] reponse non-JSON'); return [] }
  console.log(`  [debug] cles reponse: ${Object.keys(json).join(', ').slice(0, 150)} | taille: ${JSON.stringify(json).length}`)
  if (process.env.UE_DEBUG_DUMP && !globalThis.__ueDumped) {
    globalThis.__ueDumped = true
    const { writeFileSync } = await import('fs')
    writeFileSync('data/processed/ubereats_feed_debug.json', JSON.stringify(json, null, 2))
    console.log('  [debug] reponse dumpee dans data/processed/ubereats_feed_debug.json')
  }

  // Extraire les restaurants de la réponse Uber Eats
  const stores = []
  const str = JSON.stringify(json)

  // Uber Eats peut utiliser différentes structures
  function findStores(obj) {
    if (!obj || typeof obj !== 'object') return
    // Ancien format : uuid + title string. Nouveau format (2026) : storeUuid + title.text
    if (obj.uuid && obj.title && (obj.location || obj.heroImageUrl)) {
      stores.push(obj)
    } else if (obj.storeUuid && (obj.title?.text || typeof obj.title === 'string')) {
      stores.push(obj)
    }
    for (const v of Object.values(obj)) {
      if (typeof v === 'object') findStores(v)
    }
  }
  findStores(json)

  return stores
}

async function fetchMenu(session, storeUuid) {
  if (!storeUuid || !session.feedEndpoint) return null

  // Meme chemin moderne que le feed : POST /_p/api/getStoreV1 avec body JSON
  const menuUrl = 'https://www.ubereats.com/_p/api/getStoreV1?localeCode=mx'
  const res = await fetch(menuUrl, {
    method: 'POST',
    headers: { ...session.allHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ storeUuid, diningMode: 'DELIVERY' }),
  }).catch(() => null)

  if (!res?.ok) {
    if (res && process.env.UE_DEBUG_DUMP) console.log(`  [debug] store HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`)
    return null
  }
  const json = await res.json().catch(() => null)
  if (!json) return null
  if (process.env.UE_DEBUG_DUMP && !globalThis.__ueStoreDumped) {
    globalThis.__ueStoreDumped = true
    const { writeFileSync } = await import('fs')
    writeFileSync('data/processed/ubereats_store_debug.json', JSON.stringify(json, null, 2))
    console.log('  [debug] reponse store dumpee dans data/processed/ubereats_store_debug.json')
  }

  // Extraire sections et items — format 2026 : catalogSectionsMap = { uuid: [ { type, payload } ] }
  // Les plats sont dans payload.standardItemsPayload.catalogItems, prix en centavos.
  const sections = []
  const data = json.data || json
  const cats = data.catalogSectionsMap || {}

  for (const sectionArray of Object.values(cats)) {
    if (!Array.isArray(sectionArray)) continue
    for (const entry of sectionArray) {
      const p = entry?.payload?.standardItemsPayload
      if (!p) continue
      const items = (p.catalogItems || []).map(item => ({
        name: item.title || null,
        description: item.itemDescription || null,
        price: Number.isFinite(item.price) ? item.price / 100 : null,
      })).filter(i => i.name)

      if (items.length > 0) sections.push({ name: p.title?.text || 'Menu', items })
    }
  }

  return sections.length > 0 ? sections : null
}

function cleanStore(raw, neighborhood) {
  // rating nouveau format : { text: "4.7", accessibilityText: "4.7 sur 5..." }
  const ratingText = parseFloat(raw.rating?.text ?? '')
  return {
    uberEatsId: raw.uuid || raw.storeUuid,
    name: raw.title?.text || (typeof raw.title === 'string' ? raw.title : null) || raw.name,
    address: raw.location?.address || raw.address,
    lat: raw.location?.latitude || raw.latitude || raw.mapMarker?.latitude || null,
    lon: raw.location?.longitude || raw.longitude || raw.mapMarker?.longitude || null,
    actionUrl: raw.actionUrl ? `https://www.ubereats.com${raw.actionUrl}` : null,
    rating: raw.rating?.ratingValue || (Number.isFinite(ratingText) ? ratingText : null),
    reviewCount: raw.rating?.reviewCount || null,
    deliveryFee: raw.fare?.deliveryFee?.price || null,
    etaMin: raw.eta?.minMinutes || null,
    etaMax: raw.eta?.maxMinutes || null,
    isOpen: raw.isOpen || false,
    heroImage: raw.heroImageUrl || null,
    neighborhood,
    source: 'ubereats',
    menu: null,
  }
}

function isRetail(row) {
  return /🛒|💊|🐶|🐱|home depot|farmacias?|benavides|\boxxo\b|chedraui|soriana|costco|\bla comer\b|city market|city club|\bcalii\b|\bfresko\b|\bpetco\b|la europea|7[ -]?eleven|walmart|superama|bodega aurrera|\bj[uü]sto\b|office depot|toyo foods|go mart|circle k|\bminiso\b|\bsally\b|decathlon|\blego\b|florer[ií]a/i.test(row.name || '')
}

function targetProductRows(rows) {
  if (!targetMissing) return rows
  const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'), { readOnly: true })
  const missing = db.prepare(`
    SELECT id,name,lat,lng FROM restaurant_search_mv
    WHERE is_enriched=1 AND lat IS NOT NULL AND lng IS NOT NULL
      AND id NOT IN (SELECT restaurant_id FROM menu_items UNION SELECT restaurant_id FROM menu_items_local_extracted)
  `).all()
  db.close()
  const tokens = value => new Set((normalizeName(value) || '').split(/\s+/).filter(token => token.length > 2))
  const tokenScore = (a,b) => {
    const left=tokens(a),right=tokens(b)
    if (!left.size || !right.size) return 0
    const common=[...left].filter(token=>right.has(token)).length
    return common/(left.size+right.size-common)
  }
  const selected = []
  for (const row of rows) {
    if (!Number.isFinite(Number(row.lat)) || !Number.isFinite(Number(row.lon))) continue
    const nearby = missing.map(target => ({ target,
      distance:distanceMeters(Number(row.lat),Number(row.lon),Number(target.lat),Number(target.lng)),
      similarity:nameSimilarity(row.name,target.name), token:tokenScore(row.name,target.name),
    })).filter(item => item.distance <= 150 && item.similarity >= 0.45 && item.token >= 0.25)
      .sort((a,b)=>b.similarity-a.similarity || b.token-a.token || a.distance-b.distance)
    const best=nearby[0],second=nearby[1]
    if (!best || (second && best.similarity-second.similarity<0.08 && best.distance>40)) continue
    selected.push({ ...row, targetRestaurantId:best.target.id, targetRestaurantName:best.target.name,
      targetDistanceMeters:Math.round(best.distance), targetNameSimilarity:best.similarity })
  }
  console.log(`Ciblage produit: ${selected.length}/${rows.length} correspondent aux fiches enrichies sans menu`)
  return selected
}

function toSourceRecord(row) {
  return {
    source_id: row.uberEatsId,
    name: row.name,
    latitude: row.lat,
    longitude: row.lon,
    address: row.address || null,
    phone: null,
    website: row.actionUrl || null,
    payload: row,
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Uber Eats CDMX | ${NEIGHBORHOODS.length} quartiers`)
  console.log(`Menus: ${withMenus ? 'OUI' : 'NON (ajouter --menus)'} | Import DB: ${importDb ? 'OUI' : 'NON'}`)

  let session = multiSession ? null : await getSession()
  let menuSession = session

  if (session && !session.feedEndpoint) {
    console.log('\n⚠ Pas de feed endpoint capturé — Uber Eats utilise peut-être un flow différent')
    console.log('Essai endpoint alternatif...')
    // Essai direct avec endpoint connu
    session.feedEndpoint = 'https://www.ubereats.com/api/getFeedV1'
    session.feedBody = {}
  }

  if (session) {
    console.log(`\nToken: ${session.token ? session.token.slice(0,30)+'...' : 'non capturé'}`)
    console.log(`Endpoint: ${session.feedEndpoint || 'inconnu'}`)
  }

  const seen = new Map()

  for (const zone of NEIGHBORHOODS) {
    console.log(`\n[${zone.name}]`)
    const zoneSession = multiSession ? await getSession(zone.address) : session
    if (!zoneSession.feedEndpoint) {
      console.log('  aucun feed capturé, quartier ignoré')
      continue
    }
    menuSession ||= zoneSession
    const stores = await fetchRestaurants(zoneSession, zone.lat, zone.lng)
    console.log(`  ${stores.length} restaurants trouvés`)

    for (const store of stores) {
      const id = store.uuid || store.storeUuid
      if (!id || seen.has(id)) continue
      const cleaned = cleanStore(store, zone.name)
      seen.set(id, cleaned)
    }
    await sleep(800)
  }

  const allResults = [...seen.values()]
  const foodResults = allResults.filter(row => !isRetail(row))
  const results = targetProductRows(foodResults)
  console.log(`\nFiltre retail: ${allResults.length - foodResults.length} exclus, ${foodResults.length} restaurants conservés`)

  // Menus (optionnel, lent)
  if (withMenus && results.length > 0) {
    const menuLimit = Number(process.env.UE_MENU_LIMIT || results.length)
    console.log(`\nRécupération menus pour ${Math.min(menuLimit, results.length)} restaurants...`)
    let menuOk = 0
    for (let i = 0; i < Math.min(menuLimit, results.length); i++) {
      const r = results[i]
      if (!r.uberEatsId) continue
      process.stdout.write(`[${i+1}/${results.length}] ${r.name?.slice(0,30)} `)
      const menu = await fetchMenu(menuSession, r.uberEatsId)
      if (menu) { r.menu = menu; menuOk++; console.log(`✓ ${menu.length} sections`) }
      else console.log(`✗`)
      await sleep(500)
    }
    console.log(`${menuOk} menus récupérés`)
  }

  await writeFile(OUTPUT, JSON.stringify(results, null, 2))
  await mkdir(RAW_DIR, { recursive: true })
  await writeFile(RAW_OUTPUT, JSON.stringify(results.map(toSourceRecord), null, 2))
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Restaurants uniques: ${results.length}`)
  console.log(`Avec GPS: ${results.filter(r=>r.lat).length}`)
  console.log(`Avec menu: ${results.filter(r=>r.menu).length}`)
  console.log(`Export: ${OUTPUT}`)
  console.log(`Raw ingestible: ${RAW_OUTPUT}`)

  if (importDb && results.length > 0) {
    throw new Error(`Import direct désactivé. Utiliser: node scripts/ingest.js --source=ubereats --date=${TODAY} --dry`)
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
