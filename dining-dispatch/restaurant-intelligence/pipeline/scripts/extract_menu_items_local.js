// Conservative, reversible item extraction from high-quality local menu text.
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const generatedAt = new Date().toISOString()

function clean(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/&[^;\s]+;/g, ' ')
    .replace(/[\t ]+/g, ' ').trim()
}

function validateName(raw) {
  let value = clean(raw)
  value = value.replace(/^[-–—•]+\s*/u, '')
    .replace(/\s+SKU\s+\d+\b/giu, '')
    .replace(/\s+\d{5}\b$/u, '')
    .replace(/\s+\d+(?:[.,]\d+)?\s*(?:g|gr|kg|ml|oz|pzas?|piezas?|personas?)\.?$/iu, '')
  value = value.replace(/^.*?[.!?]\s+(?=[A-ZÁÉÍÓÚÑ])/u, '').trim()
  value = value.replace(/^[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/u, '').replace(/[.,;:\-–—]+$/u, '').trim()
  const words = value.split(/\s+/)
  if (words.length > 8) value = words.slice(-8).join(' ')
  if (value.length < 3 || value.length > 100) return null
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/u.test(value)) return null
  if (/\$|\bMXN\b/i.test(value)) return null
  if (!/^[A-ZÁÉÍÓÚÜÑ]/u.test(value)) return null
  const meaningful = value.split(/\s+/).filter(w => !/^(de|del|la|el|con|y|a|al|en|the|of|with)$/i.test(w))
  const titled = meaningful.filter(w => /^[A-ZÁÉÍÓÚÜÑ]/u.test(w)).length
  if (!meaningful.length || titled / meaningful.length < 0.34) return null
  if (/\b(menu|men[uú]|carta|copyright|reserva|reservaci[oó]n|whatsapp|tel[eé]fono|vigencia|promoci[oó]n|total|subtotal|env[ií]o|delivery)\b/i.test(value) && words.length < 5) return null
  if (/^(detalles?|precio de oferta|agregar|disponible|orden|pieza|copa|botella|complementos?)$/i.test(value)) return null
  if (/^(descripci[oó]n|para empezar|embotellados?|extras?|glass|g\s*l\s*a\s*s\s*s|copeo|c\s*o\s*p\s*e\s*o|precio de|precio por|surtido|alimentos?|bebidas?)$/i.test(value)) return null
  return value
}

function itemName(left) {
  const lines = String(left || '').split(/[\r\n|•]+/).map(clean).filter(Boolean).slice(-10)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (/^\d+(?:[.,]\d+)?\s*(?:g|gr|kg|ml|oz|pzas?|piezas?|personas?)\.?$/iu.test(line)) continue
    if ((line.match(/,/g) || []).length >= 3 || line.split(/\s+/).length > 14) continue
    const candidate = validateName(line)
    if (candidate) return candidate
  }
  return validateName(clean(left).split(/[|•\n\r]/).at(-1) || '')
}

function productPageItem(text, sourceUrl) {
  let host = ''
  try { host = new URL(sourceUrl).hostname } catch { return null }
  if (!/(^|\.)ola\.click$/i.test(host)) return null
  const lines = String(text || '').split(/\r?\n/).map(clean).filter(Boolean)
  const rawName = (lines[0] || '').split(/\s+-\s+/)[0]
  const name = validateName(rawName)
  const priceMatch = String(text || '').match(/\bMXN\s*\$?\s*(\d{2,4}(?:[.,]\d{2})?)/i)
  const price = priceMatch ? Number(priceMatch[1].replace(',', '.')) : NaN
  return name && Number.isFinite(price) && price >= 10 && price <= 5000 ? { name, price } : null
}

function parse(text, sourceUrl) {
  const product = productPageItem(text, sourceUrl)
  if (product) return [product]
  const body = String(text || '')
  const priceRe = /(?:\$|MXN\s*\$?)\s*(\d{2,4}(?:[.,]\d{2})?)|\b(\d{2,4}(?:[.,]\d{2})?)\s*(?:MXN|pesos)\b/gi
  const items = new Map()
  let match
  while ((match = priceRe.exec(body))) {
    const price = Number((match[1] || match[2]).replace(',', '.'))
    if (!Number.isFinite(price) || price < 10 || price > 5000) continue
    const name = itemName(body.slice(Math.max(0, match.index - 180), match.index))
    if (!name) continue
    const key = `${name.toLowerCase()}::${price}`
    if (!items.has(key)) items.set(key, { name, price })
  }
  return [...items.values()]
}

db.exec(`
  DROP TABLE IF EXISTS menu_items_local_extracted;
  CREATE TABLE menu_items_local_extracted (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    menu_document_id TEXT NOT NULL,
    nom TEXT NOT NULL,
    prix REAL NOT NULL,
    devise TEXT NOT NULL,
    extraction_method TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_local_menu_items_restaurant ON menu_items_local_extracted(restaurant_id);
`)

const docs = db.prepare(`
  SELECT m.id, m.restaurant_id, m.raw_text, m.source_url
  FROM menu_documents m
  JOIN menu_document_quality q ON q.menu_document_id = m.id
  JOIN restaurant_search_mv s ON s.id = m.restaurant_id
  WHERE q.quality_status = 'high' AND s.is_enriched = 1
    AND COALESCE(m.extraction_method, '') <> 'tesseract_local'
`).all()
const insert = db.prepare(`INSERT OR IGNORE INTO menu_items_local_extracted VALUES (?, ?, ?, ?, ?, 'MXN', 'rules_local_v1', ?)`)
let itemCount = 0
db.exec('BEGIN')
try {
  for (const doc of docs) {
    for (const item of parse(doc.raw_text, doc.source_url)) {
      const id = createHash('sha256').update(`${doc.restaurant_id}\0${item.name.toLowerCase()}\0${item.price}`).digest('hex').slice(0, 32)
      itemCount += insert.run(id, doc.restaurant_id, doc.id, item.name, item.price, generatedAt).changes
    }
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

const restaurants = db.prepare('SELECT COUNT(DISTINCT restaurant_id) AS n FROM menu_items_local_extracted').get().n
console.log(JSON.stringify({ documents: docs.length, items: itemCount, restaurants }))
db.close()
