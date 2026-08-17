// Exports validated official-site menus from SQLite into the immutable raw layer.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const date = new Date().toISOString().slice(0, 10)
const outDir = resolve('data/raw/official_menus')
const outPath = resolve(outDir, `${date}.json`)

const restaurants = db.prepare(`
  SELECT s.id, s.name, s.address, s.lat, s.lng, s.phone, g.website
  FROM restaurant_search_mv s
  JOIN restaurant_golden_record g ON g.restaurant_id = s.id
  JOIN premium_enrichment_queue q ON q.restaurant_id = s.id
  WHERE EXISTS (SELECT 1 FROM menu_items_local_extracted i WHERE i.restaurant_id = s.id)
  ORDER BY q.priority_score DESC
`).all()
const documentsFor = db.prepare(`
  SELECT m.id, m.source_url, m.file_type, m.raw_text,
    q.quality_score, q.price_count, q.food_term_count
  FROM menu_documents m
  JOIN menu_document_quality q ON q.menu_document_id = m.id
  WHERE m.restaurant_id = ? AND q.quality_status = 'high'
  ORDER BY q.quality_score DESC
`)
const itemsFor = db.prepare(`
  SELECT menu_document_id, nom, prix, devise
  FROM menu_items_local_extracted WHERE restaurant_id = ?
  ORDER BY nom, prix
`)

const records = restaurants.map(restaurant => ({
  source_id: `official_menus:${restaurant.id}:${date}`,
  name: restaurant.name,
  latitude: restaurant.lat,
  longitude: restaurant.lng,
  address: restaurant.address,
  phone: restaurant.phone,
  website: restaurant.website,
  payload: {
    canonical_restaurant_id: restaurant.id,
    extraction_method: 'official_website_rules_v1',
    extracted_at: new Date().toISOString(),
    documents: documentsFor.all(restaurant.id),
    items: itemsFor.all(restaurant.id),
  },
}))

mkdirSync(outDir, { recursive: true })
writeFileSync(outPath, JSON.stringify(records, null, 2))
console.log(JSON.stringify({ restaurants: records.length,
  documents: records.reduce((n, row) => n + row.payload.documents.length, 0),
  items: records.reduce((n, row) => n + row.payload.items.length, 0), outPath }))
db.close()
