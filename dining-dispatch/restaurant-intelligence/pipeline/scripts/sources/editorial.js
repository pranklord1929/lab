// Editorial/journal restaurant lists for CDMX.
// Sources: Eater, The Infatuation, Time Out Mexico.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'editorial'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

const SOURCES = [
  {
    publisher: 'eater',
    url: 'https://www.eater.com/maps/best-mexico-city-restaurants-38',
    title: 'The 38 Best Restaurants in Mexico City',
    parser: parseJsonLdItemList,
  },
  {
    publisher: 'infatuation',
    url: 'https://www.theinfatuation.com/mexico-city/guides/best-mexico-city-restaurants',
    title: 'The Best Restaurants In Mexico City',
    parser: parseJsonLdItemList,
  },
  {
    publisher: 'timeout_mx',
    url: 'https://www.timeoutmexico.mx/ciudad-de-mexico/restaurantes/los-mejores-restaurantes-en-la-cdmx',
    title: 'Los mejores restaurantes en CDMX',
    parser: parseTimeout,
  },
]

const SKIP_NAME_RE = /\b(crawl|route|ruta|tour|guide|guia|experienc)/i

function decodeHtml(value) {
  if (!value) return null
  return String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#039;|&#39;/g, "'")
    .replace(/&aacute;/g, 'a')
    .replace(/&eacute;/g, 'e')
    .replace(/&iacute;/g, 'i')
    .replace(/&oacute;/g, 'o')
    .replace(/&uacute;/g, 'u')
    .replace(/&Aacute;/g, 'A')
    .replace(/&Eacute;/g, 'E')
    .replace(/&Iacute;/g, 'I')
    .replace(/&Oacute;/g, 'O')
    .replace(/&Uacute;/g, 'U')
    .replace(/&ntilde;/g, 'n')
    .replace(/&Ntilde;/g, 'N')
    .replace(/&uuml;/g, 'u')
    .replace(/&Uuml;/g, 'U')
    .replace(/&iquest;/g, '')
    .replace(/&iexcl;/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function getAddress(address) {
  if (!address) return null
  if (typeof address === 'string') return address
  return address.name || [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode]
    .filter(Boolean)
    .join(', ')
}

function normalizeUrl(url, base) {
  if (!url) return null
  try { return new URL(url, base).toString() } catch { return url }
}

function editorialRecord({ publisher, articleUrl, articleTitle, position, name, url, image, description, address, latitude, longitude, phone, website, cuisine, price, rating, tags, raw }) {
  const cleanName = decodeHtml(name)
  if (!cleanName || SKIP_NAME_RE.test(cleanName)) return null

  const sourceUrl = normalizeUrl(url, articleUrl) || articleUrl
  const idUrl = sourceUrl ? new URL(sourceUrl).pathname : slugify(cleanName)

  return {
    source_id: `${publisher}:${slugify(articleTitle)}:${position || slugify(cleanName)}:${slugify(idUrl)}`,
    name: cleanName,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    address: decodeHtml(address),
    phone: phone || null,
    website: website || null,
    payload: {
      publisher,
      articleTitle,
      articleUrl,
      sourceUrl,
      position: position ?? null,
      name: cleanName,
      address: decodeHtml(address),
      lat: latitude ?? null,
      lon: longitude ?? null,
      phone: phone || null,
      website: website || null,
      cuisine: cuisine || null,
      price: price || null,
      rating: rating ?? null,
      tags: tags || [],
      image: image || null,
      description: decodeHtml(description),
      signal: 'editorial_recommendation',
      source: SOURCE,
      raw,
    },
  }
}

function extractJsonLd(html) {
  const blocks = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = re.exec(html)) !== null) {
    try { blocks.push(JSON.parse(match[1])) } catch {}
  }
  return blocks
}

function parseJsonLdItemList(html, meta) {
  const list = extractJsonLd(html).find(block => block?.['@type'] === 'ItemList')
  return (list?.itemListElement || [])
    .map(item => {
      const restaurant = item.item || item
      const review = restaurant.review || {}
      return editorialRecord({
        publisher: meta.publisher,
        articleUrl: meta.url,
        articleTitle: list.name || meta.title,
        position: item.position,
        name: item.name || restaurant.name,
        url: restaurant.url || review.url || item.url,
        image: restaurant.image || item.image,
        description: item.description || restaurant.description,
        address: getAddress(restaurant.address),
        latitude: restaurant.geo?.latitude,
        longitude: restaurant.geo?.longitude,
        phone: restaurant.telephone,
        website: restaurant.sameAs && String(restaurant.sameAs).startsWith('http') ? restaurant.sameAs : null,
        cuisine: restaurant.servesCuisine,
        price: restaurant.priceRange,
        raw: item,
      })
    })
    .filter(Boolean)
}

function parseTimeout(html, meta) {
  const records = []
  const articles = html.split(/<article\b/i).slice(1)

  for (const article of articles) {
    const titleMatch = article.match(/data-testid="tile-title_testID"[^>]*>\s*<span>(\d+)\.<\/span>&nbsp;([\s\S]*?)<\/h3>/i)
    if (!titleMatch) continue

    const position = Number(titleMatch[1])
    const name = decodeHtml(titleMatch[2])
    const link = article.match(/<a[^>]+href="([^"]+)"[^>]+data-testid="tile-link_testID"/i)?.[1]
    const image = article.match(/<img[^>]+src="([^"]+)"[^>]+data-testid="responsive-image_testID"/i)?.[1]
    const description = article.match(/data-testid="summary_testID"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i)?.[1]
    const tags = [...article.matchAll(/class="[^"]*_tag_1i2cm_17[^"]*"[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/gi)]
      .map(m => decodeHtml(m[1]))
      .filter(Boolean)
    const priceText = article.match(/precio\s+(\d+)\s+de\s+4/i)?.[1]
    const ratingText = article.match(/(\d+(?:\.\d+)?)\s+de\s+5\s+estrellas/i)?.[1]

    const record = editorialRecord({
      publisher: meta.publisher,
      articleUrl: meta.url,
      articleTitle: meta.title,
      position,
      name,
      url: link,
      image,
      description,
      cuisine: tags[0] || null,
      price: priceText ? '$'.repeat(Number(priceText)) : null,
      rating: ratingText ? Number(ratingText) : null,
      tags,
      raw: { position, link, tags },
    })
    if (record) records.push(record)
  }

  return records
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
    },
  })
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`)
  return res.text()
}

async function scrape() {
  const records = []
  for (const source of SOURCES) {
    console.log(`  fetch ${source.publisher}`)
    const html = await fetchHtml(source.url)
    const parsed = source.parser(html, source)
    console.log(`    ${parsed.length} records`)
    records.push(...parsed)
  }
  return records
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
