// Guía México Gastronómico 2026 — sélection CDMX des 250 restaurants.
// La liste CDMX, les quartiers et Instagram sont publiés par Chilango.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'mexico_gastronomico'
const TODAY = new Date().toISOString().slice(0, 10)
const ARTICLE_URL = 'https://www.chilango.com/comida-y-tragos/donde-comer-en-cdmx-conoce-los-restaurantes-mas-top-del-2026-segun-la-guia-mexico-gastronomico/'
const OFFICIAL_URL = 'https://www.culinariamexicana.com.mx/guia-mexico-gastronomico-2026-2/'
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

function decodeHtml(value = '') {
  return value
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#8217;|&#x27;|&#39;|&rsquo;/g, "'")
    .replace(/&#038;|&amp;/g, '&')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&ccedil;/g, 'ç')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugify(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function instagramHandles(html) {
  const handles = []
  for (const match of html.matchAll(/href="https?:\/\/(?:www\.)?instagram\.com\/([^/?#"]+)/gi)) {
    const handle = decodeURIComponent(match[1]).replace(/^@/, '')
    if (handle && !handles.includes(handle)) handles.push(handle)
  }
  return handles
}

const response = await fetch(ARTICLE_URL, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml',
  },
})
if (!response.ok) throw new Error(`Chilango HTTP ${response.status}`)
const html = await response.text()
const start = html.indexOf('id="h-los-mejores-restaurantes-en-cdmx-este-2026')
const end = html.indexOf('<p>De la lista de este 2026', start)
if (start < 0 || end < 0) throw new Error('Section México Gastronómico 2026 introuvable')

const section = html.slice(start, end)
const parsed = []
for (const match of section.matchAll(/<li>([\s\S]*?)<\/li>/gi)) {
  const itemHtml = match[1]
  const text = decodeHtml(itemHtml)
  const parts = text.split(/\s+–\s+/)
  if (parts.length < 2) continue
  const name = parts[0].trim()
  let location = parts[1].replace(/\s*,?\s*(?:(?:de la|en)\s+)?CDMX\.?$/i, '').trim()
  if (/^distintas sedes$/i.test(location)) location = 'Varias sucursales'
  if (!name || !location) continue
  parsed.push({ name, location, instagram: instagramHandles(itemHtml) })
}

const unique = [...new Map(parsed.map(row => [slugify(row.name), row])).values()]
if (unique.length < 70 || unique.length > 90) throw new Error(`Extraction suspecte : ${unique.length} restaurants`)

const records = unique.map(row => ({
  source_id: `2026:${slugify(row.name)}`,
  name: row.name,
  latitude: null,
  longitude: null,
  address: row.location === 'Varias sucursales'
    ? 'Ciudad de México, México'
    : `${row.location}, Ciudad de México, México`,
  phone: null,
  website: null,
  payload: {
    publisher: 'Culinaria Mexicana',
    reportedBy: 'Chilango',
    signal: 'mexico_gastronomico_250_selection',
    editionYear: 2026,
    city: 'Ciudad de México',
    neighborhood: row.location,
    instagram: row.instagram,
    selected: true,
    source_url: ARTICLE_URL,
    official_announcement_url: OFFICIAL_URL,
  },
}))

await mkdir(OUT_DIR, { recursive: true })
await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
console.log(`Écrit : ${OUT_FILE} (${records.length} records)`)
