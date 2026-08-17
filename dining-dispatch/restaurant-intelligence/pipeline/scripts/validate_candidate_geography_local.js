// Validates fresh Foursquare candidates using only the local CDMX restaurant corpus.
// Default is dry-run; --execute marks the safe cohort for candidate promotion.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { distanceMeters } from './lib/normalize.js'

const EXECUTE = process.argv.includes('--execute')
const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()

function validCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 19.15 && lat <= 19.65 && lon >= -99.40 && lon <= -98.90
}
function allowedCategory(value) {
  return /Restaurant|Taquer|Taco|Pizzeria|Pizza|Bakery|Bistro|Diner|Steakhouse|Barbecue|BBQ|Burger|Breakfast|Coffee|Caf[eé]|Bar$|Joint|Food Truck|Sandwich|Deli|Buffet|Soup|Salad/i.test(value || '') &&
    !/^(Restaurant|Department Store|Miscellaneous Store|Fuel Station|Hotel|Grocery Store|Gourmet Store)$/i.test(value || '')
}
function noisyName(value) {
  return /distribuidora|banquetes|alquiladora|impulsora|manteles|hotel|comedor|club\s*house|city market|cremeria|proveedora|alimentos|asociaci[oó]n|\boxxo\b|decathlon|fantas[ií]as miguel|florer[ií]a|\blego\b|\bpetco\b|\bsally\b|\bsumesa\b|\bsuperama\b|\bcostco\b|circle k|restaurante liverpool|^mercado\b|^tianguis\b|^terraza de restaurantes$|^kinder\b|^cafeteria\s*,?\s*sushi\s*&\s*hamburguesas$/i.test(value || '')
}
function genericChain(value) {
  return /chili'?s|italianni'?s|p\.?f\.?\s*chang|tim hortons|pasteler[ií]as esperanza|starbucks|sanborns|\btoks\b|\bkfc\b|mc\s*donald|burger king|\bsubway\b|domino'?s|little\s+cea?sars|bisquets? obreg[oó]n|marco'?s pizza|boston'?s pizza|^wings$|^mr\.? sushi$/i.test(String(value || '').trim())
}
function explicitCdmx(value) {
  const address = String(value || '')
  const postal = address.match(/\b\d{5}\b/)?.[0]
  return Boolean((postal && /^[01]/.test(postal)) || /Ciudad de M[eé]xico|\bCDMX\b|Distrito Federal/i.test(address))
}
function outsideCdmx(value) {
  return /State of Mexico|Estado de M[eé]xico|Naucalpan|Tlalnepantla|Cuautitl[aá]n|Chimalhuac[aá]n|Nezahualc[oó]yotl|Ecatepec|Chalco|Atizap[aá]n|Huixquilucan|Texcoco|Tec[aá]mac|Bosque Real|Metepec/i.test(value || '')
}
function canonicalCdmx(row) {
  return /^[01]\d{4}$/.test(String(row.cp || '')) || /Cuauht[eé]moc|Miguel Hidalgo|Benito Ju[aá]rez|Coyoac[aá]n|Tlalpan|Iztapalapa|Xochimilco|Tl[aá]huac|Azcapotzalco|Gustavo A\.? Madero|Cuajimalpa|Milpa Alta|Magdalena Contreras|Venustiano Carranza|[AÁ]lvaro Obreg[oó]n/i.test(row.alcaldia || '')
}
function gridKey(lat, lon) { return `${Math.floor(lat / 0.004)}:${Math.floor(lon / 0.004)}` }

const grid = new Map()
for (const row of db.prepare('SELECT id,latitud,longitud,cp,alcaldia FROM restaurants').all()) {
  const lat = Number(row.latitud), lon = Number(row.longitud)
  if (!validCoord(lat, lon) || !canonicalCdmx(row)) continue
  const key = gridKey(lat, lon)
  if (!grid.has(key)) grid.set(key, [])
  grid.get(key).push({ lat, lon })
}

function localSupport(lat, lon) {
  const x = Math.floor(lat / 0.004), y = Math.floor(lon / 0.004), distances = []
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
    for (const row of grid.get(`${x + dx}:${y + dy}`) || []) {
      const distance = distanceMeters(lat, lon, row.lat, row.lon)
      if (distance <= 500) distances.push(distance)
    }
  }
  distances.sort((a, b) => a - b)
  return { nearest: distances[0] ?? null, count500m: distances.length }
}

const rows = db.prepare(`
  SELECT c.*,v.category,v.refreshed_year,v.evidence
  FROM restaurant_candidate_pool c
  JOIN restaurant_candidate_triage t USING(candidate_id)
  JOIN restaurant_candidate_validation v USING(candidate_id)
  WHERE t.classification='new_high_confidence'
    AND c.best_source='foursquare'
    AND v.reason='category_name_or_address_risk'
    AND v.refreshed_year=2026
`).all()

const assessed = rows.map(row => {
  const lat = Number(row.latitude), lon = Number(row.longitude)
  let evidence = {}
  try { evidence = JSON.parse(row.evidence || '{}') } catch {}
  const support = validCoord(lat, lon) ? localSupport(lat, lon) : { nearest:null, count500m:0 }
  const locationConfirmed = explicitCdmx(row.address) ||
    (support.nearest !== null && support.nearest <= 100 && support.count500m >= 10)
  const eligible = validCoord(lat, lon) && locationConfirmed && !outsideCdmx(row.address) &&
    allowedCategory(row.category) && !noisyName(row.name) && !genericChain(row.name) &&
    evidence.near_alias_risk !== true && support.nearest !== null && support.nearest <= 250 && support.count500m >= 3
  return { row, support, eligible, locationConfirmed }
})

const safe = assessed.filter(item => item.eligible)
console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} ${JSON.stringify({ assessed:assessed.length, validated:safe.length })}`)
console.table(safe.slice(0, 25).map(item => ({
  name:item.row.name, category:item.row.category, nearest_m:Math.round(item.support.nearest), neighbors_500m:item.support.count500m,
})))
if (process.argv.includes('--details')) console.log(JSON.stringify(safe.map(item => ({
  name:item.row.name, category:item.row.category, address:item.row.address,
  nearest_m:Math.round(item.support.nearest), neighbors_500m:item.support.count500m,
})), null, 2))

if (EXECUTE) {
  const update = db.prepare(`UPDATE restaurant_candidate_validation
    SET verdict='validated_geo_local',auto_promote=1,reason='fresh_local_geo_corroboration',evidence=?,validated_at=?
    WHERE candidate_id=?`)
  db.exec('BEGIN')
  try {
    for (const item of safe) {
      update.run(JSON.stringify({ source:'foursquare', local_geo:true, nearest_canonical_m:item.support.nearest,
        canonical_neighbors_500m:item.support.count500m, near_alias_risk:false }), now, item.row.candidate_id)
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}

db.close()
