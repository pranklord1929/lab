// Free enrichment of the premium product pool from official websites only.
// Discovers Instagram/social links and menu URLs without touching restaurants.
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { normalizeUrl, hostFromUrl } from './lib/normalize.js'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const arg = (name, fallback) => {
  const value = process.argv.find(item => item.startsWith(`--${name}=`))
  return value ? value.split('=').slice(1).join('=') : fallback
}
const CONCURRENCY = Number(arg('concurrency', 10))
const TIMEOUT = Number(arg('timeout', 9000))
const LIMIT = Number(arg('limit', 0))
const now = new Date().toISOString()
const today = now.slice(0, 10)
const OUT_DIR = resolve('data/raw/official_website')
const OUT_PATH = resolve(OUT_DIR, `${today}.json`)
const blockedWebsite = /facebook\.com|instagram\.com|opentable|rappi|ubereats|tripadvisor/i
const menuWords = /\b(menu|menú|menus|carta|cartas|food|comida|bebidas|drinks|brunch|desayuno|wine|vinos)\b/i

function stripHtml(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim()
}

function websiteUrl(value) {
  if (!value || blockedWebsite.test(value)) return null
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).href } catch { return null }
}

function instagramProfile(value) {
  try {
    const url = new URL(value)
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null
    const handle = url.pathname.split('/').filter(Boolean)[0]
    if (!handle || /^(p|reel|reels|stories|explore|accounts|share)$/i.test(handle)) return null
    if (/^(wix|embed\.js|latentestudio|itsmakehq|reservandonos)$/i.test(handle)) return null
    return `https://www.instagram.com/${handle.replace(/^@/, '')}/`
  } catch { return null }
}

function socialScore(name, value) {
  let handle = ''
  try { handle = new URL(value).pathname.split('/').filter(Boolean)[0]?.toLowerCase() || '' } catch { return -1 }
  const compact = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '')
  const foldedHandle = compact(handle)
  const tokens = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter(token => token.length >= 4 && !/^(restaurante|restaurant|cafe|sucursal|ciudad|mexico)$/.test(token))
  let score = tokens.filter(token => foldedHandle.includes(token)).length * 10
  const foldedName = compact(name).replace(/restaurante|restaurant|cafe/g, '')
  if (foldedName.length >= 4 && foldedHandle.includes(foldedName)) score += 15
  if (/mx|mexico/.test(foldedHandle)) score += 2
  return score
}

function facebookProfile(value) {
  try {
    const url = new URL(value)
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null
    if (/\/sharer|\/share\.php/i.test(url.pathname)) return null
    url.search = ''; url.hash = ''
    return url.href
  } catch { return null }
}

function extractJsonLd(html) {
  const values = []
  const regex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    try { values.push(JSON.parse(match[1].trim())) } catch { /* malformed schema */ }
  }
  return values
}

function walk(value, output = []) {
  if (!value || typeof value !== 'object') return output
  output.push(value)
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(item => walk(item, output))
    else if (child && typeof child === 'object') walk(child, output)
  }
  return output
}

function schemaHours(html) {
  for (const node of extractJsonLd(html).flatMap(value => walk(value))) {
    if (node.openingHours) return Array.isArray(node.openingHours) ? node.openingHours.join(' | ') : String(node.openingHours)
    if (node.openingHoursSpecification) return JSON.stringify(node.openingHoursSpecification)
  }
  return null
}

function extractLinks(html, baseUrl) {
  const links = new Map()
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    try {
      const url = new URL(match[1], baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) continue
      url.hash = ''
      const anchor = stripHtml(match[2])
      const instagram = instagramProfile(url.href)
      const facebook = facebookProfile(url.href)
      if (instagram) links.set(`instagram:${instagram}`, { url: instagram, type: 'social', provider: 'instagram', confidence: 0.95 })
      else if (facebook) links.set(`facebook:${facebook}`, { url: facebook, type: 'social', provider: 'facebook', confidence: 0.9 })
      else if (menuWords.test(`${url.pathname} ${anchor}`) || /\.pdf$/i.test(url.pathname)) {
        links.set(`menu:${url.href}`, { url: url.href, type: 'menu', provider: 'website', confidence: /\.pdf$/i.test(url.pathname) ? 0.95 : 0.8 })
      }
    } catch { /* invalid href */ }
  }

  // Handles embedded in scripts/widgets but absent from normal anchors.
  const instagramRegex = /https?:\\?\/\\?\/(?:www\.)?instagram\.com\\?\/([A-Za-z0-9._-]{2,40})/gi
  while ((match = instagramRegex.exec(html)) !== null) {
    const profile = instagramProfile(`https://instagram.com/${match[1]}`)
    if (profile) links.set(`instagram:${profile}`, { url: profile, type: 'social', provider: 'instagram', confidence: 0.85 })
  }
  return [...links.values()]
}

async function fetchHomepage(raw) {
  const initial = websiteUrl(raw)
  if (!initial) return { ok: false, reason: 'invalid_website' }
  const variants = [initial]
  try {
    const url = new URL(initial)
    const alternate = new URL(initial)
    alternate.hostname = url.hostname.startsWith('www.') ? url.hostname.slice(4) : `www.${url.hostname}`
    variants.push(alternate.href)
  } catch { /* impossible after websiteUrl */ }

  for (const url of [...new Set(variants)]) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT)
    try {
      const response = await fetch(url, {
        redirect: 'follow', signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'es-MX,es;q=0.9,en;q=0.7',
        },
      })
      const contentType = response.headers.get('content-type') || ''
      if (!response.ok || !contentType.includes('text/html')) continue
      const html = (await response.text()).slice(0, 4_000_000)
      return { ok: true, status: response.status, finalUrl: response.url, html }
    } catch { /* try alternate */ }
    finally { clearTimeout(timer) }
  }
  return { ok: false, reason: 'fetch_failed' }
}

const targets = db.prepare(`
  SELECT s.id, s.rank_overall, s.address, s.lat, s.lng, s.phone,
    q.priority_score, g.name, g.website, g.instagram, g.opening_hours,
    EXISTS(SELECT 1 FROM menu_items m WHERE m.restaurant_id = s.id) OR
    EXISTS(SELECT 1 FROM menu_items_local_extracted m WHERE m.restaurant_id = s.id) AS has_menu
  FROM premium_enrichment_queue q
  JOIN restaurant_search_mv s ON s.id = q.restaurant_id
  JOIN restaurant_golden_record g ON g.restaurant_id = s.id
  WHERE g.website IS NOT NULL
    AND (q.missing_menu = 1 OR q.missing_instagram = 1)
  ORDER BY q.priority_score DESC, s.rank_overall
`).all().slice(0, LIMIT > 0 ? LIMIT : undefined)

db.exec(`
  CREATE TABLE IF NOT EXISTS premium_web_crawl_log (
    restaurant_id TEXT NOT NULL,
    rank_overall INTEGER,
    website TEXT,
    status TEXT NOT NULL,
    instagram_found TEXT,
    menu_count INTEGER NOT NULL,
    hours_found INTEGER NOT NULL,
    reason TEXT,
    crawled_at TEXT NOT NULL
  );
`)
const log = db.prepare('INSERT INTO premium_web_crawl_log VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
const linkExists = db.prepare('SELECT 1 FROM restaurant_links WHERE restaurant_id = ? AND normalized_url = ?')
const insertLink = db.prepare(`
  INSERT INTO restaurant_links
    (id,restaurant_id,url,normalized_url,host,source,link_type,provider,status,confidence_score,checked_at,created_at,updated_at)
  VALUES (?, ?, ?, ?, ?, 'website_crawl_local', ?, ?, 'valid', ?, ?, ?, ?)
`)
const menuExists = db.prepare('SELECT 1 FROM menu_documents WHERE restaurant_id = ? AND source_url = ?')
const insertMenu = db.prepare(`
  INSERT INTO menu_documents
    (id,restaurant_id,source_url,file_type,raw_text,langue,confidence_score,extraction_method,statut,last_checked_at,created_at,updated_at)
  VALUES (?, ?, ?, ?, NULL, 'es', ?, 'website_crawl_local', 'pending', ?, ?, ?)
`)

function persist(target, result) {
  const discovered = extractLinks(result.html, result.finalUrl)
  const preferred = provider => discovered.filter(link => link.provider === provider)
    .map(link => ({ link, score: socialScore(target.name, link.url) }))
    .sort((a, b) => b.score - a.score)[0]
  const instagramChoice = preferred('instagram')
  const facebookChoice = preferred('facebook')
  const instagram = instagramChoice?.score > 0 ? instagramChoice.link.url : null
  const facebook = facebookChoice?.score > 0 ? facebookChoice.link.url : null
  const links = discovered.filter(link => link.type === 'menu' || link.url === instagram || link.url === facebook)
  const menuLinks = links.filter(link => link.type === 'menu').slice(0, 5)
  const hours = schemaHours(result.html)

  db.exec('BEGIN')
  try {
    for (const link of links) {
      const normalized = normalizeUrl(link.url)
      if (!linkExists.get(target.id, normalized)) {
        insertLink.run(randomUUID(), target.id, link.url, normalized, hostFromUrl(link.url), link.type, link.provider, link.confidence, now, now, now)
      }
    }
    for (const menu of menuLinks) {
      if (!menuExists.get(target.id, menu.url)) {
        const type = /\.pdf(?:\?|$)/i.test(menu.url) ? 'pdf' : 'html'
        insertMenu.run(randomUUID(), target.id, menu.url, type, menu.confidence, now, now, now)
      }
    }
    log.run(target.id, target.rank_overall, target.website, 'ok', instagram, menuLinks.length, hours ? 1 : 0, null, now)
    db.exec('COMMIT')
    return {
      instagram: Boolean(instagram), menus: menuLinks.length, hours: Boolean(hours),
      raw: {
        source_id: `official_website:${target.id}:${today}`,
        name: target.name,
        latitude: target.lat,
        longitude: target.lng,
        address: target.address,
        phone: target.phone,
        website: result.finalUrl || target.website,
        payload: {
          canonical_restaurant_id: target.id,
          source_url: target.website,
          final_url: result.finalUrl,
          instagram,
          facebook,
          opening_hours: hours,
          menu_links: menuLinks.map(link => link.url),
          discovered_links: links,
          crawled_at: now,
        },
      },
    }
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

console.log(`Crawl web gratuit premium — ${targets.length} sites, concurrence ${CONCURRENCY}`)
let cursor = 0
const stats = { ok: 0, failed: 0, instagram: 0, menus: 0, hours: 0 }
const rawRecords = []
async function worker() {
  while (cursor < targets.length) {
    const target = targets[cursor++]
    const result = await fetchHomepage(target.website)
    if (!result.ok) {
      stats.failed++
      log.run(target.id, target.rank_overall, target.website, 'failed', null, 0, 0, result.reason, now)
      continue
    }
    try {
      const found = persist(target, result)
      stats.ok++
      stats.instagram += Number(found.instagram)
      stats.menus += found.menus
      stats.hours += Number(found.hours)
      rawRecords.push(found.raw)
    } catch (error) {
      stats.failed++
      log.run(target.id, target.rank_overall, target.website, 'error', null, 0, 0, error.message, now)
    }
    if ((stats.ok + stats.failed) % 50 === 0) console.log(`${stats.ok + stats.failed}/${targets.length}`)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(rawRecords, null, 2))
console.log(JSON.stringify(stats))
console.log(`Raw traçable : ${OUT_PATH} (${rawRecords.length} records)`)
db.close()
