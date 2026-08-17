// La Liste 2026 — Top 1000 Restaurants, entrées de Ciudad de México.
// Parcourt la pagination officielle et conserve le score et l'identifiant La Liste.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'laliste'
const TODAY = new Date().toISOString().slice(0, 10)
const LIST_URL = 'https://www.laliste.com/lists/top-1000-restaurants'
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

function decodeHtml(value = '') {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;|&#xA0;/g, ' ')
    .replace(/&([a-zA-Z]+);/g, (_, entity) => ({ eacute: 'é', Eacute: 'É', aacute: 'á', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ' }[entity] || `&${entity};`))
    .replace(/\s+/g, ' ')
    .trim()
}

function extract(block, field, className) {
  const match = block.match(new RegExp(`${field}="${className}"[^>]*>([\\s\\S]*?)<\\/div>`))
  return match ? decodeHtml(match[1].replace(/<[^>]+>/g, ' ')) : null
}

function parsePage(html) {
  const rows = []
  const pattern = /<a place_id="([^"]+)"[^>]*class="place-hit-list-container[^>]*>([\s\S]*?)<\/a>/g
  for (const match of html.matchAll(pattern)) {
    const block = match[2]
    const name = extract(block, 'fs-list-field', 'name')
    const city = extract(block, 'fs-list-field', 'city')
    const country = extract(block, 'fs-list-field', 'country')
    const scoreText = extract(block, 'fs-list-field', 'score')
    const score = Number(scoreText)
    if (name && Number.isFinite(score)) rows.push({ placeId: match[1], name, city, country, score })
  }
  return rows
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
    },
  })
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`)
  return response.text()
}

const firstHtml = await fetchHtml(LIST_URL)
const pageCount = Number(firstHtml.match(/Page 1 of (\d+)/i)?.[1] || firstHtml.match(/1 \/ (\d+)/)?.[1] || 15)
const pages = [firstHtml]
for (let page = 2; page <= pageCount; page++) {
  pages.push(await fetchHtml(`${LIST_URL}?2dbc56ae_page=${page}`))
}

const all = pages.flatMap(parsePage)
const cdmx = all.filter(row => /^(ciudad de méxico|mexico city)$/i.test(row.city || '') && row.country === 'Mexico')
const unique = [...new Map(cdmx.map(row => [row.placeId, row])).values()]
const records = unique.map(row => ({
  source_id: row.placeId,
  name: row.name,
  latitude: null,
  longitude: null,
  address: 'Ciudad de México, México',
  phone: null,
  website: null,
  payload: {
    publisher: 'La Liste',
    signal: 'laliste_top_1000',
    editionYear: 2026,
    score: row.score,
    city: row.city,
    country: row.country,
    placeId: row.placeId,
    source_url: LIST_URL,
  },
}))

if (all.length < 900) throw new Error(`Extraction incomplète : ${all.length} entrées Top 1000 seulement`)
if (!records.length) throw new Error('Aucune entrée Ciudad de México extraite')

await mkdir(OUT_DIR, { recursive: true })
await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
console.log(`Écrit : ${OUT_FILE} (${records.length} CDMX sur ${all.length} entrées parsées)`)
