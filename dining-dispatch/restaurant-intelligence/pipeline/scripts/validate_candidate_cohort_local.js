// Validates held candidate restaurants using stored payloads and existing websites only.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()
const rows = db.prepare(`
  SELECT c.*,t.distance_meters,t.name_similarity,t.token_similarity,t.nearest_restaurant_name,sr.payload
  FROM restaurant_candidate_triage t
  JOIN restaurant_candidate_pool c USING(candidate_id)
  JOIN restaurant_candidate_members m USING(candidate_id)
  JOIN source_records sr ON sr.id=m.source_record_id AND sr.source=c.best_source
  WHERE t.classification='new_high_confidence' AND t.auto_promote=0
`).all()

function json(value) { try { return JSON.parse(value || '{}') } catch { return {} } }
function menuItemCount(menu) { return Array.isArray(menu) ? menu.reduce((sum, section) => sum + (Array.isArray(section?.items) ? section.items.length : 0), 0) : 0 }
function allowedCategory(value) {
  return /Restaurant|Taquer|Taco|Pizzeria|Pizza|Bakery|Bistro|Diner|Steakhouse|Barbecue|BBQ|Burger|Breakfast|Coffee|Caf[eé]|Bar$|Joint|Food Truck|Sandwich|Deli|Buffet|Soup|Salad/i.test(value || '') &&
    !/^(Restaurant|Department Store|Miscellaneous Store|Fuel Station|Hotel|Grocery Store|Gourmet Store)$/i.test(value || '')
}
function noisyName(value) {
  return /distribuidora|banquetes|alquiladora|impulsora|manteles|hotel|comedor|club\s*house|city market|cremeria|proveedora|alimentos|asociaci[oó]n|\boxxo\b|decathlon|fantas[ií]as miguel|florer[ií]a|\blego\b|\bpetco\b|\bsally\b|\bsumesa\b|\bsuperama\b|\bcostco\b|circle k|restaurante liverpool|office depot|chedraui|j[uü]sto|toyo foods/i.test(value || '')
}
function genericChain(value) {
  return /chili'?s|italianni'?s|p\.?f\.?\s*chang|tim hortons|pasteler[ií]as esperanza|starbucks|sanborns|\btoks\b|\bkfc\b|mc\s*donald|burger king|\bsubway\b|domino'?s|little\s+cea?sars|bisquets? obreg[oó]n|marco'?s pizza|boston'?s pizza|^wings$|^mr\.? sushi$/i.test(String(value || '').trim())
}
function preciseCdmxAddress(value) {
  const address = String(value || '')
  const postal = address.match(/\b\d{5}\b/)?.[0]
  return Boolean((postal && /^[01]/.test(postal)) || /Ciudad de M[eé]xico|\bCDMX\b|Distrito Federal|Cuauht[eé]moc|Miguel Hidalgo|Benito Ju[aá]rez|Coyoac[aá]n|Tlalpan|Iztapalapa|Xochimilco|Tl[aá]huac|Azcapotzalco|Gustavo A\. Madero|Cuajimalpa|Milpa Alta|Magdalena Contreras|Venustiano Carranza|[AÁ]lvaro Obreg[oó]n/i.test(address))
}
async function reachable(value) {
  if (!value || /facebook|instagram|opentable|rappi|ubereats|tripadvisor|g\.co/i.test(value)) return null
  let url
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).href } catch { return false }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch(url, { redirect:'follow', signal:controller.signal,
      headers:{ 'User-Agent':'Mozilla/5.0 Chrome/125 Safari/537.36', Accept:'text/html,*/*;q=0.8' } })
    return response.ok
  } catch { return false } finally { clearTimeout(timer) }
}

const assessed = rows.map(row => {
  const payload = json(row.payload)
  const category = payload.categories?.[0]?.name || payload.category || null
  const year = Number(String(payload.date_refreshed || '').slice(0,4)) || null
  const menuItems = menuItemCount(payload.menu)
  const nearAliasRisk = row.distance_meters !== null && row.distance_meters <= 100 &&
    (row.distance_meters <= 15 || row.name_similarity >= 0.4 || row.token_similarity >= 0.2)
  let locallyValid = false, reason = 'unsupported_source'
  if (row.best_source === 'foursquare') {
    locallyValid = year >= 2025 && allowedCategory(category) && preciseCdmxAddress(row.address) && /\d/.test(row.address || '') && !nearAliasRisk && !noisyName(row.name) && !genericChain(row.name)
    reason = locallyValid ? 'fresh_specific_food_category' : year < 2025 ? 'stale' : 'category_name_or_address_risk'
  } else if (row.best_source === 'ubereats') {
    locallyValid = menuItems >= 10 && !nearAliasRisk && !noisyName(row.name) && !genericChain(row.name)
    reason = locallyValid ? 'structured_food_menu' : 'retail_or_generic_chain'
  }
  return { row, category, year, menuItems, locallyValid, reason, nearAliasRisk, websiteReachable: null }
})

let cursor = 0
async function worker() {
  while (cursor < assessed.length) {
    const item = assessed[cursor++]
    if (item.locallyValid && item.row.website) item.websiteReachable = await reachable(item.row.website)
  }
}
await Promise.all(Array.from({ length: 10 }, () => worker()))

db.exec(`
  DROP TABLE IF EXISTS restaurant_candidate_validation;
  CREATE TABLE restaurant_candidate_validation (
    candidate_id TEXT PRIMARY KEY,
    verdict TEXT NOT NULL,
    auto_promote INTEGER NOT NULL,
    category TEXT,
    refreshed_year INTEGER,
    menu_item_count INTEGER NOT NULL,
    website_reachable INTEGER,
    reason TEXT NOT NULL,
    evidence TEXT NOT NULL,
    validated_at TEXT NOT NULL
  );
`)
const insert = db.prepare('INSERT INTO restaurant_candidate_validation VALUES (?,?,?,?,?,?,?,?,?,?)')
const stats = new Map()
db.exec('BEGIN')
try {
  for (const item of assessed) {
    const freshnessConfirmed = item.row.best_source === 'ubereats' || item.year >= 2026 || item.websiteReachable === true
    const verdict = item.locallyValid && freshnessConfirmed ? 'validated_new' : item.reason === 'stale' ? 'hold_stale' : 'rejected_or_hold'
    const autoPromote = verdict === 'validated_new'
    insert.run(item.row.candidate_id, verdict, autoPromote ? 1 : 0, item.category, item.year,
      item.menuItems, item.websiteReachable === null ? null : item.websiteReachable ? 1 : 0,
      item.reason, JSON.stringify({ source:item.row.best_source, quality:item.row.quality_score, near_alias_risk:item.nearAliasRisk }), now)
    stats.set(verdict, (stats.get(verdict) || 0) + 1)
  }
  db.exec('COMMIT')
} catch (error) { db.exec('ROLLBACK'); throw error }

console.table([...stats].map(([verdict,count]) => ({ verdict,count })).sort((a,b)=>b.count-a.count))
console.log(`${assessed.filter(item=>item.websiteReachable===true).length} sites accessibles; ${assessed.filter(item=>item.websiteReachable===false).length} inaccessibles.`)
db.close()
