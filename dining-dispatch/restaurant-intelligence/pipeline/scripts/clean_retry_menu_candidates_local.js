// Quarantines obvious false positives from the latest deep-menu retry and
// materializes direct PDFs hidden inside viewer URLs. Local derived tables only.
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { hostFromUrl, normalizeUrl } from './lib/normalize.js'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()
const latestRun = db.prepare('SELECT MAX(crawled_at) AS value FROM premium_menu_deep_crawl_log').get().value
if (!latestRun) throw new Error('Aucun crawl profond trouvé')

function parsed(value) {
  try { return new URL(String(value || '').replaceAll('&amp;', '&')) } catch { return null }
}
function imageLooksUseful(url) {
  const value = decodeURIComponent(parsed(url)?.pathname || '')
  const filename = value.split('/').at(-1) || ''
  if (/(?:[-_]150x150|\/animations\/|game-code|(?:^|[-_])logo(?:[-_.]|$))/i.test(value)) return false
  return /(menu|men[uú]|carta|desayun|comida|bebida|postre|taco|paquete|ensalada|dona)/i.test(filename)
}
function reject(row) {
  const url = String(row.source_url || '').replaceAll('&amp;', '&')
  const candidate = parsed(url)
  const website = parsed(row.website)
  if (!candidate) return 'invalid_url'
  if (/(?:privacy|privacidad|aviso[_-]?privacidad|legal|t[eé]rminos|terms|tyc)/i.test(url)) return 'legal_document'
  if (/(?:sitemap[^/]*\.xml)(?:\?|$)/i.test(url)) return 'sitemap'
  if (/likingrestaurant\.com/i.test(url)) return 'unrelated_domain'
  if (/\.(?:gif|svg)(?:\?|$)/i.test(url)) return 'decorative_asset'
  if (/reglas-promociones/i.test(url)) return 'promotion'
  if (row.file_type === 'image' && !imageLooksUseful(url)) return 'non_menu_image'
  if (website && /(^|\.)opentable\./i.test(website.hostname)) {
    const sameRestaurantPage = candidate.hostname === website.hostname && candidate.pathname === website.pathname
    if (!sameRestaurantPage) return 'opentable_related_content'
  }
  return null
}

const rows = db.prepare(`
  SELECT m.*, g.website
  FROM menu_documents m
  JOIN restaurant_golden_record g ON g.restaurant_id=m.restaurant_id
  WHERE m.created_at >= ? AND m.statut='pending'
`).all(latestRun)
const rejectDocument = db.prepare(`UPDATE menu_documents
  SET statut='rejected_candidate', extraction_method=?, last_checked_at=?, updated_at=? WHERE id=?`)
const rejectLink = db.prepare(`UPDATE restaurant_links
  SET status='rejected', checked_at=?, updated_at=?
  WHERE restaurant_id=? AND normalized_url=? AND source IN ('official_website_deep','official_website_browser')`)
const documentExists = db.prepare('SELECT 1 FROM menu_documents WHERE restaurant_id=? AND source_url=?')
const insertDocument = db.prepare(`INSERT INTO menu_documents
  (id,restaurant_id,source_url,file_type,raw_text,langue,confidence_score,extraction_method,statut,last_checked_at,created_at,updated_at)
  VALUES (?,?,?,'pdf',NULL,'es',0.98,'official_website_deep','pending',?,?,?)`)
const linkExists = db.prepare('SELECT 1 FROM restaurant_links WHERE restaurant_id=? AND normalized_url=?')
const insertLink = db.prepare(`INSERT INTO restaurant_links
  (id,restaurant_id,url,normalized_url,host,source,link_type,provider,status,confidence_score,checked_at,created_at,updated_at)
  VALUES (?,?,?,?,?,'official_website_deep','menu','website','valid',0.98,?,?,?)`)

const stats = { reviewed: rows.length, accepted: 0, rejected: 0, nested_pdfs: 0 }
db.exec('BEGIN')
try {
  for (const row of rows) {
    const reason = reject(row)
    if (reason) {
      rejectDocument.run(`candidate_filter:${reason}`, now, now, row.id)
      rejectLink.run(now, now, row.restaurant_id, normalizeUrl(row.source_url))
      stats.rejected++
      continue
    }
    stats.accepted++
    const url = parsed(row.source_url)
    const nested = url?.searchParams.get('file')
    let nestedUrl = null
    try { nestedUrl = nested ? new URL(decodeURIComponent(nested)).href : null } catch { nestedUrl = null }
    if (!nestedUrl || !/\.pdf(?:\?|$)/i.test(nestedUrl)) continue
    if (!documentExists.get(row.restaurant_id, nestedUrl)) {
      insertDocument.run(randomUUID(), row.restaurant_id, nestedUrl, now, now, now)
      stats.nested_pdfs++
    }
    const normalized = normalizeUrl(nestedUrl)
    if (!linkExists.get(row.restaurant_id, normalized)) {
      insertLink.run(randomUUID(), row.restaurant_id, nestedUrl, normalized, hostFromUrl(nestedUrl), now, now, now)
    }
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

console.log(JSON.stringify({ latestRun, ...stats }))
db.close()
