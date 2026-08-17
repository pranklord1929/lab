// Fetches pending premium-pool menu documents and stores extracted text in SQLite.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { PDFParse } from 'pdf-parse'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const arg = (name, fallback) => {
  const value = process.argv.find(item => item.startsWith(`--${name}=`))
  return value ? value.split('=').slice(1).join('=') : fallback
}
const TIMEOUT = Number(arg('timeout', 12000))
const CONCURRENCY = Number(arg('concurrency', 8))
const LIMIT = Number(arg('limit', 0))
const now = new Date().toISOString()

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
}

function htmlText(html) {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim().slice(0, 50000)
}

async function fetchDocument(row) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const response = await fetch(row.source_url, {
      redirect: 'follow', signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125 Safari/537.36',
        Accept: 'application/pdf,text/html,image/*,*/*;q=0.7',
      },
    })
    if (!response.ok) return { status: 'failed', text: null }
    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > 15_000_000) return { status: 'failed', text: null }
    let text = ''
    if (contentType.includes('pdf') || /\.pdf(?:\?|$)/i.test(row.source_url)) {
      let parser
      try {
        parser = new PDFParse({ data: buffer })
        text = (await parser.getText()).text || ''
      } catch { text = '' }
      finally { await parser?.destroy().catch(() => {}) }
    } else if (contentType.includes('html') || row.file_type === 'html') {
      text = htmlText(buffer.toString('utf8'))
    }
    text = text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 50000)
    return { status: text.length >= 100 ? 'extracted' : 'fetched', text: text || null }
  } catch {
    return { status: 'failed', text: null }
  } finally { clearTimeout(timer) }
}

const documents = db.prepare(`
  SELECT m.*
  FROM menu_documents m
  JOIN premium_enrichment_queue q ON q.restaurant_id = m.restaurant_id
  WHERE m.statut = 'pending'
  ORDER BY q.priority_score DESC, m.confidence_score DESC
`).all().slice(0, LIMIT > 0 ? LIMIT : undefined)
const update = db.prepare(`
  UPDATE menu_documents
  SET raw_text = ?, statut = ?, extraction_method = 'website_fetch_local',
      last_checked_at = ?, updated_at = ?
  WHERE id = ?
`)

console.log(`Extraction gratuite premium — ${documents.length} documents, concurrence ${CONCURRENCY}`)
let cursor = 0
const stats = { extracted: 0, fetched: 0, failed: 0 }
async function worker() {
  while (cursor < documents.length) {
    const row = documents[cursor++]
    const result = await fetchDocument(row)
    update.run(result.text, result.status, now, now, row.id)
    stats[result.status]++
    const done = stats.extracted + stats.fetched + stats.failed
    if (done % 50 === 0) console.log(`${done}/${documents.length}`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
console.log(JSON.stringify(stats))
db.close()
