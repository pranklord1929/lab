// Enrichit les records RestaurantGuru existants en visitant chaque page detail
// pour recuperer lat/lon, telephone, site web, menu, reviews.
// Part du dernier dump data/raw/restaurantguru/<date>.json et produit un
// NOUVEAU dump date du jour → a re-ingerer ensuite via:
//   npm run ingest -- --source=restaurantguru --date=<today>
//
// Parsing repris de scripts/scrape_restaurantguru.js (parseDetail).
//
// Flags: --limit=N, --input=YYYY-MM-DD (dump source, defaut: plus recent),
//        --delay=MS (defaut 1000), --concurrency=N (defaut 3), --resume

import { mkdir, readFile, readdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const args = process.argv.slice(2)
const getArg = (name, fallback) => {
  const raw = args.find(a => a.startsWith(`--${name}=`))
  return raw ? raw.split('=').slice(1).join('=') : fallback
}
const limit = parseInt(getArg('limit', '0'), 10)
const inputDate = getArg('input', null)
const delayMs = parseInt(getArg('delay', '1000'), 10)
const concurrency = parseInt(getArg('concurrency', '3'), 10)
const resume = args.includes('--resume')

const RAW_DIR = resolve('data/raw/restaurantguru')
const today = new Date().toISOString().slice(0, 10)
const OUTPUT = resolve(RAW_DIR, `${today}.json`)
const CHECKPOINT = resolve(RAW_DIR, `details_checkpoint_${today}.json`)
const sleep = ms => new Promise(r => setTimeout(r, ms))

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,es-MX;q=0.8',
}

let consecutiveBlocks = 0

function decodeHtml(value) {
  if (!value) return null
  return String(value)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' '))
}

function absoluteUrl(url) {
  if (!url) return null
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return `https://restaurantguru.com${url}`
  return url
}

function extractMeta(html, name) {
  const re = new RegExp(`<meta\\s+(?:name|property)=["']${name}["']\\s+content=["']([^"']+)["']`, 'i')
  return decodeHtml(html.match(re)?.[1])
}

function isBlockedPage(html) {
  const text = html || ''
  if (/Suspicious activity detected|detected unusual traffic|unusual traffic from your computer network/i.test(text)) return true
  if (/<title>\s*(?:Just a moment|Attention Required|Access denied)/i.test(text)) return true
  const hasContent = /card__title|rest-card__|restaurant_pic|RGPage\.page_type\s*=\s*["'](?:city|restaurant|restaurant_menu)/i.test(text)
  return /g_recaptcha|recaptcha_sitekey|g-recaptcha/i.test(text) && !hasContent
}

function parseDetail(html, currentUrl) {
  const description = extractMeta(html, 'description')
  const title = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1])
  const address = stripTags(
    html.match(/class="[^"]*(?:address|info_address)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|span|address)>/i)?.[1]
  )
  const phone = decodeHtml(
    html.match(/href=["']tel:([^"']+)["']/i)?.[1]
    || html.match(/phone["']?\s*:\s*["']([^"']+)/i)?.[1]
  )
  const website = absoluteUrl(decodeHtml(
    html.match(/href=["'](https?:\/\/(?![^"']*restaurantguru\.com)[^"']+)["'][^>]*(?:website|Website|official|sitio)/i)?.[1]
  ))
  const menuUrl = absoluteUrl(
    html.match(/href=["']([^"']*(?:\/menu|restaurant_menu)[^"']*)["']/i)?.[1]
  )
  const lat = parseFloat(html.match(/(?:lat|latitude)["']?\s*[:=]\s*["']?(-?\d+\.\d+)/i)?.[1] ?? '')
  const lon = parseFloat(html.match(/(?:lng|lon|longitude)["']?\s*[:=]\s*["']?(-?\d+\.\d+)/i)?.[1] ?? '')
  const reviewCount = parseInt(
    html.match(/rated\s+[\d.]+\s+out of 5 on Restaurant Guru:\s*([\d,]+)\s+reviews/i)?.[1]?.replace(/,/g, '')
    || html.match(/reviewCount["']?\s*[:=]\s*["']?([\d,]+)/i)?.[1]?.replace(/,/g, '')
    || '', 10
  )
  const instagram = decodeHtml(html.match(/https?:\/\/(?:www\.)?instagram\.com\/[^"'<\s]+/i)?.[0])
  const facebook = decodeHtml(html.match(/https?:\/\/(?:www\.)?facebook\.com\/[^"'<\s]+/i)?.[0])

  return {
    detailTitle: title,
    description,
    detailAddress: address,
    phone,
    website: website?.includes('restaurantguru.') || website?.includes('restaurant-guru.') ? null : website,
    menuUrl: menuUrl && menuUrl !== currentUrl ? menuUrl : null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
    instagram,
    facebook,
  }
}

async function fetchDetail(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal })
    // 403/429/503 = rate limit / anti-bot → traiter comme un blocage (pause), pas une erreur definitive
    if ([403, 429, 503].includes(res.status)) return { blocked: true }
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const html = await res.text()
    if (isBlockedPage(html)) return { blocked: true }
    return { html }
  } catch (e) {
    return { error: String(e.message || e).slice(0, 120) }
  } finally {
    clearTimeout(timer)
  }
}

async function loadInputRecords() {
  const files = (await readdir(RAW_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f !== `${today}.json`)
    .sort()
  const inputFile = inputDate ? `${inputDate}.json` : files.at(-1)
  if (!inputFile) throw new Error('Aucun dump source trouve dans data/raw/restaurantguru/')
  const records = JSON.parse(await readFile(resolve(RAW_DIR, inputFile), 'utf8'))
  console.log(`Dump source: ${inputFile} | ${records.length} records`)
  return records
}

async function loadCheckpoint() {
  try {
    const json = JSON.parse(await readFile(CHECKPOINT, 'utf8'))
    return Array.isArray(json.records) ? json.records : []
  } catch {
    return []
  }
}

async function main() {
  const input = await loadInputRecords()
  const done = resume ? await loadCheckpoint() : []
  const doneIds = new Set(done.map(r => r.source_id))
  const queue = input
    .filter(r => r.restaurantGuruUrl && !doneIds.has(r.source_id))
    .slice(0, limit > 0 ? limit : undefined)

  console.log(`A enrichir: ${queue.length} | deja faits (resume): ${done.length} | concurrence: ${concurrency} | delai: ${delayMs}ms`)

  const results = [...done]
  const counts = { coords: 0, phone: 0, website: 0, menu: 0, blocked: 0, errors: 0 }
  let processed = 0
  let aborted = false

  async function worker() {
    while (queue.length > 0 && !aborted) {
      const record = queue.shift()
      const res = await fetchDetail(record.restaurantGuruUrl)

      if (res.blocked) {
        counts.blocked++
        consecutiveBlocks++
        if (consecutiveBlocks >= 8) {
          console.log('\n8 blocages consecutifs → arret propre (checkpoint sauve, relancer avec --resume plus tard)')
          aborted = true
          queue.unshift(record)
          return
        }
        // pause qui double a chaque blocage consecutif : 60s, 120s, 240s... max 10 min
        const pauseMs = Math.min(60000 * 2 ** (consecutiveBlocks - 1), 600000)
        console.log(`  [anti-bot] ${record.name} → pause ${Math.round(pauseMs / 1000)}s (blocage ${consecutiveBlocks}/8)`)
        queue.push(record)
        await sleep(pauseMs)
        continue
      }

      consecutiveBlocks = 0

      if (res.error) {
        counts.errors++
        results.push(record) // on garde le record d'origine sans enrichissement
      } else {
        const detail = parseDetail(res.html, record.restaurantGuruUrl)
        if (detail.latitude) counts.coords++
        if (detail.phone) counts.phone++
        if (detail.website) counts.website++
        if (detail.menuUrl) counts.menu++
        results.push({ ...record, ...detail, address: record.address || detail.detailAddress })
      }

      processed++
      if (processed % 50 === 0) {
        console.log(`${processed} faits | coords ${counts.coords} | tel ${counts.phone} | site ${counts.website} | menu ${counts.menu} | bloques ${counts.blocked} | erreurs ${counts.errors}`)
        await writeFile(CHECKPOINT, JSON.stringify({ savedAt: new Date().toISOString(), records: results }, null, 2))
      }
      await sleep(delayMs)
    }
  }

  await mkdir(RAW_DIR, { recursive: true })
  await Promise.all(Array.from({ length: concurrency }, worker))

  await writeFile(CHECKPOINT, JSON.stringify({ savedAt: new Date().toISOString(), records: results }, null, 2))
  await writeFile(OUTPUT, JSON.stringify(results, null, 2))

  console.log('\nTermine.')
  console.log(JSON.stringify(counts, null, 2))
  console.log(`Export: ${OUTPUT} (${results.length} records)`)
  console.log(`Etape suivante: npm run ingest -- --source=restaurantguru --date=${today}`)
  if (aborted) process.exitCode = 2
}

main().catch(e => { console.error(e); process.exit(1) })
