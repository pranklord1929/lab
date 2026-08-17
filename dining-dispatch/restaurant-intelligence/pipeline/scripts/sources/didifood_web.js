// DiDi Food public SEO pages -> CDMX raw dump. No app session or private API.
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SOURCE = 'didifood_web'
const TODAY = new Date().toISOString().slice(0, 10)
const BASE = 'https://web.didiglobal.com'
const CITY_PATH = '/mx/food/ciudad-de-mexico-cdmx/'
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)
const TIMEOUT = 18000
const CONCURRENCY = 8

function decode(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

function text(html) {
  return decode(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

async function fetchHtml(path) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const response = await fetch(new URL(path, BASE), {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.text()
  } finally { clearTimeout(timer) }
}

function links(html, pattern) {
  const found = new Set()
  const regex = /href="([^"]+)"/g
  let match
  while ((match = regex.exec(html))) if (pattern.test(match[1])) found.add(match[1])
  return [...found]
}

function parseStore(path, html) {
  const id = path.match(/\/(576460\d+)\/?$/)?.[1]
  const name = text(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1])
  const description = decode(html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1])
  const body = text(html)
  const rating = Number(body.match(/Rating\s*:\s*([\d.]+)/i)?.[1]) || null
  const visibleAddress = body.match(/Direcci[oó]n\s*:\s*([\s\S]{5,250}?)(?:Entrar|Pedir|Ver|$)/i)?.[1]?.trim()
  const metaAddress = description.match(/ubicado en\s+(.+?)(?:\.\s|$)/i)?.[1]?.trim()
  const address = visibleAddress || metaAddress || null
  const category = description.match(/categor[ií]a\s+([^.;]+)/i)?.[1]?.trim() || null
  const image = decode(html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i)?.[1]) || null
  const cdmx = /Ciudad de M[eé]xico|\bCDMX\b/i.test(`${address || ''} ${description}`) &&
    !/Estado de M[eé]xico|Chimalhuac[aá]n|Nezahualc[oó]yotl|Chalco|Ecatepec|Naucalpan|Tlalnepantla/i.test(address || '')
  if (!id || !name || !cdmx) return null
  return {
    source_id: id,
    name,
    latitude: null,
    longitude: null,
    address,
    phone: null,
    website: new URL(path, BASE).href,
    payload: { source: SOURCE, profile_url: new URL(path, BASE).href, rating, category, image, description },
  }
}

const cityHtml = await fetchHtml(CITY_PATH)
const categories = links(cityHtml, /\/ciudad-de-mexico-cdmx\/categoria\//)
const storePaths = new Set(links(cityHtml, /\/ciudad-de-mexico-cdmx\/[^/]+\/576460\d+\/?$/))
console.log(`[${SOURCE}] ${categories.length} catégories; ${storePaths.size} profils initiaux`)

let categoryCursor = 0
async function categoryWorker() {
  while (categoryCursor < categories.length) {
    const path = categories[categoryCursor++]
    try {
      const html = await fetchHtml(path)
      for (const store of links(html, /\/ciudad-de-mexico-cdmx\/[^/]+\/576460\d+\/?$/)) storePaths.add(store)
    } catch { /* retain other categories */ }
  }
}
await Promise.all(Array.from({ length: 6 }, () => categoryWorker()))
console.log(`  ${storePaths.size} profils uniques`)

const paths = [...storePaths]
const records = []
let detailCursor = 0
let failed = 0
async function detailWorker() {
  while (detailCursor < paths.length) {
    const path = paths[detailCursor++]
    try {
      const row = parseStore(path, await fetchHtml(path))
      if (row) records.push(row)
    } catch { failed++ }
    const done = detailCursor
    if (done % 50 === 0) console.log(`  ${done}/${paths.length} — ${records.length} CDMX`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => detailWorker()))
records.sort((a, b) => a.name.localeCompare(b.name, 'es'))
await mkdir(OUT_DIR, { recursive: true })
await writeFile(OUT_FILE, `${JSON.stringify(records, null, 2)}\n`)
console.log(`Écrit : ${OUT_FILE} (${records.length} records; ${failed} échecs réseau)`)
