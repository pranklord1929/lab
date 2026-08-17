// Materializes matched official_menus evidence into menu_items.
// Never touches restaurants. Default: dry-run; --execute writes to Supabase.
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { supabase } from './lib/supabase.js'

const EXECUTE = process.argv.includes('--execute')
function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim() }
function payload(value) { try { return typeof value === 'string' ? JSON.parse(value) : value || {} } catch { return {} } }
function key(restaurantId, name, price) { return `${restaurantId}\0${clean(name).toLowerCase()}\0${Number(price).toFixed(2)}` }
function uuidFor(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32)
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`
}
async function fetchAll(build, size = 1000) {
  const rows = []
  for (let from = 0; ; from += size) {
    const { data, error } = await build().range(from, from + size - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < size) break
  }
  return rows
}

const sources = await fetchAll(() => supabase.from('source_records')
  .select('id,matched_restaurant_id,payload,scrape_date,scraped_at')
  .eq('source', 'official_menus').not('matched_restaurant_id', 'is', null)
  .order('scrape_date', { ascending: false }).order('scraped_at', { ascending: false }))
const proposed = new Map()
for (const source of sources) {
  const restaurantId = source.matched_restaurant_id
  const p = payload(source.payload)
  for (const item of Array.isArray(p.items) ? p.items : []) {
    const name = clean(item.nom)
    const price = Number(item.prix)
    if (!name || !Number.isFinite(price) || price < 10 || price > 5000) continue
    const itemKey = key(restaurantId, name, price)
    proposed.set(itemKey, {
      id: uuidFor(`official-menu-item\0${itemKey}`), restaurant_id: restaurantId,
      menu_document_id: null, nom: name, description: null, prix: price,
      devise: item.devise || 'MXN', categorie: null, created_at: new Date().toISOString(),
    })
  }
}

const restaurantIds = [...new Set([...proposed.values()].map(row => row.restaurant_id))]
const existing = []
for (let i = 0; i < restaurantIds.length; i += 150) {
  const ids = restaurantIds.slice(i, i + 150)
  existing.push(...await fetchAll(() => supabase.from('menu_items')
    .select('id,restaurant_id,nom,prix').in('restaurant_id', ids)))
}
const existingKeys = new Set(existing.map(row => key(row.restaurant_id, row.nom, row.prix)))
const existingIds = new Set(existing.map(row => row.id))
const inserts = [...proposed].filter(([itemKey, row]) => !existingKeys.has(itemKey) && !existingIds.has(row.id)).map(([, row]) => row)

console.log(JSON.stringify({ mode: EXECUTE ? 'execute' : 'dry-run', source_records: sources.length,
  restaurants: restaurantIds.length, parsed_unique_items: proposed.size,
  existing_items_in_scope: existing.length, new_items: inserts.length,
  new_restaurants: new Set(inserts.map(row => row.restaurant_id)).size }))

if (EXECUTE) {
  for (let i = 0; i < inserts.length; i += 200) {
    const { error } = await supabase.from('menu_items').upsert(inserts.slice(i, i + 200), {
      onConflict: 'id', ignoreDuplicates: true,
    })
    if (error) throw new Error(`menu_items ${i}-${i + 199}: ${error.message}`)
  }
  console.log(`${inserts.length} plats de sites officiels insérés dans menu_items.`)
}
