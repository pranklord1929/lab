// Materializes staged Uber Eats payloads into local menu_items. Never edits restaurants.
// Default: dry-run; --execute writes deterministic, rerunnable rows.
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const EXECUTE = process.argv.includes('--execute')
const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
const itemKey = (restaurantId, name, price) => `${restaurantId}\0${clean(name).toLowerCase()}\0${Number(price).toFixed(2)}`
function uuidFor(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32)
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`
}
function json(value) { try { return JSON.parse(value || '{}') } catch { return {} } }

const rows = db.prepare(`
  SELECT id,matched_restaurant_id,payload
  FROM source_records
  WHERE source='ubereats' AND matched_restaurant_id IS NOT NULL
  ORDER BY scrape_date DESC,scraped_at DESC
`).all()
const proposed = new Map()
for (const row of rows) {
  const menu = json(row.payload).menu
  if (!Array.isArray(menu)) continue
  for (const section of menu) for (const item of section?.items || []) {
    const name = clean(item?.name), price = Number(item?.price)
    if (!name || !Number.isFinite(price) || price <= 0 || price > 10000) continue
    const key = itemKey(row.matched_restaurant_id, name, price)
    const value = {
      id: uuidFor(`ubereats\0${key}`), restaurant_id: row.matched_restaurant_id,
      menu_document_id: null, nom: name, description: clean(item.description) || null,
      prix: price, devise: 'MXN', categorie: clean(section?.name) || null,
    }
    const previous = proposed.get(key)
    if (!previous || (value.description?.length || 0) > (previous.description?.length || 0)) proposed.set(key, value)
  }
}
const existing = new Set(db.prepare('SELECT restaurant_id,nom,prix FROM menu_items').all()
  .map(row => itemKey(row.restaurant_id, row.nom, row.prix)))
const inserts = [...proposed].filter(([key]) => !existing.has(key)).map(([, row]) => row)
console.log(JSON.stringify({ mode:EXECUTE?'execute':'dry-run', source_records:rows.length,
  restaurants:new Set([...proposed.values()].map(row=>row.restaurant_id)).size,
  parsed_unique_items:proposed.size, new_items:inserts.length,
  new_restaurants:new Set(inserts.map(row=>row.restaurant_id)).size }))

if (EXECUTE) {
  const insert = db.prepare('INSERT OR IGNORE INTO menu_items VALUES (?,?,?,?,?,?,?,?,?)')
  const now = new Date().toISOString()
  db.exec('BEGIN')
  try {
    for (const row of inserts) insert.run(row.id,row.restaurant_id,row.menu_document_id,row.nom,
      row.description,row.prix,row.devise,row.categorie,now)
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  console.log(`${inserts.length} plats matérialisés localement.`)
}
db.close()
