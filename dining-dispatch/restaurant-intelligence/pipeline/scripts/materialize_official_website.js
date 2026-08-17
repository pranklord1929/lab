// Materializes matched official website evidence into links/menu documents.
// Never writes restaurants. Default: dry-run; --execute writes to Supabase.
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { supabase } from './lib/supabase.js'
import { normalizeUrl, hostFromUrl } from './lib/normalize.js'

const EXECUTE = process.argv.includes('--execute')
const VALIDATED_LOCAL = process.argv.includes('--validated-local')
const SOURCE = process.argv.find(arg => arg.startsWith('--source='))?.split('=').slice(1).join('=') || 'official_website'
if (!['official_website', 'official_website_deep'].includes(SOURCE)) throw new Error(`Source non autorisée: ${SOURCE}`)
const now = new Date().toISOString()
let approved = null
if (VALIDATED_LOCAL) {
  const local = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'), { readOnly: true })
  approved = new Set(local.prepare(`
    SELECT m.restaurant_id, m.source_url
    FROM menu_documents m JOIN menu_document_quality q ON q.menu_document_id = m.id
    WHERE q.quality_status = 'high'
  `).all().map(row => `${row.restaurant_id}\0${normalizeUrl(row.source_url)}`))
  local.close()
}

function payload(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value || {} } catch { return {} }
}
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
async function insertBatches(table, rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from(table).upsert(rows.slice(i, i + 200), {
      onConflict: 'id', ignoreDuplicates: true,
    })
    if (error) throw new Error(`${table} ${i}-${i + 199}: ${error.message}`)
  }
}

const sources = await fetchAll(() => supabase.from('source_records')
  .select('id,matched_restaurant_id,payload,scrape_date,scraped_at')
  .eq('source', SOURCE).not('matched_restaurant_id', 'is', null)
  .order('scrape_date', { ascending: false }).order('scraped_at', { ascending: false }))

const proposedLinks = new Map()
const proposedMenus = new Map()
for (const source of sources) {
  const restaurantId = source.matched_restaurant_id
  const p = payload(source.payload)
  for (const link of Array.isArray(p.discovered_links) ? p.discovered_links : []) {
    const url = normalizeUrl(link?.url)
    if (!url || !['menu', 'social'].includes(link?.type)) continue
    const key = `${restaurantId}\0${url}`
    if (VALIDATED_LOCAL && link.type === 'menu' && !approved.has(key)) continue
    proposedLinks.set(key, {
      id: uuidFor(`${SOURCE}-link\0${key}`), restaurant_id: restaurantId,
      url, normalized_url: url, host: hostFromUrl(url), source: SOURCE,
      link_type: link.type, provider: link.provider || 'website', status: 'valid',
      confidence_score: Number(link.confidence || 0.8), checked_at: p.crawled_at || now,
      created_at: now, updated_at: now,
    })
    if (link.type === 'menu') {
      proposedMenus.set(key, {
        id: uuidFor(`${SOURCE}-menu\0${key}`), restaurant_id: restaurantId,
        source_url: url, file_type: /\.pdf(?:\?|$)/i.test(url) ? 'pdf' : /\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url) ? 'image' : 'html',
        raw_text: null, langue: 'es', confidence_score: Number(link.confidence || 0.8),
        extraction_method: SOURCE, statut: 'pending',
        last_checked_at: p.crawled_at || now, created_at: now, updated_at: now,
      })
    }
  }
}

const restaurantIds = [...new Set(sources.map(row => row.matched_restaurant_id))]
const existingLinks = []
const existingMenus = []
for (let i = 0; i < restaurantIds.length; i += 150) {
  const ids = restaurantIds.slice(i, i + 150)
  existingLinks.push(...await fetchAll(() => supabase.from('restaurant_links')
    .select('restaurant_id,normalized_url').in('restaurant_id', ids)))
  existingMenus.push(...await fetchAll(() => supabase.from('menu_documents')
    .select('restaurant_id,source_url').in('restaurant_id', ids)))
}
const existingLinkKeys = new Set(existingLinks.map(row => `${row.restaurant_id}\0${normalizeUrl(row.normalized_url)}`))
const existingMenuKeys = new Set(existingMenus.map(row => `${row.restaurant_id}\0${normalizeUrl(row.source_url)}`))
const links = [...proposedLinks].filter(([key]) => !existingLinkKeys.has(key)).map(([, row]) => row)
const menus = [...proposedMenus].filter(([key]) => !existingMenuKeys.has(key)).map(([, row]) => row)

console.log(JSON.stringify({ mode: EXECUTE ? 'execute' : 'dry-run', source_records: sources.length,
  validated_local: VALIDATED_LOCAL,
  matched_restaurants: restaurantIds.length, proposed_links: proposedLinks.size,
  proposed_menus: proposedMenus.size, new_links: links.length, new_menus: menus.length }))

if (EXECUTE) {
  await insertBatches('restaurant_links', links)
  await insertBatches('menu_documents', menus)
  console.log(`${links.length} liens et ${menus.length} documents menus ajoutés.`)
}
