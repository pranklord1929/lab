// Cleans agency/theme/social noise discovered on official websites.
// Previous states are preserved for rollback.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const backupArg = process.argv.find(arg => arg.startsWith('--backup='))?.slice('--backup='.length)
if (!backupArg) throw new Error('Missing --backup=/path/to/pre-crawl.sqlite')
const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const backup = new DatabaseSync(resolve(backupArg), { readOnly: true })
const now = new Date().toISOString()

function fold(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}
function profileKey(url) {
  try { return new URL(url).pathname.split('/').filter(Boolean)[0]?.toLowerCase() || '' } catch { return '' }
}
function score(name, url) {
  const handle = fold(profileKey(url))
  if (!handle || /^(wix|embedjs|latentestudio|itsmakehq|reservandonos)$/.test(handle)) return -100
  const tokens = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').split(/\s+/)
    .filter(token => token.length >= 4 && !/^(restaurante|restaurant|cafe|sucursal|ciudad|mexico)$/.test(token))
  let value = tokens.filter(token => handle.includes(token)).length * 10
  const compact = fold(name).replace(/restaurante|restaurant|cafe/g, '')
  if (compact.length >= 4 && handle.includes(compact)) value += 15
  if (/mx|mexico/.test(handle)) value += 2
  if (/(middleeast|uz|us|ury|uk|tr|rdc|nl|ma|lu|kz|jp|greece|fr|br|be|az|ar)$/.test(handle)) value -= 8
  return value
}

db.exec(`
  CREATE TABLE IF NOT EXISTS web_enrichment_quarantine (
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    previous_state TEXT NOT NULL,
    reason TEXT NOT NULL,
    cleaned_at TEXT NOT NULL,
    PRIMARY KEY(entity_type,entity_id,cleaned_at)
  );
`)
const quarantine = db.prepare('INSERT INTO web_enrichment_quarantine VALUES (?,?,?,?,?)')
const latestCrawl = db.prepare('SELECT MAX(crawled_at) at FROM top500_web_crawl_log').get().at
const changed = db.prepare('SELECT * FROM restaurants WHERE updated_at=?').all(latestCrawl)
const previous = backup.prepare('SELECT * FROM restaurants WHERE id=?')
const restore = db.prepare('UPDATE restaurants SET instagram=?,facebook=?,horaires=?,updated_at=? WHERE id=?')

const links = db.prepare(`
  SELECT l.*,r.nombre restaurant_name FROM restaurant_links l
  JOIN restaurants r ON r.id=l.restaurant_id
  WHERE l.source='website_crawl_local' AND l.provider IN ('instagram','facebook') AND l.status='valid'
  ORDER BY l.restaurant_id,l.provider
`).all()
const groups = Map.groupBy(links, row => `${row.restaurant_id}:${row.provider}`)
const updateLink = db.prepare('UPDATE restaurant_links SET status=?,updated_at=? WHERE id=?')
let restored = 0, demoted = 0, kept = 0

db.exec('BEGIN')
try {
  for (const row of changed) {
    const old = previous.get(row.id)
    if (!old) continue
    quarantine.run('restaurant', row.id, JSON.stringify(row), 'restore_pre_website_crawl', now)
    restore.run(old.instagram, old.facebook, old.horaires, old.updated_at, row.id)
    restored++
  }
  for (const rows of groups.values()) {
    const ranked = rows.map(row => ({ row, score: score(row.restaurant_name, row.url) })).sort((a, b) => b.score - a.score)
    const winner = ranked[0]?.score > 0 ? ranked[0].row.id : null
    for (const { row } of ranked) {
      const status = row.id === winner ? 'valid' : 'candidate'
      if (status === 'valid') { kept++; continue }
      quarantine.run('restaurant_link', row.id, JSON.stringify(row), 'website_social_relevance', now)
      updateLink.run(status, now, row.id)
      demoted++
    }
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

console.log(JSON.stringify({ latestCrawl, restored, kept, demoted }))
backup.close(); db.close()
