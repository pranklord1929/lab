// Scrape Guide Michelin CDMX.
// Output moderne : data/raw/michelin/<YYYY-MM-DD>.json
// Puis ingestion : npm run ingest -- --source=michelin --date=<YYYY-MM-DD>

import { mkdir, writeFile } from 'fs/promises'
import { execFile } from 'child_process'
import { resolve } from 'path'
import { promisify } from 'util'

const SOURCE = 'michelin'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)
const BASE = 'https://guide.michelin.com'
const START_URL = `${BASE}/mx/es/ciudad-de-mexico/restaurantes`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const execFileAsync = promisify(execFile)

async function fetchHtml(url) {
  const args = [
    '-sS',
    '-L',
    '--max-time',
    '30',
    url,
  ]
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 2_000_000 })
    if (stdout && stdout.length >= 1000) return stdout
    await sleep(1500 * attempt)
  }
  throw new Error(`empty HTML for ${url}`)
}

function decodeHtml(value) {
  if (!value) return null
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function cleanText(value) {
  return decodeHtml(value?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()) || null
}

function attr(html, name) {
  const m = html.match(new RegExp(`${name}="([^"]*)"`, 'i'))
  return decodeHtml(m?.[1]) || null
}

function extractJsonLd(html) {
  const blocks = []
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi
  let match
  while ((match = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      if (Array.isArray(parsed)) blocks.push(...parsed)
      else blocks.push(parsed)
    } catch {}
  }
  return blocks
}

function distinctionFrom(pin, award) {
  if (pin === 'THREE_STARS') return { michelinStars: 3, bibGourmand: false, distinction: '3 etoiles MICHELIN' }
  if (pin === 'TWO_STARS') return { michelinStars: 2, bibGourmand: false, distinction: '2 etoiles MICHELIN' }
  if (pin === 'ONE_STAR') return { michelinStars: 1, bibGourmand: false, distinction: '1 etoile MICHELIN' }
  if (pin === 'BIB_GOURMAND') return { michelinStars: 0, bibGourmand: true, distinction: 'Bib Gourmand' }

  const text = `${pin || ''} ${award || ''}`.toLowerCase()
  if (/\b(three|3)\s+(star|etoile|estrella)/.test(text)) return { michelinStars: 3, bibGourmand: false, distinction: '3 etoiles MICHELIN' }
  if (/\b(two|2)\s+(star|etoile|estrella)/.test(text)) return { michelinStars: 2, bibGourmand: false, distinction: '2 etoiles MICHELIN' }
  if (/\b(one|1)\s+(star|etoile|estrella)/.test(text)) return { michelinStars: 1, bibGourmand: false, distinction: '1 etoile MICHELIN' }
  if (text.includes('bib')) return { michelinStars: 0, bibGourmand: true, distinction: 'Bib Gourmand' }
  return { michelinStars: 0, bibGourmand: false, distinction: 'Selection MICHELIN' }
}

function parseListing(html) {
  const cards = []
  const starts = [...html.matchAll(/<div class="card__menu[^"]*js-restaurant__list_item[^"]*"[\s\S]*?data-id="[^"]+"/gi)]

  for (let i = 0; i < starts.length; i++) {
    const start = starts[i].index
    const end = starts[i + 1]?.index ?? html.length
    const card = html.slice(start, end)

    const href = card.match(/href="(\/mx\/es\/ciudad-de-mexico\/[^"]+\/restaurante\/[^"]+)"/)?.[1]
    const name = cleanText(card.match(/class="card__menu-content--title[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1])
      || attr(card, 'data-restaurant-name')
    if (!href || !name || name.includes('{{')) continue

    const footer = [...card.matchAll(/card__menu-footer--score[^>]*>([\s\S]*?)<\/div>/gi)].map(m => cleanText(m[1])).filter(Boolean)
    const priceCuisine = footer.find(v => v.includes('·')) || ''
    const [price, cuisine] = priceCuisine.split('·').map(v => v?.trim()).filter(Boolean)
    const pin = attr(card, 'data-map-pin-name')
    const dtmAward = attr(card, 'data-dtm-distinction')

    cards.push({
      source_id: href,
      name,
      latitude: Number(attr(card, 'data-lat')) || null,
      longitude: Number(attr(card, 'data-lng')) || null,
      address: null,
      phone: null,
      website: null,
      payload: {
        name,
        neighborhood: attr(card, 'data-dtm-city') || null,
        cuisine: cuisine || null,
        price: price || null,
        michelinPath: href,
        michelinUrl: BASE + href,
        michelinId: attr(card, 'data-id') || attr(card, 'data-dtm-id'),
        mapPinName: pin,
        source: SOURCE,
        ...distinctionFrom(pin, dtmAward),
      },
    })
  }

  return cards
}

function parseDetail(html, listing) {
  const schema = extractJsonLd(html).find(d => d?.['@type'] === 'Restaurant') || {}
  const website = html.match(/href="(https?:\/\/[^"]+)"[^>]+data-event="CTA_website"/i)?.[1] || null
  const address = schema.address
    ? [schema.address.streetAddress, schema.address.addressLocality, schema.address.postalCode].filter(Boolean).join(', ')
    : null
  const award = typeof schema.award === 'string' ? schema.award : schema.award?.awardFor
  const distinction = distinctionFrom(listing.payload?.mapPinName, award)

  return {
    latitude: Number(schema.latitude) || listing.latitude || null,
    longitude: Number(schema.longitude) || listing.longitude || null,
    address: cleanText(address) || listing.address,
    phone: schema.telephone || listing.phone || null,
    website,
    payload: {
      ...listing.payload,
      address: cleanText(address) || listing.address,
      phone: schema.telephone || null,
      website,
      cuisine: schema.servesCuisine || listing.payload?.cuisine || null,
      priceRange: schema.priceRange || listing.payload?.price || null,
      review: schema.review?.description || null,
      acceptsReservations: schema.acceptsReservations || null,
      image: schema.image || null,
      dateAwarded: schema.award?.dateAwarded || null,
      ...distinction,
    },
  }
}

async function scrape() {
  const seen = new Map()

  for (let page = 1; page <= 10; page++) {
    const url = page === 1 ? START_URL : `${START_URL}/page/${page}`
    console.log(`[listing] ${url}`)
    const html = await fetchHtml(url)
    const records = parseListing(html)
    console.log(`  ${records.length} cartes`)
    if (records.length === 0) break

    for (const record of records) {
      if (!seen.has(record.source_id)) seen.set(record.source_id, record)
    }

    if (!html.includes(`${START_URL.replace(BASE, '')}/page/${page + 1}`)) break
    await sleep(800)
  }

  const records = [...seen.values()]
  console.log(`[detail] ${records.length} pages`)

  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    try {
      const html = await fetchHtml(record.payload.michelinUrl)
      Object.assign(record, parseDetail(html, record))
      process.stdout.write(`  ${i + 1}/${records.length}\r`)
    } catch (e) {
      console.warn(`\n  detail fail: ${record.name} (${e.message})`)
    }
    await sleep(500)
  }
  process.stdout.write('\n')

  return records.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

async function main() {
  console.log(`[${SOURCE}] scrape Guide Michelin CDMX`)
  const records = await scrape()

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(records, null, 2))

  console.log(`Records: ${records.length}`)
  console.log(`Etoiles: ${records.filter(r => r.payload?.michelinStars > 0).length}`)
  console.log(`Bib Gourmand: ${records.filter(r => r.payload?.bibGourmand).length}`)
  console.log(`Ecrit: ${OUT_FILE}`)
  console.log(`Ingest: npm run ingest -- --source=${SOURCE} --date=${TODAY}`)
}

main().catch(e => { console.error(e); process.exit(1) })
