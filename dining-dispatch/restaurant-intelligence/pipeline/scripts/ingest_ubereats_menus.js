// Materializes menus already staged in source_records into menu_items.
// Never touches restaurants. Default: dry-run; --execute writes to Supabase.
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const EXECUTE = process.argv.includes('--execute')
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim() }
function key(restaurantId, name, price) {
  return `${restaurantId}\0${clean(name).toLowerCase()}\0${Number(price).toFixed(2)}`
}
function uuidFor(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32)
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`
}
function payload(value) { try { return typeof value === 'string' ? JSON.parse(value) : value || {} } catch { return {} } }

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
  .eq('source', 'ubereats').not('matched_restaurant_id', 'is', null)
  .order('scrape_date', { ascending: false }).order('scraped_at', { ascending: false }))

const proposed = new Map()
for (const source of sources) {
  const menu = payload(source.payload).menu
  if (!Array.isArray(menu)) continue
  for (const section of menu) for (const item of section?.items || []) {
    const name = clean(item?.name)
    const price = Number(item?.price)
    if (!name || !Number.isFinite(price) || price <= 0 || price > 10000) continue
    const itemKey = key(source.matched_restaurant_id, name, price)
    const row = {
      id: uuidFor(`ubereats\0${itemKey}`), restaurant_id: source.matched_restaurant_id,
      menu_document_id: null, nom: name, description: clean(item.description) || null,
      prix: price, devise: 'MXN', categorie: clean(section?.name) || null,
      created_at: new Date().toISOString(),
    }
    const previous = proposed.get(itemKey)
    if (!previous || (row.description?.length || 0) > (previous.description?.length || 0)) proposed.set(itemKey, row)
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
  console.log(`${inserts.length} plats Uber Eats insérés dans menu_items.`)
}
