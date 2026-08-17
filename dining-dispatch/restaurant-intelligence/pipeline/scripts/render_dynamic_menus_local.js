// Headless-browser fallback for premium restaurant websites that plain fetch
// cannot render. Local raw evidence + derived menu tables only; never Supabase.
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { hostFromUrl, normalizeUrl } from './lib/normalize.js'

const arg = (name, fallback) => {
  const value = process.argv.find(item => item.startsWith(`--${name}=`))
  return value ? value.split('=').slice(1).join('=') : fallback
}
const LIMIT = Number(arg('limit', 100))
const CONCURRENCY = Number(arg('concurrency', 2))
const TIMEOUT = Number(arg('timeout', 18000))
const MAX_MENU_PAGES = Number(arg('pages', 4))
const SCOPE = arg('scope', 'failed')
const now = new Date().toISOString()
const stamp = now.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))

const menuWords = /\b(menu|men[uú]|carta|platillos|food|comida|bebidas?|drinks?|vinos?|wine|desayunos?|brunch|lunch|dinner)\b/i
const foodWords = /\b(tacos?|tostadas?|sopa|ensalada|carne|pollo|pescado|marisco|pulpo|at[uú]n|salm[oó]n|cerdo|pasta|pizza|hamburguesa|postre|caf[eé]|vino|cerveza|coctel|sushi|ramen|ceviche|mole|pozole|crepa)\b/gi
const blockedHosts = /(^|\.)(facebook|instagram|tiktok|youtube|twitter|x)\.com$/i
const badUrls = /(?:privacy|privacidad|aviso[_-]?privacidad|legal|t[eé]rminos|terms|tyc|contact|careers?|login|sitemap|opentable\.[^/]+\/s\/dinerschoice)/i

function webUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  try { return new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`).href } catch { return null }
}
function fileType(url) {
  try {
    const path = new URL(url).pathname
    if (/\.pdf$/i.test(path)) return 'pdf'
    if (/\.(?:jpe?g|png|webp)$/i.test(path)) return 'image'
  } catch { /* invalid */ }
  return 'html'
}
function assess(text, url) {
  const body = String(text || '').slice(0, 80_000)
  const prices = (body.match(/(?:\$\s*\d{2,4}|\b(?:mxn|m\.n\.)\s*\$?\s*\d{2,4}(?:\.\d{2})?|\b\d{2,4}(?:\.\d{2})?\s*(?:mxn|pesos|m\.n\.)\b)/gi) || []).length
  const foods = new Set((body.match(foodWords) || []).map(value => value.toLowerCase())).size
  const signalled = menuWords.test(`${url} ${body.slice(0, 1200)}`)
  return { prices, foods, yes: body.length >= 200 && ((signalled && prices >= 2) || (prices >= 5 && foods >= 2) || (signalled && foods >= 5)) }
}
function candidateScore(url, text) {
  if (badUrls.test(url)) return -100
  let score = 0
  if (menuWords.test(`${url} ${text}`)) score += 10
  if (/\.pdf(?:\?|$)/i.test(url)) score += 8
  if (/(?:menu|carta|food|bebida|vino|desayuno|brunch)/i.test(new URL(url).pathname)) score += 5
  return score
}
function cleanText(value) {
  return String(value || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 50_000)
}

db.exec(`CREATE TABLE IF NOT EXISTS premium_menu_browser_log (
  restaurant_id TEXT, website TEXT, status TEXT, pages_rendered INTEGER,
  menu_documents INTEGER, reason TEXT, rendered_at TEXT
)`)

const baseQuery = `
  WITH latest AS (
    SELECT restaurant_id,status,menu_links,
      ROW_NUMBER() OVER(PARTITION BY restaurant_id ORDER BY crawled_at DESC) rn
    FROM premium_menu_deep_crawl_log
  ), latest_browser AS (
    SELECT restaurant_id,status,
      ROW_NUMBER() OVER(PARTITION BY restaurant_id ORDER BY rendered_at DESC) rn
    FROM premium_menu_browser_log
  )
  SELECT q.restaurant_id id,q.name,q.priority_score,q.rank_overall,q.website,
    COALESCE(l.status,'untried') crawl_status,COALESCE(l.menu_links,0) crawl_menu_links,
    COALESCE(b.status,'untried') browser_status
  FROM premium_enrichment_queue q
  LEFT JOIN latest l ON l.restaurant_id=q.restaurant_id AND l.rn=1
  LEFT JOIN latest_browser b ON b.restaurant_id=q.restaurant_id AND b.rn=1
  WHERE q.status='menu_ready' AND q.website IS NOT NULL
`
let targets = db.prepare(`${baseQuery}
  ORDER BY CASE WHEN COALESCE(l.status,'untried')='failed' THEN 0 ELSE 1 END,
    q.priority_score DESC,q.rank_overall
`).all()
if (SCOPE === 'failed') targets = targets.filter(row => row.crawl_status === 'failed' && row.browser_status === 'untried')
else if (SCOPE === 'empty') targets = targets.filter(row => row.crawl_status === 'ok' && row.crawl_menu_links === 0 && row.browser_status === 'untried')
else if (SCOPE === 'all') { /* keep all */ }
else throw new Error(`Scope inconnu: ${SCOPE}`)
targets = targets.slice(0, LIMIT > 0 ? LIMIT : undefined)

const linkExists = db.prepare('SELECT 1 FROM restaurant_links WHERE restaurant_id=? AND normalized_url=?')
const insertLink = db.prepare(`INSERT INTO restaurant_links
  (id,restaurant_id,url,normalized_url,host,source,link_type,provider,status,confidence_score,checked_at,created_at,updated_at)
  VALUES (?,?,?,?,?,'official_website_browser','menu','website','valid',?,?,?,?)`)
const documentExists = db.prepare('SELECT 1 FROM menu_documents WHERE restaurant_id=? AND source_url=?')
const insertDocument = db.prepare(`INSERT INTO menu_documents
  (id,restaurant_id,source_url,file_type,raw_text,langue,confidence_score,extraction_method,statut,last_checked_at,created_at,updated_at)
  VALUES (?,?,?,?,?,'es',?,'playwright_local',?,?,?,?)`)
const insertLog = db.prepare('INSERT INTO premium_menu_browser_log VALUES (?,?,?,?,?,?,?)')

function persist(target, document) {
  const normalized = normalizeUrl(document.url)
  if (!normalized) return false
  if (!linkExists.get(target.id, normalized)) {
    insertLink.run(randomUUID(), target.id, document.url, normalized, hostFromUrl(document.url), document.confidence, now, now, now)
  }
  if (documentExists.get(target.id, document.url)) return false
  const status = document.text ? 'extracted' : 'pending'
  insertDocument.run(randomUUID(), target.id, document.url, document.type, document.text || null,
    document.confidence, status, now, now, now)
  return true
}

async function renderedPage(page, url) {
  try {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT })
    if (response && response.status() >= 400) return { ok: false, reason: `http_${response.status()}` }
    await page.waitForTimeout(800)
    const title = await page.title().catch(() => '')
    const text = cleanText(await page.locator('body').innerText({ timeout: 3000 }).catch(() => ''))
    const links = await page.locator('a[href],iframe[src],embed[src],object[data]').evaluateAll(elements => elements.map(element => ({
      href: element.getAttribute('href') || element.getAttribute('src') || element.getAttribute('data'),
      text: (element.textContent || element.getAttribute('aria-label') || element.getAttribute('title') || '').trim(),
    }))).catch(() => [])
    return { ok: true, url: page.url(), title, text, links }
  } catch (error) {
    return { ok: false, reason: error?.name === 'TimeoutError' ? 'timeout' : 'browser_failed' }
  }
}

async function processTarget(page, target) {
  const website = webUrl(target.website)
  if (!website) return { ok: false, reason: 'invalid_website', documents: [], pages: [] }
  let home = await renderedPage(page, website)
  if (!home.ok && website.startsWith('https://')) home = await renderedPage(page, website.replace(/^https:/, 'http:'))
  if (!home.ok) return { ok: false, reason: home.reason, documents: [], pages: [] }

  const pages = [{ url: home.url, title: home.title, ...assess(home.text, home.url) }]
  const documents = new Map()
  const homeSignal = assess(home.text, home.url)
  if (homeSignal.yes) documents.set(home.url, { url: home.url, type: 'html', text: home.text, confidence: 0.88 })

  const candidates = new Map()
  for (const link of home.links) {
    let url
    try { url = new URL(String(link.href || '').replaceAll('&amp;', '&'), home.url).href } catch { continue }
    let host
    try { host = new URL(url).hostname } catch { continue }
    if (blockedHosts.test(host) || badUrls.test(url)) continue
    const score = candidateScore(url, link.text)
    if (score < 8) continue
    candidates.set(url, { url, score, type: fileType(url) })
    try {
      const nested = new URL(url).searchParams.get('file')
      if (nested && /\.pdf(?:\?|$)/i.test(nested)) candidates.set(nested, { url: nested, score: 30, type: 'pdf' })
    } catch { /* no nested file */ }
  }

  for (const candidate of [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, MAX_MENU_PAGES)) {
    if (candidate.type !== 'html') {
      documents.set(candidate.url, { url: candidate.url, type: candidate.type, text: null, confidence: candidate.type === 'pdf' ? 0.98 : 0.82 })
      continue
    }
    const rendered = await renderedPage(page, candidate.url)
    if (!rendered.ok) continue
    const signal = assess(rendered.text, rendered.url)
    pages.push({ url: rendered.url, title: rendered.title, ...signal })
    if (signal.yes) documents.set(rendered.url, { url: rendered.url, type: 'html', text: rendered.text, confidence: 0.94 })
  }
  return { ok: true, reason: null, documents: [...documents.values()], pages }
}

console.log(`Browser menus local — ${targets.length} sites (${SCOPE}), ${CONCURRENCY} pages`)
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({
  locale: 'es-MX', ignoreHTTPSErrors: true,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
})
await context.route('**/*', route => {
  const type = route.request().resourceType()
  if (['font', 'media'].includes(type)) route.abort()
  else route.continue()
})

let cursor = 0
const raw = []
const stats = { ok: 0, failed: 0, with_menus: 0, new_documents: 0, pages: 0 }
async function worker() {
  const page = await context.newPage()
  while (cursor < targets.length) {
    const target = targets[cursor++]
    const result = await processTarget(page, target)
    let newDocuments = 0
    if (result.ok) {
      db.exec('BEGIN')
      try {
        for (const document of result.documents) newDocuments += Number(persist(target, document))
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      stats.ok++
      stats.with_menus += Number(result.documents.length > 0)
      stats.new_documents += newDocuments
      stats.pages += result.pages.length
    } else stats.failed++
    insertLog.run(target.id, target.website, result.ok ? 'ok' : 'failed', result.pages.length,
      result.documents.length, result.reason, now)
    raw.push({ restaurant_id: target.id, name: target.name, website: target.website,
      status: result.ok ? 'ok' : 'failed', reason: result.reason, pages: result.pages,
      menu_documents: result.documents.map(item => ({ url: item.url, type: item.type, confidence: item.confidence })) })
    const done = stats.ok + stats.failed
    if (done % 10 === 0) console.log(`${done}/${targets.length} · ${stats.with_menus} menus · ${stats.new_documents} nouveaux docs`)
  }
  await page.close()
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
await browser.close()

const outDir = resolve('data/raw/official_website_browser')
mkdirSync(outDir, { recursive: true })
const outPath = resolve(outDir, `${stamp}.json`)
writeFileSync(outPath, `${JSON.stringify(raw, null, 2)}\n`)
console.log(JSON.stringify({ ...stats, outPath }))
db.close()
