// Scores local menu documents without network calls or destructive edits.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const generatedAt = new Date().toISOString()

const rows = db.prepare(`
  SELECT m.*, g.name AS restaurant_name
  FROM menu_documents m
  JOIN restaurant_golden_record g ON g.restaurant_id = m.restaurant_id
`).all()

const foodWords = /\b(taco|tacos|tostada|quesadilla|sopa|ensalada|carne|pollo|pescado|marisco|pulpo|at[uú]n|salm[oó]n|cerdo|res|pasta|pizza|hamburguesa|postre|helado|chocolate|vino|cerveza|coctel|cocktail|desayuno|entrada|platillo|bebida|sandwich|burger|steak|dessert|appetizer|sushi|ramen|ceviche|mole|pozole|tamale?s?)\b/giu
const hardRejectHosts = /(^|\.)(instagram|facebook|tiktok)\.com$/i
const nonMenuUrl = /(aviso|privacidad|privacy|higiene|sanitari|eventos?|events?|availability|galer[iy]|gallery)/i

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function assess(row) {
  const body = String(row.raw_text || '')
  const url = String(row.source_url || '')
  const reasons = []
  const priceCount = (body.match(/(?:\$\s*\d{2,4}|\b(?:mxn|m\.n\.)\s*\$?\s*\d{2,4}(?:\.\d{2})?|\b\d{2,4}(?:\.\d{2})?\s*(?:mxn|m\.n\.)\b)/gi) || []).length
  const foodCount = new Set((body.match(foodWords) || []).map(v => v.toLowerCase())).size
  const badChars = (body.match(/[\u0000-\u0008\uFFFD]/g) || []).length
  let score = 0

  if (row.statut === 'extracted') score += 2
  else reasons.push(`status:${row.statut || 'null'}`)
  if (body.length >= 300) score += 1
  if (body.length >= 1500) score += 1
  if (row.file_type === 'pdf') score += 2
  if (/(menu|men[uú]|carta|platillos|pedir|order)/i.test(url)) score += 2
  if (priceCount >= 3) score += 3
  if (priceCount >= 10) score += 1
  if (foodCount >= 4) score += 2
  if (/\b(menu|men[uú]|carta|entradas|postres|bebidas|desayunos)\b/i.test(body)) score += 1

  if (hardRejectHosts.test(host(url))) {
    score -= 10
    reasons.push('social_url')
  }
  if (nonMenuUrl.test(url) && priceCount < 3) {
    score -= 8
    reasons.push('non_menu_url')
  }
  if (body.length < 100) {
    score -= 4
    reasons.push('thin_text')
  }
  if (badChars > Math.max(5, body.length * 0.01)) {
    score -= 6
    reasons.push('binary_text')
  }
  if (priceCount === 0) reasons.push('no_prices')
  if (foodCount < 4) reasons.push('weak_food_signal')

  const isIndex = row.statut === 'extracted' && !nonMenuUrl.test(url) &&
    /(menu|men[uú]|carta|platillos|pedir|order)/i.test(url) && body.length >= 250 &&
    (/\b(menu|men[uú]|carta|entradas|postres|bebidas|desayunos)\b/i.test(body) || foodCount >= 2)
  const isCatalogProduct = row.statut === 'extracted' && /(^|\.)ola\.click$/i.test(host(url)) &&
    body.length >= 100 && priceCount >= 1
  const quality = (score >= 8 || isCatalogProduct) && row.statut === 'extracted'
    ? 'high'
    : isIndex ? 'index' : score >= 4 && row.statut === 'extracted' ? 'review' : 'rejected'
  return { score, quality, reasons: reasons.join(','), priceCount, foodCount, textLength: body.length }
}

db.exec(`
  DROP TABLE IF EXISTS menu_document_quality;
  CREATE TABLE menu_document_quality (
    menu_document_id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    quality_score INTEGER NOT NULL,
    quality_status TEXT NOT NULL,
    reasons TEXT,
    price_count INTEGER NOT NULL,
    food_term_count INTEGER NOT NULL,
    text_length INTEGER NOT NULL,
    generated_at TEXT NOT NULL
  );
  CREATE INDEX idx_menu_quality_restaurant ON menu_document_quality(restaurant_id, quality_status);
`)

const insert = db.prepare(`INSERT INTO menu_document_quality VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
db.exec('BEGIN')
try {
  for (const row of rows) {
    const a = assess(row)
    insert.run(row.id, row.restaurant_id, a.score, a.quality, a.reasons, a.priceCount, a.foodCount, a.textLength, generatedAt)
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

const stats = db.prepare(`
  SELECT quality_status, COUNT(*) AS documents, COUNT(DISTINCT restaurant_id) AS restaurants
  FROM menu_document_quality GROUP BY quality_status ORDER BY quality_status
`).all()
console.table(stats)
db.close()
