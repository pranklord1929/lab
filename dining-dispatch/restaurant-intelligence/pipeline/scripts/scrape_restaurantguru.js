// Scrape Restaurant Guru CDMX.
// Source : pages publiques restaurantguru.com/Mexico-City[/page].
// Bon signal broad/ranking : notes, prix, cuisine, photos, pages menu/reviews.
// Output : data/restaurantguru_cdmx.json
// Flags : --pages=N|all (defaut 2), --limit=N, --details, --import, --resume,
//         --delay=MS, --detail-delay=MS, --domain=restaurant-guru.in, --curl,
//         --search-api, --terms=a,b,c, --blocked-retries=N, --blocked-delay=MS,
//         --browser, --headed, --captcha-wait=MS

import { createClient } from '@supabase/supabase-js'
import { execFile } from 'child_process'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { promisify } from 'util'
import { resolve } from 'path'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const execFileAsync = promisify(execFile)

const args = process.argv.slice(2)
const importDb = args.includes('--import')
const withDetails = args.includes('--details')
const useSearchApi = args.includes('--search-api') || args.includes('--smart')
const pagesArg = args.find(a => a.startsWith('--pages='))?.split('=')[1] ?? '2'
const scrapeAllPages = pagesArg === 'all'
const maxPages = scrapeAllPages ? Number.POSITIVE_INFINITY : parseInt(pagesArg, 10)
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0', 10)
const resume = args.includes('--resume')
const listingDelayMs = parseInt(args.find(a => a.startsWith('--delay='))?.split('=')[1] ?? '4000', 10)
const detailDelayMs = parseInt(args.find(a => a.startsWith('--detail-delay='))?.split('=')[1] ?? '5000', 10)
const blockedRetries = parseInt(args.find(a => a.startsWith('--blocked-retries='))?.split('=')[1] ?? '4', 10)
const blockedDelayMs = parseInt(args.find(a => a.startsWith('--blocked-delay='))?.split('=')[1] ?? '45000', 10)
const useBrowser = args.includes('--browser')
const curlOnly = args.includes('--curl') || args.includes('--curl-only')
const headed = args.includes('--headed')
const captchaWaitMs = parseInt(args.find(a => a.startsWith('--captcha-wait='))?.split('=')[1] ?? '180000', 10)
const domain = args.find(a => a.startsWith('--domain='))?.split('=')[1] ?? 'restaurantguru.com'
const scrapeDate = args.find(a => a.startsWith('--date='))?.split('=')[1] ?? new Date().toISOString().slice(0, 10)
const termsArg = args.find(a => a.startsWith('--terms='))?.slice('--terms='.length)

const BASE = `https://${domain}`
const CITY_PATH = '/Mexico-City'
const SEARCH_BASE = 'https://search.restaurantguru.com'
const SEARCH_LOCATION_ID = 'ci109130'
const OUTPUT = resolve('data/raw/restaurantguru', `${scrapeDate}.json`)
const CHECKPOINT = resolve('data/raw/restaurantguru', 'checkpoint.json')
const BROWSER_PROFILE = resolve('.cache/restaurantguru_browser_profile')
const sleep = ms => new Promise(r => setTimeout(r, ms))
let blocked = false
let browserContext = null
let browserPage = null

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,es-MX;q=0.8',
}

const DEFAULT_SEARCH_TERMS = [
  'restaurant', 'best restaurant', 'fine dining', 'tasting menu', 'chef table',
  'michelin', 'award winning', 'romantic restaurant', 'business lunch',
  'rooftop', 'terrace', 'wine bar', 'cocktail bar', 'steakhouse', 'seafood',
  'sushi', 'omakase', 'japanese', 'italian', 'french', 'spanish', 'mexican',
  'oaxaca', 'tacos', 'breakfast', 'brunch', 'bakery', 'coffee', 'bar',
  'Polanco', 'Roma Norte', 'Roma Sur', 'Condesa', 'Hipodromo', 'Juarez',
  'Cuauhtemoc', 'Reforma', 'Centro Historico', 'Santa Fe', 'Lomas',
  'Bosques', 'San Angel', 'Coyoacan', 'Del Valle', 'Narvarte', 'Napoles',
  'Anzures', 'Granada', 'Masaryk', 'Miyana', 'Antara', 'Artz Pedregal',
  'World Trade Center', 'Chapultepec', 'La Condesa', 'La Roma',
]

const searchTerms = termsArg
  ? termsArg.split(',').map(t => t.trim()).filter(Boolean)
  : DEFAULT_SEARCH_TERMS

function decodeHtml(value) {
  if (!value) return null
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' '))
}

function getAttr(tag, attr) {
  return decodeHtml(tag?.match(new RegExp(`${attr}=["']([^"']+)["']`, 'i'))?.[1])
}

function absoluteUrl(url) {
  if (!url) return null
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return `${BASE}${url}`
  return url
}

async function fetchPage(url) {
  if (useBrowser) return fetchPageWithBrowser(url)
  if (curlOnly || domain !== 'restaurantguru.com') return fetchPageWithCurl(url, { retryBlocked: true })

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: HEADERS }).catch(e => {
      console.log(`  fetch failed: ${e.cause?.code || e.message}`)
      return null
    })
    if (!res) break
    if (res.ok) return res.text()

    console.log(`  HTTP ${res.status}: ${url}`)
    if (![429, 500, 502, 503, 504].includes(res.status)) return null
    if (attempt === 3) break
    await sleep(4000 * attempt)
  }
  return fetchPageWithCurl(url, { retryBlocked: true })
}

async function getBrowserPage() {
  if (browserPage) return browserPage

  browserContext = await chromium.launchPersistentContext(BROWSER_PROFILE, {
    headless: !headed,
    args: ['--no-sandbox'],
    userAgent: HEADERS['User-Agent'],
    locale: 'en-US',
    viewport: { width: 1440, height: 950 },
  })
  browserPage = browserContext.pages()[0] || await browserContext.newPage()
  return browserPage
}

async function fetchPageWithBrowser(url) {
  const page = await getBrowserPage()
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(2500)

  let html = await page.content()
  if (!isBlockedPage(html)) return html

  if (!headed) return html

  console.log(`  CAPTCHA visible. Termine-le dans le navigateur ouvert (${Math.round(captchaWaitMs / 1000)}s max)...`)
  const deadline = Date.now() + captchaWaitMs
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000).catch(() => null)
    if (page.isClosed()) return html
    html = await page.content()
    const cardCount = await page.locator('.card__title').count().catch(() => 0)
    if (cardCount >= 10 && !isBlockedPage(html)) return html
  }

  return html
}

async function fetchPageWithCurl(url, options = {}) {
  const attempts = options.retryBlocked ? Math.max(1, blockedRetries) : 1
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const { stdout } = await execFileAsync('curl', [
        '-sS',
        '-L',
        '--max-time',
        '12',
        url,
      ], { maxBuffer: 12 * 1024 * 1024 })

      if (stdout && (!isBlockedPage(stdout) || attempt === attempts)) return stdout
      console.log(`  curl anti-bot, pause ${Math.round(blockedDelayMs / 1000)}s puis retry ${attempt + 1}/${attempts}`)
    } catch (e) {
      console.log(`  curl fallback failed: ${e.message}`)
      if (attempt === attempts) return null
    }
    await sleep(blockedDelayMs)
  }
  return null
}

function extractMeta(html, name) {
  const re = new RegExp(`<meta\\s+(?:name|property)=["']${name}["']\\s+content=["']([^"']+)["']`, 'i')
  return decodeHtml(html.match(re)?.[1])
}

function isBlockedPage(html) {
  const text = html || ''
  if (/Suspicious activity detected|detected unusual traffic|unusual traffic from your computer network/i.test(text)) return true
  if (/<title>\s*(?:Just a moment|Attention Required|Access denied)/i.test(text)) return true

  const hasRestaurantContent = /card__title|rest-card__|restaurant_pic|RGPage\.page_type\s*=\s*["'](?:city|restaurant|restaurant_menu)/i.test(text)
  return /g_recaptcha|recaptcha_sitekey|g-recaptcha/i.test(text) && !hasRestaurantContent
}

function hasNextPage(html) {
  return /<link\s+rel=["']next["'][^>]+href=["'][^"']+["']/i.test(html || '')
}

function listingUrl(page) {
  return page === 1 ? `${BASE}${CITY_PATH}` : `${BASE}${CITY_PATH}/${page}`
}

function getMainRestaurantSection(html) {
  const start = html.indexOf('View all restaurants in Mexico City')
  if (start === -1) return html

  const nextSections = [
    html.indexOf('Food delivery in Mexico City', start + 1),
    html.indexOf('Best restaurants with desserts in Mexico City', start + 1),
    html.indexOf('Most popular restaurants in Mexico City', start + 1),
    html.indexOf('<footer', start + 1),
  ].filter(i => i > start)

  const end = nextSections.length ? Math.min(...nextSections) : html.length
  return html.slice(start, end)
}

function parseRestaurantCards(html, page) {
  const section = getMainRestaurantSection(html)
  const cards = []
  const parts = section.split(/<div[^>]+class="[^"]*swiper-slide\s+rest_small\s+click-item\s+card\s+card--rest[^"]*"[^>]*>/i).slice(1)

  for (const part of parts) {
    const card = part.split(/<div[^>]+class="[^"]*swiper-slide\s+rest_small\s+click-item\s+card\s+card--rest[^"]*"[^>]*>/i)[0]
    const titleTag = card.match(/<h3[^>]*class="[^"]*card__title[^"]*"[\s\S]*?(<a[^>]+>)/i)?.[1]
      || card.match(/<a[^>]+class="[^"]*(?:card__link|link-span)[^"]*"[^>]*>/i)?.[0]
    const url = absoluteUrl(getAttr(titleTag, 'href'))
    const name = getAttr(titleTag, 'title') || stripTags(card.match(/<h3[^>]*class="[^"]*card__title[^"]*"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1])

    if (!name || !url) continue
    if (url.includes('/guides/') || url.includes('/delivery-')) continue

    const image = absoluteUrl(decodeHtml(
      card.match(/<img[^>]+(?:data-src|src)="([^"]+)"[^>]*class="[^"]*(?:restaurant-img|card__image)[^"]*"/i)?.[1]
      || card.match(/<img[^>]+(?:data-src|src)="([^"]+)"/i)?.[1]
    ))

    const rating = parseFloat(card.match(/class="[^"]*card__rating-star[^"]*"[^>]*>\s*([\d.]+)/i)?.[1] ?? '')
    const priceTitle = decodeHtml(card.match(/class="[^"]*card__price[^"]*"[^>]*title="([^"]+)"/i)?.[1])
    const cuisine = stripTags(card.match(/class="[^"]*card__cuisine[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1])

    cards.push({
      source_id: url.replace(/^https?:\/\//, '').replace(/^www\./, ''),
      name,
      url,
      source_url: url,
      restaurantGuruUrl: url,
      rating: Number.isFinite(rating) ? rating : null,
      price: priceTitle,
      cuisine,
      image,
      rank: cards.length + 1 + ((page - 1) * 50),
      listingPage: page,
      source: 'restaurantguru',
    })
  }

  return dedupeByUrl(cards)
}

function normalizeRestaurantGuruUrl(url) {
  const value = absoluteUrl(url)
  if (!value) return null
  return value
    .replace(/^https:\/\/t\.restaurantguru\.com\//i, 'https://restaurantguru.com/')
    .split('?')[0]
    .replace(/\/$/, '')
}

function parseSearchCards(html, query) {
  const cards = []
  const parts = String(html || '').split(/<div[^>]+class="[^"]*v2\s+search_row\s+common-sugest\s+suggest-card[^"]*"[^>]*>/i).slice(1)

  for (const part of parts) {
    const card = part.split(/<div[^>]+class="[^"]*v2\s+search_row\s+common-sugest\s+suggest-card[^"]*"[^>]*>/i)[0]
    const linkTag = card.match(/<a[^>]+href=["'][^"']+["'][^>]*>\s*<h3[^>]+class=["'][^"']*suggest-card__title/i)?.[0]
      || card.match(/<a[^>]+href=["'][^"']+["'][^>]*>/i)?.[0]
    const url = normalizeRestaurantGuruUrl(getAttr(linkTag, 'href'))
    const name = stripTags(card.match(/<h3[^>]*class=["'][^"']*suggest-card__title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1])
    const rankText = stripTags(card.match(/<div[^>]+class=["'][^"']*suggest-card__rating-award[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1])
    const address = stripTags(card.match(/class=["'][^"']*suggest-card__address[^"']*["'][^>]*>\s*<span>([\s\S]*?)<\/span>/i)?.[1])

    if (!name || !url || !rankText || !/ in Mexico City\b/i.test(rankText)) continue
    if (url.includes('/guides/') || url.includes('/delivery-')) continue

    const rating = parseFloat(card.match(/class=["'][^"']*suggest-card__rating-star[^"']*["'][^>]*>\s*([\d.]+)/i)?.[1] ?? '')
    const image = absoluteUrl(decodeHtml(
      card.match(/<img[^>]+data-src=["']([^"']+)["'][^>]*class=["'][^"']*(?:restaurant-img|card__image|suggest-image)[^"']*/i)?.[1]
      || card.match(/<img[^>]+src=["']([^"']+)["'][^>]*class=["'][^"']*(?:restaurant-img|card__image|suggest-image)[^"']*/i)?.[1]
    ))
    const rankMatch = rankText.match(/#([\d,]+)\s+of\s+([\d,]+)\s+(.+?)\s+in\s+Mexico City/i)

    cards.push({
      source_id: url.replace(/^https?:\/\//, '').replace(/^www\./, ''),
      name,
      url,
      source_url: url,
      restaurantGuruUrl: url,
      rating: Number.isFinite(rating) ? rating : null,
      rank: rankMatch ? parseInt(rankMatch[1].replace(/,/g, ''), 10) : null,
      categoryTotal: rankMatch ? parseInt(rankMatch[2].replace(/,/g, ''), 10) : null,
      cuisine: rankMatch ? rankMatch[3] : null,
      restaurantGuruRankText: rankText,
      address,
      image: image?.includes('default_restaurant_icon') ? null : image,
      sourceQuery: query,
      source: 'restaurantguru',
    })
  }

  return dedupeByUrl(cards)
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
    || '',
    10
  )

  const photoCount = parseInt(
    html.match(/([\d,]+)\s+photos?/i)?.[1]?.replace(/,/g, '') || '',
    10
  )

  const instagram = decodeHtml(html.match(/https?:\/\/(?:www\.)?instagram\.com\/[^"'<\s]+/i)?.[0])
  const facebook = decodeHtml(html.match(/https?:\/\/(?:www\.)?facebook\.com\/[^"'<\s]+/i)?.[0])

  return {
    detailTitle: title,
    description,
    address,
    phone,
    website: website?.includes('restaurantguru.') || website?.includes('restaurant-guru.') ? null : website,
    menuUrl: menuUrl && menuUrl !== currentUrl ? menuUrl : null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
    photoCount: Number.isFinite(photoCount) ? photoCount : null,
    instagram,
    facebook,
  }
}

function dedupeByUrl(records) {
  const seen = new Map()
  for (const record of records) {
    const key = record.restaurantGuruUrl || record.name?.toLowerCase()
    if (!key) continue
    if (!seen.has(key)) {
      seen.set(key, record)
    } else {
      mergeRestaurantRecord(seen.get(key), record)
    }
  }
  return [...seen.values()]
}

function mergeRestaurantRecord(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined || value === '') continue
    if (target[key] === null || target[key] === undefined || target[key] === '') target[key] = value
  }

  if (Number.isFinite(source.rank) && (!Number.isFinite(target.rank) || source.rank < target.rank)) {
    target.rank = source.rank
  }

  const queries = new Set([
    ...(Array.isArray(target.sourceQueries) ? target.sourceQueries : []),
    target.sourceQuery,
    ...(Array.isArray(source.sourceQueries) ? source.sourceQueries : []),
    source.sourceQuery,
  ].filter(Boolean))
  if (queries.size > 0) target.sourceQueries = [...queries]

  return target
}

async function saveCheckpoint(records, meta = {}) {
  await mkdir(resolve('data/raw/restaurantguru'), { recursive: true })
  await writeFile(CHECKPOINT, JSON.stringify({
    savedAt: new Date().toISOString(),
    count: records.length,
    records: dedupeByUrl(records),
    ...meta,
  }, null, 2))
}

async function loadCheckpoint() {
  try {
    const raw = await readFile(CHECKPOINT, 'utf8')
    const json = JSON.parse(raw)
    return Array.isArray(json.records) ? json.records : []
  } catch {
    return []
  }
}

async function scrapeListings() {
  const records = resume ? await loadCheckpoint() : []
  const alreadySeen = new Set(records.map(r => r.restaurantGuruUrl).filter(Boolean))
  const donePages = new Set(records.map(r => r.listingPage).filter(Boolean))

  if (records.length > 0) {
    console.log(`Resume: ${records.length} records depuis ${CHECKPOINT}`)
  }

  for (let page = 1; page <= maxPages; page++) {
    if (resume && donePages.has(page)) continue
    const url = listingUrl(page)
    console.log(`[listing ${page}/${scrapeAllPages ? 'all' : maxPages}] ${url}`)
    const html = await fetchPage(url)
    if (!html) break
    if (isBlockedPage(html)) {
      console.log('  Blocage anti-bot Restaurant Guru detecte (reCAPTCHA). Stop.')
      blocked = true
      break
    }

    const pageRecords = parseRestaurantCards(html, page)
    console.log(`  ${pageRecords.length} restaurants`)
    if (pageRecords.length === 0) break

    for (const record of pageRecords) {
      if (!alreadySeen.has(record.restaurantGuruUrl)) {
        records.push(record)
        alreadySeen.add(record.restaurantGuruUrl)
      }
    }
    await saveCheckpoint(records, { phase: 'listing', lastPage: page })

    if (limit > 0 && records.length >= limit) break
    if (scrapeAllPages && !hasNextPage(html)) break
    await sleep(listingDelayMs)
  }

  return dedupeByUrl(limit > 0 ? records.slice(0, limit) : records)
}

async function fetchSearchTerm(query) {
  const params = new URLSearchParams({
    q: query,
    location: SEARCH_LOCATION_ID,
    type: 'short',
    client_time_hour: new Date().toISOString().slice(0, 19).replace('T', ' '),
    referer: 'https://restaurantguru.com/Mexico-City',
    hl: 'en_US',
  })

  try {
    const { stdout } = await execFileAsync('curl', [
      '-sS',
      '-L',
      '--max-time',
      '20',
      '-H',
      'X-Requested-With: XMLHttpRequest',
      `${SEARCH_BASE}/term?${params.toString()}`,
    ], { maxBuffer: 24 * 1024 * 1024 })

    if (!stdout) return null
    const json = JSON.parse(stdout)
    return typeof json.html === 'string' ? json.html : null
  } catch (e) {
    console.log(`  search failed "${query}": ${e.message}`)
    return null
  }
}

async function scrapeSearchApi() {
  const records = resume ? await loadCheckpoint() : []
  const byUrl = new Map(records.map(r => [r.restaurantGuruUrl, r]).filter(([url]) => Boolean(url)))

  if (records.length > 0) {
    console.log(`Resume: ${records.length} records depuis ${CHECKPOINT}`)
  }

  for (let i = 0; i < searchTerms.length; i++) {
    const query = searchTerms[i]
    console.log(`[search ${i + 1}/${searchTerms.length}] ${query}`)
    const html = await fetchSearchTerm(query)
    if (!html) {
      await sleep(listingDelayMs)
      continue
    }

    const found = parseSearchCards(html, query)
    let added = 0
    for (const record of found) {
      const existing = byUrl.get(record.restaurantGuruUrl)
      if (existing) {
        mergeRestaurantRecord(existing, record)
      } else {
        records.push(record)
        byUrl.set(record.restaurantGuruUrl, record)
        added++
      }
    }

    console.log(`  ${found.length} CDMX | +${added} nouveaux | total ${records.length}`)
    await saveCheckpoint(records, { phase: 'search-api', lastQuery: query, queryIndex: i + 1 })

    if (limit > 0 && records.length >= limit) break
    await sleep(listingDelayMs)
  }

  return dedupeByUrl(limit > 0 ? records.slice(0, limit) : records)
}

async function enrichDetails(records) {
  console.log(`\nDetails Restaurant Guru: ${records.length} pages`)
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    process.stdout.write(`[${i + 1}/${records.length}] ${record.name?.slice(0, 42)} `)
    const html = await fetchPage(record.restaurantGuruUrl)
    if (!html) {
      console.log('skip')
      continue
    }
    if (isBlockedPage(html)) {
      console.log('blocked')
      blocked = true
      continue
    }

    Object.assign(record, parseDetail(html, record.restaurantGuruUrl))
    console.log([
      record.reviewCount ? `${record.reviewCount} reviews` : null,
      record.photoCount ? `${record.photoCount} photos` : null,
      record.website ? 'site' : null,
      record.phone ? 'phone' : null,
    ].filter(Boolean).join(' | ') || 'ok')
    await saveCheckpoint(records, { phase: 'details', detailIndex: i + 1 })
    await sleep(detailDelayMs)
  }
}

function mapPrice(price) {
  const text = String(price || '').toLowerCase()
  if (text.includes('very expensive') || text.includes('expensive')) return 'haut'
  if (text.includes('moderate')) return 'moyen'
  if (text.includes('cheap') || text.includes('inexpensive')) return 'bas'
  return null
}

async function upsertLink(restaurantId, url, linkType, provider, confidenceScore = 0.85) {
  if (!restaurantId || !url) return
  const normalizedUrl = url.split('#')[0].replace(/\/$/, '')
  const host = new URL(normalizedUrl).hostname.replace(/^www\./, '')

  await supabase.from('restaurant_links').upsert({
    restaurant_id: restaurantId,
    url,
    normalized_url: normalizedUrl,
    host,
    source: 'restaurantguru',
    link_type: linkType,
    provider,
    status: 'candidate',
    confidence_score: confidenceScore,
    checked_at: new Date().toISOString(),
  }, { onConflict: 'restaurant_id,normalized_url' })
}

async function importToSupabase(records) {
  console.log(`\nImport Supabase Restaurant Guru: ${records.length} restaurants`)
  let created = 0
  let enriched = 0
  let errors = 0

  for (const r of records) {
    if (!r.name) continue

    const { data: existing, error: selectError } = await supabase
      .from('restaurants')
      .select('id, cuisine_type, sitio_web, instagram, facebook, gamme_prix')
      .ilike('nombre', r.name)
      .limit(1)

    if (selectError) {
      errors++
      continue
    }

    const patch = {
      cuisine_type: r.cuisine || undefined,
      sitio_web: r.website || undefined,
      instagram: r.instagram || undefined,
      facebook: r.facebook || undefined,
      telefono: r.phone || undefined,
      latitud: r.lat || undefined,
      longitud: r.lon || undefined,
      gamme_prix: mapPrice(r.price) || undefined,
      source: existing?.length ? undefined : 'restaurantguru',
      statut: existing?.length ? undefined : 'actif',
    }
    Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k])

    let restaurantId = existing?.[0]?.id

    if (restaurantId) {
      if (Object.keys(patch).length > 0) {
        await supabase.from('restaurants').update(patch).eq('id', restaurantId)
      }
      enriched++
    } else {
      const { data: inserted, error } = await supabase
        .from('restaurants')
        .insert({ nombre: r.name, ...patch })
        .select('id')
        .single()
      if (error) {
        errors++
        continue
      }
      restaurantId = inserted.id
      created++
    }

    await upsertLink(restaurantId, r.restaurantGuruUrl, 'review', 'restaurantguru', 0.9)
    await upsertLink(restaurantId, r.menuUrl, 'menu', 'restaurantguru', 0.75)
    await upsertLink(restaurantId, r.website, 'official_site', 'website', 0.7)
  }

  console.log(`Nouveaux: ${created} | Enrichis: ${enriched} | Erreurs: ${errors}`)
}

async function main() {
  console.log(`Restaurant Guru CDMX | mode=${useSearchApi ? 'search-api' : 'listing'} | domain=${domain} | pages=${scrapeAllPages ? 'all' : maxPages} | details=${withDetails ? 'oui' : 'non'} | import=${importDb ? 'oui' : 'non'} | resume=${resume ? 'oui' : 'non'}`)

  const records = useSearchApi ? await scrapeSearchApi() : await scrapeListings()
  if (withDetails && records.length > 0) await enrichDetails(records)

  if (records.length === 0) {
    console.log('\nAucun record extrait; export existant conserve.')
  } else {
    await mkdir(resolve('data/raw/restaurantguru'), { recursive: true })
    await writeFile(OUTPUT, JSON.stringify(records, null, 2))
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Restaurants uniques: ${records.length}`)
  console.log(`Avec rating: ${records.filter(r => r.rating).length}`)
  console.log(`Avec prix: ${records.filter(r => r.price).length}`)
  console.log(`Avec cuisine: ${records.filter(r => r.cuisine).length}`)
  console.log(`Avec site officiel: ${records.filter(r => r.website).length}`)
  console.log(`Avec menu URL: ${records.filter(r => r.menuUrl).length}`)
  console.log(`Export: ${OUTPUT}`)

  if (importDb && records.length > 0) {
    await importToSupabase(records)
  } else {
    console.log('\nRelancer avec --import pour upserter Supabase.')
  }

  if (browserContext) await browserContext.close()

  if (blocked) {
    console.log('\nRun interrompu: Restaurant Guru a servi une page anti-bot/reCAPTCHA.')
    process.exitCode = 2
  }
}

main().catch(async e => {
  if (browserContext) await browserContext.close().catch(() => {})
  console.error(e)
  process.exit(1)
})
