// Chilango restaurant editorial scraper.
// Collects recent restaurant articles, then extracts restaurant names from article bodies.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'chilango'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)
const LIMIT = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || 30)

const ARCHIVES = [
  'https://www.chilango.com/category/comida/restaurantes/',
  'https://www.chilango.com/category/comida/restaurantes/page/2/',
]

const SKIP_NAMES = new Set([
  'restaurantes', 'restaurante', 'comida', 'cdmx', 'ciudad de mexico',
  'donde', 'que', 'inicio', 'noticias', 'leer mas',
  'que hacer', 'cine y tv', 'manual de supervivencia', 'viajes',
  'especiales', 'chilango diario', 'horario', 'costo',
  'guia para comer y beber en diciembre', 'donde y cuando',
  'chilango', 'mexico', 'tradicion culinaria',
])

function decodeHtml(value) {
  if (!value) return null
  return String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#039;|&#39;/g, "'")
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&aacute;/g, 'a').replace(/&eacute;/g, 'e').replace(/&iacute;/g, 'i')
    .replace(/&oacute;/g, 'o').replace(/&uacute;/g, 'u').replace(/&ntilde;/g, 'n')
    .replace(/&Aacute;/g, 'A').replace(/&Eacute;/g, 'E').replace(/&Iacute;/g, 'I')
    .replace(/&Oacute;/g, 'O').replace(/&Uacute;/g, 'U').replace(/&Ntilde;/g, 'N')
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

function validName(name) {
  const n = decodeHtml(name)
  if (!n || n.length < 3 || n.length > 70) return false
  if (SKIP_NAMES.has(slugify(n).replace(/-/g, ' '))) return false
  if (/^[¿?]/.test(n)) return false
  if (/^(foto|ig|instagram|whatsapp|facebook|twitter|tiktok|leer|mas|donde|estos|estas|mejores|cortesia)\b/i.test(n)) return false
  if (/\b(cdmx|ciudad de mexico|restaurantes?|comida|tragos|navidad|ano nuevo|ranking|lista completa|mariposas|convocatoria|rosca|roscas|buffet)\b/i.test(n) && !/^[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ' .&-]+:/.test(n)) return false
  if (/^(ve|atrevete|atrévete|no subestimes|pregunta|compra|reserva|consulta|tips|diseno|diseño|no te|en tierra|capibaras)\b/i.test(n)) return false
  return /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(n)
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

function extractJsonLd(html) {
  const blocks = []
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = re.exec(html)) !== null) {
    try { blocks.push(JSON.parse(match[1])) } catch {}
  }
  return blocks
}

function articleMeta(html, fallbackUrl) {
  const graphs = extractJsonLd(html).flatMap(block => block['@graph'] || [block])
  const article = graphs.find(g => g?.['@type'] === 'Article') || {}
  const page = graphs.find(g => g?.['@type'] === 'WebPage') || {}
  return {
    url: page.url || fallbackUrl,
    title: decodeHtml(article.headline || page.name || html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]),
    description: decodeHtml(page.description || html.match(/<meta name="description" content="([^"]+)"/i)?.[1]),
    image: page.thumbnailUrl || article.thumbnailUrl || null,
    publishedAt: article.datePublished || page.datePublished || null,
    modifiedAt: article.dateModified || page.dateModified || null,
  }
}

function extractArchiveLinks(html) {
  const links = new Map()
  const re = /<div class="titlehOme[\s\S]*?<a href="([^"]+)" title="([^"]+)"/g
  let match
  while ((match = re.exec(html)) !== null) {
    const url = match[1]
    const title = decodeHtml(match[2])
    if (!url.includes('/restaurantes/')) continue
    links.set(url, { url, title })
  }
  return [...links.values()]
}

function extractCandidates(html, meta) {
  const articleHtml = html.match(/<div class="entry-content">([\s\S]*?)<\/article>/i)?.[1]
    || html.match(/<article\b[\s\S]*?<\/article>/i)?.[0]
    || html
  const candidates = new Map()
  const add = (name, method, detail = {}) => {
    name = decodeHtml(name)?.replace(/\s+:/g, ':')
    name = name?.replace(/^(Foto|IG|Instagram|FB|Cortes[ií]a)\s*:?\s*/i, '').replace(/\s+Foto.*$/i, '').replace(/\.+$/g, '').trim()
    if (name?.includes(':')) name = name.split(':')[0].trim()
    if (name?.includes('/')) {
      for (const part of name.split('/')) add(part, method, detail)
      return
    }
    if (!validName(name)) return
    candidates.set(slugify(name), { name, method, ...detail })
  }

  const title = meta.title || ''
  const titlePatterns = [
    /Conoce\s+([^,]+),/i,
    /ahora\s+([^,]+),/i,
    /^([^:]{3,70}):/,
  ]
  for (const pattern of titlePatterns) {
    const match = title.match(pattern)
    if (match) add(match[1], 'title')
  }

  for (const match of articleHtml.matchAll(/<h[23][^>]*class="[^"]*wp-block-heading[^"]*"[^>]*>([\s\S]*?)<\/h[23]>/gi)) {
    add(match[1], 'heading')
  }

  for (const match of articleHtml.matchAll(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/gi)) {
    const text = decodeHtml(match[1])
    const name = text?.match(/(?:Foto:\s*(?:FB|Cortes[ií]a)?\s*)?(?:IG\s+)?([A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ' .&-]{2,40})\.?$/)?.[1]
    if (name) add(name, 'caption')
  }

  return [...candidates.values()]
}

function toRecord(candidate, meta) {
  return {
    source_id: `${slugify(meta.url)}:${slugify(candidate.name)}`,
    name: candidate.name,
    latitude: null,
    longitude: null,
    address: null,
    phone: null,
    website: null,
    payload: {
      publisher: 'chilango',
      articleTitle: meta.title,
      articleUrl: meta.url,
      publishedAt: meta.publishedAt,
      modifiedAt: meta.modifiedAt,
      sourceUrl: meta.url,
      name: candidate.name,
      extractionMethod: candidate.method,
      description: meta.description,
      image: meta.image,
      signal: 'editorial_mention',
      source: SOURCE,
    },
  }
}

async function scrape() {
  const articles = new Map()
  for (const archive of ARCHIVES) {
    const html = await fetchHtml(archive)
    for (const article of extractArchiveLinks(html)) articles.set(article.url, article)
  }

  const records = new Map()
  for (const article of [...articles.values()].slice(0, LIMIT)) {
    const html = await fetchHtml(article.url)
    const meta = articleMeta(html, article.url)
    const candidates = extractCandidates(html, meta)
    console.log(`  ${candidates.length} :: ${meta.title}`)
    for (const candidate of candidates) {
      const record = toRecord(candidate, meta)
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
