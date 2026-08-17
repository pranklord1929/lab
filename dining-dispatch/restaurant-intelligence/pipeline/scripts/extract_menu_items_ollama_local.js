// LLM fallback extraction (qwen3:8b via Ollama, local & free) for high-quality
// menu documents where rules_local_v1 produced nothing — OCR text included.
// Run AFTER extract_menu_items_local.js (that script rebuilds the table from scratch).
// Resumable: documents that already have extracted items are skipped.
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434'
const arg = (name, fallback) => {
  const value = process.argv.find(item => item.startsWith(`--${name}=`))
  return value ? value.split('=').slice(1).join('=') : fallback
}
const MODEL = arg('model', 'qwen3:8b')
const LIMIT = Number(arg('limit', 0))
const TIMEOUT = Number(arg('timeout', 90_000))
const CHUNK_SIZE = 4_000
const MAX_CHUNKS_PER_DOC = 12

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
db.exec('PRAGMA busy_timeout = 15000')
const generatedAt = new Date().toISOString()

const priceHint = /(?:\$|\bmxn\b|\bm\.n\.|\bpesos\b)\s*\d|\d{2,4}(?:[.,]\d{2})?\s*(?:\$|\bmxn\b|\bpesos\b)|\b\d{2,3}\b/i

function chunks(text) {
  const lines = String(text || '').split(/\r?\n/)
  const parts = []
  let current = ''
  for (const line of lines) {
    if (current.length + line.length + 1 > CHUNK_SIZE && current) {
      parts.push(current)
      current = ''
    }
    current += (current ? '\n' : '') + line
  }
  if (current) parts.push(current)
  return parts.filter(part => priceHint.test(part)).slice(0, MAX_CHUNKS_PER_DOC)
}

function validItem(raw) {
  const name = String(raw?.name || '').replace(/\s+/g, ' ').trim()
  const price = Number(raw?.price)
  if (name.length < 3 || name.length > 100) return null
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/u.test(name)) return null
  if (/\$|\bMXN\b|\bprecio\b/i.test(name)) return null
  if (!Number.isFinite(price) || price < 10 || price > 5000) return null
  return { name, price }
}

async function extractChunk(text) {
  const response = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      keep_alive: '30m',
      options: { temperature: 0, num_predict: 2000 },
      format: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { name: { type: 'string' }, price: { type: 'number' } },
              required: ['name', 'price'],
            },
          },
        },
        required: ['items'],
      },
      messages: [
        {
          role: 'system',
          content: 'Extraes platillos de menús de restaurantes mexicanos. El texto viene de páginas web o de OCR (puede tener ruido). Devuelve SOLO los platillos o bebidas con su precio en pesos mexicanos (número, sin símbolo). Ignora títulos de sección, teléfonos, direcciones, códigos postales, promociones y texto legal. Si un platillo tiene varios precios (copa/botella, tamaños), crea una entrada por variante con el sufijo entre paréntesis. Si no hay platillos con precio claro, devuelve una lista vacía.',
        },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  if (!response.ok) throw new Error(`ollama_http_${response.status}`)
  const data = await response.json()
  let parsed
  try { parsed = JSON.parse(data?.message?.content || '{}') } catch { return [] }
  return (Array.isArray(parsed?.items) ? parsed.items : []).map(validItem).filter(Boolean)
}

const docs = db.prepare(`
  SELECT m.id, m.restaurant_id, m.raw_text, m.source_url,
    EXISTS(SELECT 1 FROM menu_items_local_extracted e WHERE e.restaurant_id = m.restaurant_id) AS resto_has_items
  FROM menu_documents m
  JOIN menu_document_quality q ON q.menu_document_id = m.id
  JOIN restaurant_search_mv s ON s.id = m.restaurant_id
  WHERE q.quality_status = 'high' AND s.is_enriched = 1
    AND LENGTH(COALESCE(m.raw_text, '')) >= 100
    AND NOT EXISTS(SELECT 1 FROM menu_items_local_extracted e WHERE e.menu_document_id = m.id)
  ORDER BY resto_has_items, m.restaurant_id
`).all()
const targets = LIMIT > 0 ? docs.slice(0, LIMIT) : docs

const insert = db.prepare(`INSERT OR IGNORE INTO menu_items_local_extracted VALUES (?, ?, ?, ?, ?, 'MXN', 'ollama_local_v1', ?)`)
console.log(`Extraction LLM locale — ${targets.length} documents (${MODEL})`)

const stats = { documents: 0, documents_with_items: 0, items: 0, errors: 0 }
for (const doc of targets) {
  stats.documents++
  const items = new Map()
  try {
    for (const part of chunks(doc.raw_text)) {
      for (const item of await extractChunk(part)) {
        items.set(`${item.name.toLowerCase()}::${item.price}`, item)
      }
    }
  } catch (error) {
    stats.errors++
    console.error(`  ✗ ${doc.source_url} — ${error.message}`)
    continue
  }
  let inserted = 0
  for (const item of items.values()) {
    const id = createHash('sha256').update(`${doc.restaurant_id}\0${item.name.toLowerCase()}\0${item.price}`).digest('hex').slice(0, 32)
    inserted += insert.run(id, doc.restaurant_id, doc.id, item.name, item.price, generatedAt).changes
  }
  if (inserted) stats.documents_with_items++
  stats.items += inserted
  if (stats.documents % 10 === 0) console.log(`  … ${stats.documents}/${targets.length} docs, ${stats.items} plats`)
}

const restaurants = db.prepare(`SELECT COUNT(DISTINCT restaurant_id) AS n FROM menu_items_local_extracted WHERE extraction_method = 'ollama_local_v1'`).get().n
console.log(JSON.stringify({ ...stats, restaurants_llm: restaurants }))
db.close()
