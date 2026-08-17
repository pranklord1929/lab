// The World's 50 Best / regional 50 Best lists.
// Writes CDMX restaurant/bar ranking records to data/raw/worlds50best/<date>.json.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'worlds50best'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

const LISTS = [
  {
    id: 'latam-restaurants-1-100',
    title: "Latin America's 50 Best Restaurants",
    awardBody: 'latin_america_50_best_restaurants',
    category: 'restaurant',
    url: 'https://www.theworlds50best.com/latinamerica/en/list/1-50',
    cityFilter: /^mexico city$/i,
    signalTier: rank => (rank <= 50 ? 'A+' : 'A'),
  },
  {
    id: 'northamerica-bars-1-100',
    title: "North America's 50 Best Bars",
    awardBody: 'north_america_50_best_bars',
    category: 'bar',
    url: 'https://www.theworlds50best.com/bars/best-in-north-america/list/1-50',
    cityFilter: /^mexico city$/i,
    signalTier: rank => (rank <= 50 ? 'A+' : 'A'),
  },
]

const CITY_STOPWORDS = new Set([
  'register',
  'our partners',
  'individual awards',
  '1-50',
  '51-100',
])

function decodeHtml(value) {
  if (!value) return null
  return String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#039;|&#39;/g, "'")
    .replace(/&#8216;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&aacute;/g, 'a').replace(/&eacute;/g, 'e').replace(/&iacute;/g, 'i')
    .replace(/&oacute;/g, 'o').replace(/&uacute;/g, 'u').replace(/&ntilde;/g, 'n')
    .replace(/&Aacute;/g, 'A').replace(/&Eacute;/g, 'E').replace(/&Iacute;/g, 'I')
    .replace(/&Oacute;/g, 'O').replace(/&Uacute;/g, 'U').replace(/&Ntilde;/g, 'N')
    .replace(/&uuml;/g, 'u').replace(/&Uuml;/g, 'U')
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

function normalizeLine(line) {
  return decodeHtml(line)
    ?.replace(/^#+\s*/, '')
    .replace(/^Image:\s*/i, '')
    .trim()
}

function textLines(html) {
  const text = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '\n')
    .replace(/<(?:br|\/p|\/div|\/li|\/article|\/section|\/h[1-6]|\/a)\b[^>]*>/gi, '\n')
    .replace(/<(?:p|div|li|article|section|h[1-6]|a)\b[^>]*>/gi, '\n')

  return text
    .split(/\n+/)
    .map(normalizeLine)
    .filter(Boolean)
}

function inferEditionYear(html) {
  const years = [...html.matchAll(/\b20\d{2}\b/g)].map(m => Number(m[0]))
  if (!years.length) return new Date().getFullYear()

  const counts = new Map()
  for (const year of years) counts.set(year, (counts.get(year) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0]
}

function isLikelyName(line) {
  if (!line || line.length < 2 || line.length > 90) return false
  if (/^\d+$/.test(line)) return false
  if (/^(lists|awards|stories|experiences|voting|partners|press|about|register|contact|careers)$/i.test(line)) return false
  if (/^(latin america|north america|the world's 50 best|50 best|register for)/i.test(line)) return false
  return /[A-Za-z]/.test(line)
}

function isLikelyCity(line) {
  if (!line || line.length < 2 || line.length > 60) return false
  if (/^\d+$/.test(line)) return false
  if (CITY_STOPWORDS.has(line.toLowerCase())) return false
  if (/^(image:|register|our partners|destination award|best bar|best restaurant)/i.test(line)) return false
  return /[A-Za-z]/.test(line)
}

function parseRankingLines(html) {
  const lines = textLines(html)
  const entries = []

  for (let i = 0; i < lines.length; i++) {
    const rank = Number(lines[i])
    if (!Number.isInteger(rank) || rank < 1 || rank > 100) continue

    let name = null
    let city = null
    let cursor = i + 1

    while (cursor < lines.length && !name) {
      const candidate = lines[cursor]
      if (/^\d+$/.test(candidate)) break
      if (isLikelyName(candidate)) name = candidate
      cursor++
    }

    while (cursor < lines.length && !city) {
      const candidate = lines[cursor]
      if (/^\d+$/.test(candidate)) break
      if (isLikelyCity(candidate) && candidate !== name) city = candidate
      cursor++
    }

    if (name && city) {
      entries.push({ rank, name, city })
      i = cursor - 1
    }
  }

  const deduped = new Map()
  for (const entry of entries) deduped.set(`${entry.rank}:${slugify(entry.name)}`, entry)
  return [...deduped.values()].sort((a, b) => a.rank - b.rank)
}

function absoluteUrl(url, base) {
  if (!url) return null
  try { return new URL(url, base).toString() } catch { return url }
}

function parseRankingCards(html, baseUrl) {
  const cards = html.split(/<div class="list-item"/i).slice(1)
  const entries = []

  for (const card of cards) {
    const rank = Number(decodeHtml(card.match(/<p[^>]+class=["'][^"']*\brank\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]))
    const name = decodeHtml(card.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1])
    const city = decodeHtml(card.match(/<div class="item-bottom"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1])
    const href = card.match(/<a[^>]+href=["']([^"']+)["'][^>]*>\s*<h2/i)?.[1]
      || card.match(/<a[^>]+href=["']([^"']+)["'][^>]*class=["'][^"']*item-img-container/i)?.[1]
    const image = card.match(/<img[^>]+(?:data-src|src)=["']([^"']+)["']/i)?.[1]

    if (!Number.isInteger(rank) || rank < 1 || rank > 100) continue
    if (!isLikelyName(name) || !isLikelyCity(city)) continue

    entries.push({
      rank,
      name,
      city,
      sourceUrl: absoluteUrl(href, baseUrl),
      image: image ? absoluteUrl(image.startsWith('//') ? `https:${image}` : image, baseUrl) : null,
    })
  }

  const deduped = new Map()
  for (const entry of entries) deduped.set(`${entry.rank}:${slugify(entry.name)}`, entry)
  return [...deduped.values()].sort((a, b) => a.rank - b.rank)
}

function toRecord(entry, list, editionYear) {
  const rankBand = entry.rank <= 50 ? '1-50' : '51-100'
  const signalTier = list.signalTier(entry.rank)
  const sourceUrl = entry.sourceUrl || list.url

  return {
    source_id: `${list.awardBody}:${editionYear}:${entry.rank}:${slugify(entry.name)}`,
    name: entry.name,
    latitude: null,
    longitude: null,
    address: entry.city,
    phone: null,
    website: null,
    payload: {
      publisher: 'the_worlds_50_best',
      source: SOURCE,
      signal: '50best_ranking',
      signalTier,
      awardBody: list.awardBody,
      listTitle: list.title,
      category: list.category,
      editionYear,
      rank: entry.rank,
      rankBand,
      name: entry.name,
      city: entry.city,
      country: 'Mexico',
      url: sourceUrl,
      source_url: sourceUrl,
      listUrl: list.url,
      image: entry.image || null,
      raw: entry,
    },
  }
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,es-MX;q=0.8',
    },
  })
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`)
  return res.text()
}

async function scrape() {
  const records = new Map()

  for (const list of LISTS) {
    console.log(`  fetch ${list.title}`)
    const html = await fetchHtml(list.url)
    const editionYear = inferEditionYear(html)
    const cardEntries = parseRankingCards(html, list.url)
    const entries = cardEntries.length ? cardEntries : parseRankingLines(html)
    const localEntries = entries.filter(entry => list.cityFilter.test(entry.city))

    console.log(`    ${entries.length} parsed, ${localEntries.length} CDMX records, edition ${editionYear}`)
    for (const entry of localEntries) {
      const record = toRecord(entry, list, editionYear)
      records.set(record.source_id, record)
    }
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
