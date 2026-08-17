// Classifies possible duplicates using only stored source data and the local canonical corpus.
// Default is dry-run. --execute persists the review and marks only safe distinct venues promotable.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { distanceMeters } from './lib/normalize.js'

const EXECUTE = process.argv.includes('--execute')
const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()

function json(value) { try { return JSON.parse(value || '{}') } catch { return {} } }
function validCoord(lat, lon) { return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 19.15 && lat <= 19.65 && lon >= -99.40 && lon <= -98.90 }
function allowedCategory(value) {
  return /Restaurant|Taquer|Taco|Pizzeria|Pizza|Bakery|Bistro|Diner|Steakhouse|Barbecue|BBQ|Burger|Breakfast|Coffee|Caf[eé]|Bar$|Joint|Food Truck|Sandwich|Deli|Buffet|Soup|Salad/i.test(value || '') &&
    !/^(Restaurant|Department Store|Miscellaneous Store|Fuel Station|Hotel|Grocery Store|Gourmet Store)$/i.test(value || '')
}
function explicitCdmx(value) {
  const address = String(value || ''), postal = address.match(/\b\d{5}\b/)?.[0]
  return Boolean((postal && /^[01]/.test(postal)) || /Ciudad de M[eé]xico|\bCDMX\b|Distrito Federal/i.test(address))
}
function outsideCdmx(value) {
  return /State of Mexico|Estado de M[eé]xico|Naucalpan|Tlalnepantla|Cuautitl[aá]n|Chimalhuac[aá]n|Nezahualc[oó]yotl|Ecatepec|Chalco|Atizap[aá]n|Huixquilucan|Texcoco|Tec[aá]mac|Bosque Real|Metepec/i.test(value || '')
}
function noisyName(value) {
  return /\bmercado\b|experiencia gourmet|italiano liverpool|terraza santa f[eé]|market kitchen|departamento|oficina|corporativ|hotel|city market|sanborns caf[eé]$/i.test(value || '')
}
function canonicalCdmx(row) {
  return /^[01]\d{4}$/.test(String(row.cp || '')) || /Cuauht[eé]moc|Miguel Hidalgo|Benito Ju[aá]rez|Coyoac[aá]n|Tlalpan|Iztapalapa|Xochimilco|Tl[aá]huac|Azcapotzalco|Gustavo A\.? Madero|Cuajimalpa|Milpa Alta|Magdalena Contreras|Venustiano Carranza|[AÁ]lvaro Obreg[oó]n/i.test(row.alcaldia || '')
}
function gridKey(lat, lon) { return `${Math.floor(lat / 0.004)}:${Math.floor(lon / 0.004)}` }

const grid = new Map()
for (const row of db.prepare('SELECT latitud,longitud,cp,alcaldia FROM restaurants').all()) {
  const lat = Number(row.latitud), lon = Number(row.longitud)
  if (!validCoord(lat, lon) || !canonicalCdmx(row)) continue
  const key = gridKey(lat, lon)
  if (!grid.has(key)) grid.set(key, [])
  grid.get(key).push({ lat, lon })
}
function support(lat, lon) {
  const x = Math.floor(lat / 0.004), y = Math.floor(lon / 0.004), distances = []
  for (let dx=-2; dx<=2; dx++) for (let dy=-2; dy<=2; dy++) for (const row of grid.get(`${x+dx}:${y+dy}`) || []) {
    const d = distanceMeters(lat, lon, row.lat, row.lon)
    if (d <= 500) distances.push(d)
  }
  distances.sort((a,b)=>a-b)
  return { nearest:distances[0] ?? null, count500m:distances.length }
}

const rows = db.prepare(`
  SELECT c.*,t.nearest_restaurant_id,t.nearest_restaurant_name,t.distance_meters,t.name_similarity,t.token_similarity,
    sr.payload
  FROM restaurant_candidate_triage t
  JOIN restaurant_candidate_pool c USING(candidate_id)
  JOIN restaurant_candidate_members m USING(candidate_id)
  JOIN source_records sr ON sr.id=m.source_record_id AND sr.source=c.best_source
  WHERE t.classification='possible_duplicate'
`).all()

const assessed = rows.map(row => {
  const payload = json(row.payload)
  const refreshedYear = Number(String(payload.date_refreshed || '').slice(0,4)) || null
  const category = payload.categories?.[0]?.name || payload.category || null
  const lat = Number(row.latitude), lon = Number(row.longitude)
  const local = validCoord(lat, lon) ? support(lat, lon) : { nearest:null, count500m:0 }
  const distinctNames = row.token_similarity < 0.5 && row.name_similarity < 0.7
  const safelySeparated = row.distance_meters >= 75 ||
    (row.distance_meters >= 30 && row.token_similarity < 0.2 && row.name_similarity < 0.5)
  const safeNew = refreshedYear === 2026 && validCoord(lat, lon) && explicitCdmx(row.address) &&
    !outsideCdmx(row.address) && allowedCategory(category) && !noisyName(row.name) && distinctNames && safelySeparated &&
    local.nearest !== null && local.nearest <= 300 && local.count500m >= 3
  let classification = 'hold_nearby_ambiguous'
  if (refreshedYear && refreshedYear < 2025) classification = 'hold_stale'
  else if (safeNew) classification = 'safe_new_distinct'
  else if (!allowedCategory(category) || noisyName(row.name)) classification = 'non_restaurant_or_generic'
  return { row, refreshedYear, category, local, classification, autoPromote:safeNew ? 1 : 0 }
})

const counts = Object.groupBy(assessed, row => row.classification)
console.table(Object.entries(counts).map(([classification,items]) => ({ classification,count:items.length })))
console.table(assessed.filter(row => row.autoPromote).map(item => ({
  name:item.row.name, nearby:item.row.nearest_restaurant_name, meters:Math.round(item.row.distance_meters),
  category:item.category, neighbors:item.local.count500m,
})))

if (EXECUTE) {
  db.exec(`CREATE TABLE IF NOT EXISTS restaurant_candidate_resolution (
    candidate_id TEXT PRIMARY KEY, classification TEXT NOT NULL, auto_promote INTEGER NOT NULL,
    evidence TEXT NOT NULL, resolved_at TEXT NOT NULL
  )`)
  const save = db.prepare('INSERT OR REPLACE INTO restaurant_candidate_resolution VALUES (?,?,?,?,?)')
  const validate = db.prepare(`INSERT OR REPLACE INTO restaurant_candidate_validation
    (candidate_id,verdict,auto_promote,category,refreshed_year,menu_item_count,website_reachable,reason,evidence,validated_at)
    VALUES (?,?,?,?,?,0,NULL,?,?,?)`)
  db.exec('BEGIN')
  try {
    for (const item of assessed) {
      const evidence = JSON.stringify({ source:item.row.best_source, nearby:item.row.nearest_restaurant_name,
        distance_meters:item.row.distance_meters, name_similarity:item.row.name_similarity,
        token_similarity:item.row.token_similarity, refreshed_year:item.refreshedYear,
        nearest_local_m:item.local.nearest, canonical_neighbors_500m:item.local.count500m })
      save.run(item.row.candidate_id,item.classification,item.autoPromote,evidence,now)
      validate.run(item.row.candidate_id,item.classification,item.autoPromote,item.category,item.refreshedYear,
        item.classification,evidence,now)
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
db.close()
