// Deep, free crawl of official websites for premium restaurants missing menus.
// Writes immutable raw evidence plus derived local links/documents; never restaurants.
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeUrl, hostFromUrl } from './lib/normalize.js'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const arg = (name, fallback) => {
  const value = process.argv.find(item => item.startsWith(`--${name}=`))
  return value ? value.split('=').slice(1).join('=') : fallback
}
const LIMIT = Number(arg('limit', 0))
const CONCURRENCY = Number(arg('concurrency', 10))
const TIMEOUT = Number(arg('timeout', 9000))
const MAX_PAGES = Number(arg('pages', 10))
const SCOPE = arg('scope', 'all')
const now = new Date().toISOString()
const date = now.slice(0, 10)
const outDir = resolve('data/raw/official_website_deep')
const dailyOutPath = resolve(outDir, `${date}.json`)
const runStamp = now.slice(11, 19).replaceAll(':', '-')
const outPath = existsSync(dailyOutPath) ? resolve(outDir, `${date}-${runStamp}.json`) : dailyOutPath

const menuWords = /\b(menu|men[uú]|menus|carta|cartas|platillos|food menu|drink menu|wine list|vinos|bebidas|brunch|desayunos?)\b/i
const crawlWords = /\b(menu|men[uú]|carta|gastronom|cocina|comida|food|eat|drink|bar|brunch|desayuno|lunch|dinner|restaurante|restaurant|ordenar|pedido)\b/i
const foodWords = /\b(taco|tostada|sopa|ensalada|carne|pollo|pescado|marisco|pulpo|at[uú]n|salm[oó]n|pasta|pizza|hamburguesa|postre|vino|cerveza|coctel|desayuno|entrada|sushi|ramen|ceviche|mole|pozole)\b/gi
const badWords = /privacy|privacidad|cookies|legal|aviso|contact|ubicaci[oó]n|location|careers?|empleo|facturaci[oó]n|login|account/i
const socialHost = /(^|\.)(instagram|facebook|tiktok|youtube|x|twitter)\.com$/i

function stripHtml(value) {
  return String(value || '').replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
}
function canonicalUrl(value, base) {
  try {
    let candidate = String(value || '').trim().replace(/\\\//g, '/')
    if (!candidate) return null
    if (!base && !/^[a-z][a-z\d+.-]*:/i.test(candidate)) candidate = `https://${candidate.replace(/^\/+/, '')}`
    const url = new URL(candidate, base)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key)
    }
    return url.href
  } catch { return null }
}
function sameSite(a, b) {
  try {
    const ah = new URL(a).hostname.replace(/^www\./, '')
    const bh = new URL(b).hostname.replace(/^www\./, '')
    return ah === bh
  } catch { return false }
}
function fileType(url) {
  try {
    const path = new URL(url).pathname
    if (/\.pdf$/i.test(path)) return 'pdf'
    if (/\.(?:jpe?g|png|webp|gif|svg)$/i.test(path)) return 'image'
  } catch { /* invalid */ }
  return 'html'
}
function assetHasMenuName(url) {
  try {
    const filename = decodeURIComponent(new URL(url).pathname.split('/').at(-1) || '')
    return /(menu|men[uú]|carta|desayun|comida|bebida|postre|taco|paquete|ensalada|dona)/i.test(filename)
  } catch { return false }
}
function rejectCandidate(url, type) {
  const value = String(url || '').replaceAll('&amp;', '&')
  if (/opentable\.[^/]+\/s\/dinerschoice/i.test(value)) return true
  if (/(?:sitemap[^/]*\.xml)(?:\?|$)/i.test(value)) return true
  if (/likingrestaurant\.com/i.test(value)) return true
  if (/\.(?:gif|svg)(?:\?|$)/i.test(value)) return true
  if (type === 'image' && !assetHasMenuName(value)) return true
  if (type === 'image' && /(?:[-_]150x150|\/animations\/|game-code|(?:^|[-_])logo(?:[-_.]|$))/i.test(value)) return true
  return false
}
function linkScore(url, anchor) {
  const text = `${anchor || ''} ${url}`
  let score = 0
  if (menuWords.test(text)) score += 10
  if (crawlWords.test(text)) score += 4
  if (/\.pdf(?:\?|$)/i.test(url)) score += 8
  if (badWords.test(text)) score -= 10
  return score
}
function extractLinks(html, baseUrl) {
  const links = new Map()
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = anchorRe.exec(html)) !== null) {
    const url = canonicalUrl(match[1].replaceAll('&amp;', '&'), baseUrl)
    if (!url) continue
    let host = ''
    try { host = new URL(url).hostname } catch { continue }
    if (socialHost.test(host)) continue
    const anchor = stripHtml(match[2])
    const score = linkScore(url, anchor)
    const type = fileType(url)
    if (!rejectCandidate(url, type)) links.set(url, { url, anchor, score, type })
    try {
      const nested = new URL(url.replaceAll('&amp;', '&')).searchParams.get('file')
      const nestedUrl = nested ? canonicalUrl(decodeURIComponent(nested)) : null
      if (nestedUrl && /\.pdf(?:\?|$)/i.test(nestedUrl) && !rejectCandidate(nestedUrl, 'pdf')) {
        links.set(nestedUrl, { url: nestedUrl, anchor, score: Math.max(score, 18), type: 'pdf' })
      }
    } catch { /* no nested document */ }
  }
  // Menus are also commonly embedded in iframes, object tags or image links.
  const embeddedRe = /<(?:iframe|embed|object|img)\b[^>]*(?:src|data)=["']([^"']+)["'][^>]*>/gi
  while ((match = embeddedRe.exec(html)) !== null) {
    const url = canonicalUrl(match[1], baseUrl)
    if (!url) continue
    const context = html.slice(Math.max(0, match.index - 180), Math.min(html.length, embeddedRe.lastIndex + 180))
    const score = linkScore(url, stripHtml(context))
    const type = fileType(url)
    if (score > 0 && !rejectCandidate(url, type)) links.set(url, { url, anchor: stripHtml(context), score, type })
  }
  // PDFs/images are often embedded in scripts rather than anchors.
  const assetRe = /(?:https?:)?\\?\/\\?\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+?\.(?:pdf|jpe?g|png|webp)(?:\?[^"'<>\s\\]*)?/gi
  while ((match = assetRe.exec(html)) !== null) {
    const raw = match[0].replace(/\\\//g, '/').replace(/^\/\//, 'https://')
    const url = canonicalUrl(raw, baseUrl)
    if (!url) continue
    const score = linkScore(url, '')
    const type = fileType(url)
    if (score > 0 && !rejectCandidate(url, type)) links.set(url, { url, anchor: '', score, type })
  }
  return [...links.values()]
}
function looksLikeMenu(html, url) {
  const text = stripHtml(html).slice(0, 200_000)
  const prices = (text.match(/(?:\$\s*\d{2,4}|\b(?:mxn|m\.n\.)\s*\$?\s*\d{2,4}(?:\.\d{2})?|\b\d{2,4}(?:\.\d{2})?\s*(?:mxn|pesos|m\.n\.)\b)/gi) || []).length
  const foods = new Set((text.match(foodWords) || []).map(value => value.toLowerCase())).size
  const signalled = menuWords.test(`${url} ${text.slice(0, 1000)}`)
  return { yes: (signalled && prices >= 3 && foods >= 2) || (prices >= 8 && foods >= 4), prices, foods }
}
const userAgents = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
]

async function fetchText(url, accept = 'text/html,application/xhtml+xml,*/*;q=0.8') {
  let reason = 'fetch_failed'
  for (const userAgent of userAgents) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT)
    try {
      const response = await fetch(url, {
        redirect: 'follow', signal: controller.signal,
        headers: { 'User-Agent': userAgent, Accept: accept, 'Accept-Language': 'es-MX,es;q=0.9,en;q=0.7' },
      })
      if (!response.ok) {
        reason = `http_${response.status}`
        continue
      }
      const body = (await response.text()).slice(0, 4_000_000)
      if (!body.trim()) {
        reason = 'empty_body'
        continue
      }
      return { ok: true, url: response.url, body, contentType: response.headers.get('content-type') || '' }
    } catch (error) {
      reason = error?.name === 'AbortError' ? 'timeout' : (error?.cause?.code || 'fetch_failed').toLowerCase()
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, reason }
}

async function fetchHtml(url) {
  const result = await fetchText(url)
  if (!result.ok) return result
  if (!result.contentType.includes('text/html') && !/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(result.body)) {
    return { ok: false, reason: 'not_html' }
  }
  return { ok: true, url: result.url, html: result.body }
}

function startUrls(value) {
  const primary = canonicalUrl(value)
  if (!primary) return []
  const urls = new Set([primary])
  try {
    const parsed = new URL(primary)
    const hosts = new Set([parsed.hostname])
    if (parsed.hostname.startsWith('www.')) hosts.add(parsed.hostname.slice(4))
    else hosts.add(`www.${parsed.hostname}`)
    for (const protocol of ['https:', 'http:']) {
      for (const hostname of hosts) {
        const candidate = new URL(primary)
        candidate.protocol = protocol
        candidate.hostname = hostname
        urls.add(candidate.href)
      }
    }
  } catch { /* primary was already validated */ }
  return [...urls]
}

async function sitemapMenuLinks(homeUrl) {
  let origin
  try { origin = new URL(homeUrl).origin } catch { return [] }
  const sitemapUrls = new Set([`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`])
  const robots = await fetchText(`${origin}/robots.txt`, 'text/plain,*/*;q=0.5')
  if (robots.ok) {
    for (const match of robots.body.matchAll(/^sitemap:\s*(\S+)/gim)) sitemapUrls.add(match[1])
  }
  const found = new Map()
  let fetched = 0
  for (const sitemapUrl of sitemapUrls) {
    if (fetched++ >= 4) break
    const sitemap = await fetchText(sitemapUrl, 'application/xml,text/xml,*/*;q=0.5')
    if (!sitemap.ok) continue
    for (const match of sitemap.body.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)) {
      const url = canonicalUrl(match[1].replaceAll('&amp;', '&'))
      if (!url || !menuWords.test(url)) continue
      found.set(url, { url, anchor: 'sitemap menu', score: 18, type: fileType(url) })
    }
  }
  return [...found.values()]
}

db.exec(`CREATE TABLE IF NOT EXISTS premium_menu_deep_crawl_log (
  restaurant_id TEXT, website TEXT, pages_crawled INTEGER, menu_links INTEGER,
  status TEXT, reason TEXT, crawled_at TEXT
)`)

let targets = db.prepare(`
  SELECT q.restaurant_id id, q.priority_score, s.rank_overall, s.name, s.address,
    s.lat, s.lng, s.phone, g.website
  FROM premium_enrichment_queue q
  JOIN restaurant_search_mv s ON s.id = q.restaurant_id
  JOIN restaurant_golden_record g ON g.restaurant_id = q.restaurant_id
  WHERE q.status = 'menu_ready' AND g.website IS NOT NULL
  ORDER BY q.priority_score DESC, s.rank_overall
`).all()
if (SCOPE === 'failed') {
  const failed = new Set(db.prepare(`
    WITH latest AS (
      SELECT restaurant_id, status,
        ROW_NUMBER() OVER (PARTITION BY restaurant_id ORDER BY crawled_at DESC) rn
      FROM premium_menu_deep_crawl_log
    )
    SELECT restaurant_id FROM latest WHERE rn=1 AND status='failed'
  `).all().map(row => row.restaurant_id))
  targets = targets.filter(row => failed.has(row.id))
} else if (SCOPE === 'empty') {
  const empty = new Set(db.prepare(`
    WITH latest AS (
      SELECT restaurant_id, status, menu_links,
        ROW_NUMBER() OVER (PARTITION BY restaurant_id ORDER BY crawled_at DESC) rn
      FROM premium_menu_deep_crawl_log
    )
    SELECT restaurant_id FROM latest WHERE rn=1 AND status='ok' AND menu_links=0
  `).all().map(row => row.restaurant_id))
  targets = targets.filter(row => empty.has(row.id))
} else if (SCOPE !== 'all') {
  throw new Error(`Scope inconnu: ${SCOPE}. Utiliser all, failed ou empty.`)
}
targets = targets.slice(0, LIMIT > 0 ? LIMIT : undefined)
const log = db.prepare('INSERT INTO premium_menu_deep_crawl_log VALUES (?,?,?,?,?,?,?)')
const linkExists = db.prepare('SELECT 1 FROM restaurant_links WHERE restaurant_id=? AND normalized_url=?')
const insertLink = db.prepare(`INSERT INTO restaurant_links
  (id,restaurant_id,url,normalized_url,host,source,link_type,provider,status,confidence_score,checked_at,created_at,updated_at)
  VALUES (?,?,?,?,?,'official_website_deep','menu','website','valid',?,?,?,?)`)
const menuExists = db.prepare('SELECT 1 FROM menu_documents WHERE restaurant_id=? AND source_url=?')
const insertMenu = db.prepare(`INSERT INTO menu_documents
  (id,restaurant_id,source_url,file_type,raw_text,langue,confidence_score,extraction_method,statut,last_checked_at,created_at,updated_at)
  VALUES (?,?,?,?,NULL,'es',?,'official_website_deep','pending',?,?,?)`)

function persist(target, menuLinks) {
  db.exec('BEGIN')
  try {
    for (const item of menuLinks) {
      const normalized = normalizeUrl(item.url)
      if (!normalized) continue
      if (!linkExists.get(target.id, normalized)) {
        insertLink.run(randomUUID(), target.id, item.url, normalized, hostFromUrl(item.url), item.confidence, now, now, now)
      }
      if (!menuExists.get(target.id, item.url)) {
        insertMenu.run(randomUUID(), target.id, item.url, item.type, item.confidence, now, now, now)
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

async function crawl(target) {
  const starts = startUrls(target.website)
  if (!starts.length) return { ok: false, reason: 'invalid_website', pages: [], menus: [] }
  const start = starts[0]
  const queue = starts.map((url, index) => ({ url, depth: 0, score: 100 - index }))
  const seen = new Set()
  const pages = []
  const menus = new Map()
  const failures = new Map()
  let sitemapChecked = false

  while (queue.length && pages.length < MAX_PAGES) {
    queue.sort((a, b) => b.score - a.score)
    const current = queue.shift()
    if (!current || seen.has(current.url)) continue
    seen.add(current.url)
    const page = await fetchHtml(current.url)
    if (!page.ok) {
      failures.set(page.reason, (failures.get(page.reason) || 0) + 1)
      continue
    }
    seen.add(page.url)
    const menuSignal = looksLikeMenu(page.html, page.url)
    pages.push({ url: page.url, depth: current.depth, prices: menuSignal.prices, foods: menuSignal.foods })
    if (menuSignal.yes) menus.set(page.url, { url: page.url, type: 'html', confidence: 0.9 })

    if (!sitemapChecked) {
      sitemapChecked = true
      for (const link of await sitemapMenuLinks(page.url)) {
        menus.set(link.url, { url: link.url, type: link.type, confidence: link.type === 'pdf' ? 0.98 : 0.9 })
        if (link.type === 'html' && sameSite(page.url, link.url) && !seen.has(link.url)) {
          queue.push({ url: link.url, depth: 1, score: link.score })
        }
      }
    }

    for (const link of extractLinks(page.html, page.url)) {
      const explicitMenu = link.score >= 8 || (link.type !== 'html' && menuWords.test(`${link.url} ${link.anchor}`))
      if (explicitMenu) menus.set(link.url, { url: link.url, type: link.type, confidence: link.type === 'pdf' ? 0.98 : 0.88 })
      if (current.depth < 2 && link.type === 'html' && sameSite(start, link.url) && link.score >= 3 && !seen.has(link.url)) {
        queue.push({ url: link.url, depth: current.depth + 1, score: link.score })
      }
    }
  }
  const reason = pages.length ? null : ([...failures.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'fetch_failed')
  return { ok: pages.length > 0, reason, pages, menus: [...menus.values()] }
}

console.log(`Deep crawl menus — ${targets.length} sites (${SCOPE}), ${CONCURRENCY} workers, max ${MAX_PAGES} pages/site`)
let cursor = 0
const rawRecords = []
const stats = { ok: 0, failed: 0, withMenus: 0, menuLinks: 0, pages: 0 }
async function worker() {
  while (cursor < targets.length) {
    const target = targets[cursor++]
    const result = await crawl(target)
    if (!result.ok) {
      stats.failed++
      log.run(target.id, target.website, 0, 0, 'failed', result.reason, now)
      continue
    }
    persist(target, result.menus)
    stats.ok++
    stats.pages += result.pages.length
    stats.menuLinks += result.menus.length
    stats.withMenus += Number(result.menus.length > 0)
    log.run(target.id, target.website, result.pages.length, result.menus.length, 'ok', null, now)
    rawRecords.push({
      source_id: `official_website_deep:${target.id}:${date}`,
      name: target.name, latitude: target.lat, longitude: target.lng,
      address: target.address, phone: target.phone, website: target.website,
      payload: {
        canonical_restaurant_id: target.id, source_url: target.website,
        pages_crawled: result.pages, menu_links: result.menus.map(item => item.url),
        discovered_links: result.menus.map(item => ({ url: item.url, type: 'menu', provider: 'website', confidence: item.confidence })),
        crawled_at: now,
      },
    })
    const done = stats.ok + stats.failed
    if (done % 25 === 0) console.log(`${done}/${targets.length} · ${stats.withMenus} avec menus`)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
mkdirSync(outDir, { recursive: true })
writeFileSync(outPath, JSON.stringify(rawRecords, null, 2))
console.log(JSON.stringify({ ...stats, raw_records: rawRecords.length, outPath }))
db.close()
