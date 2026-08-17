// OCRs menu images locally with Tesseract. No paid API, no canonical writes.
import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const arg = (name, fallback) => {
  const value = process.argv.find(item => item.startsWith(`--${name}=`))
  return value ? value.split('=').slice(1).join('=') : fallback
}
const LIMIT = Number(arg('limit', 0))
const CONCURRENCY = Number(arg('concurrency', 4))
const TIMEOUT = Number(arg('timeout', 15000))
const now = new Date().toISOString()

function clean(value) {
  return String(value || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, 50_000)
}
async function download(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const response = await fetch(url, {
      redirect: 'follow', signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/125 Safari/537.36', Accept: 'image/*,*/*;q=0.5' },
    })
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < 500 || buffer.length > 15_000_000) return null
    return buffer
  } catch { return null }
  finally { clearTimeout(timer) }
}
function tesseract(buffer) {
  return new Promise(resolveResult => {
    const child = spawn('tesseract', ['stdin', 'stdout', '-l', 'spa+eng', '--psm', '6'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const chunks = []
    child.stdout.on('data', chunk => chunks.push(chunk))
    child.on('error', () => resolveResult(''))
    child.on('close', code => resolveResult(code === 0 ? clean(Buffer.concat(chunks).toString('utf8')) : ''))
    child.stdin.end(buffer)
  })
}
async function extract(url) {
  const buffer = await download(url)
  if (!buffer) return { status: 'failed', text: null }
  const text = await tesseract(buffer)
  return { status: text.length >= 100 ? 'extracted' : 'fetched', text: text || null }
}

const rows = db.prepare(`
  SELECT m.* FROM menu_documents m
  JOIN restaurant_search_mv s ON s.id = m.restaurant_id
  WHERE s.is_enriched = 1 AND m.file_type = 'image' AND (m.statut IN ('fetched','failed','pending')
    OR (${process.argv.includes('--redo=1') ? 1 : 0} AND m.statut = 'extracted' AND m.extraction_method = 'tesseract_local'))
  ORDER BY s.rank_overall, m.confidence_score DESC
`).all().slice(0, LIMIT > 0 ? LIMIT : undefined)
const update = db.prepare(`UPDATE menu_documents
  SET raw_text=?, statut=?, extraction_method='tesseract_local', last_checked_at=?, updated_at=?
  WHERE id=?`)

console.log(`OCR local — ${rows.length} images, ${CONCURRENCY} workers`)
const cache = new Map()
let cursor = 0
const stats = { extracted: 0, fetched: 0, failed: 0 }
async function worker() {
  while (cursor < rows.length) {
    const row = rows[cursor++]
    if (!cache.has(row.source_url)) cache.set(row.source_url, extract(row.source_url))
    const result = await cache.get(row.source_url)
    update.run(result.text, result.status, now, now, row.id)
    stats[result.status]++
    const done = stats.extracted + stats.fetched + stats.failed
    if (done % 25 === 0) console.log(`${done}/${rows.length}`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
console.log(JSON.stringify({ ...stats, unique_urls: cache.size }))
db.close()
