// Validates strong RestaurantGuru-only venues without inventing coordinates.
// Default is dry-run. --execute stores evidence for address-only promotion.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { normalizeName } from './lib/normalize.js'

const EXECUTE = process.argv.includes('--execute')
const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()

function json(value) { try { return JSON.parse(value || '{}') } catch { return {} } }
function fold(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(calle|avenida|av|calzada|calz|numero|num|no|local|piso|colonia|col)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}
function addressCore(value) {
  const tokens = fold(value).split(' ').filter(Boolean)
  const numberIndex = tokens.findIndex(token => /^\d+[a-z]?$/.test(token))
  if (numberIndex < 0) return null
  return tokens.slice(0, Math.min(tokens.length, numberIndex + 1)).join(' ')
}
function noisyName(value) {
  return /catering|\bbares?\s+polanco\b|^antro en |hotel|casino|sal[oó]n de eventos|comedor|escuela|distribuidora|banquetes|tienda|shop tasting|club house/i.test(value || '')
}
function brandCore(value) {
  const stop = /\b(restaurant|restaurante|ristorante|bar|cafe|coffee|shop|rooftop|mexico|city|cdmx|roma|norte|sur|condesa|polanco|lomas|masaryk|santa|fe|coyoacan|napoles|del|valle)\b/g
  const core = fold(value).replace(stop,' ').replace(/\s+/g,' ').trim()
  return core.length >= 5 ? core : null
}

const canonicalAddresses = db.prepare(`
  SELECT restaurant_id,address FROM restaurant_golden_record WHERE address IS NOT NULL AND address!=''
`).all().map(row => ({ ...row, folded:fold(row.address) }))
const canonicalNames = new Set(db.prepare('SELECT nombre FROM restaurants WHERE nombre IS NOT NULL').all()
  .map(row => normalizeName(row.nombre)).filter(Boolean))
const canonicalBrandCoreList = db.prepare('SELECT nombre FROM restaurants WHERE nombre IS NOT NULL').all()
  .map(row => brandCore(row.nombre)).filter(Boolean)
const canonicalBrandCores = new Set(canonicalBrandCoreList)

const rows = db.prepare(`
  SELECT c.*,sr.payload
  FROM restaurant_candidate_pool c
  JOIN restaurant_candidate_members m USING(candidate_id)
  JOIN source_records sr ON sr.id=m.source_record_id AND sr.source='restaurantguru'
  WHERE c.best_source='restaurantguru' AND c.review_status='high'
`).all()

const addressFrequency = new Map()
for (const row of rows) {
  const core = addressCore(row.address)
  if (core) addressFrequency.set(core,(addressFrequency.get(core)||0)+1)
}

const assessed = rows.map(row => {
  const payload = json(row.payload), rank = Number(payload.rank) || null, core = addressCore(row.address)
  const coreName = brandCore(row.name)
  const nameCollision = canonicalNames.has(normalizeName(row.name)) || (coreName &&
    (canonicalBrandCores.has(coreName) || canonicalBrandCoreList.some(existing =>
      existing.includes(coreName) || coreName.includes(existing))))
  const collision = core ? canonicalAddresses.some(existing =>
    existing.folded === core || existing.folded.startsWith(`${core} `) || core.startsWith(`${existing.folded} `)) : false
  const eligible = rank !== null && rank <= 500 && Number(row.rating) >= 4.5 && core && core.length >= 6 &&
    addressFrequency.get(core) === 1 && !collision && !nameCollision && !noisyName(row.name) && row.name.length >= 3 && row.name.length <= 100
  let classification = 'lower_signal'
  if (collision) classification = 'address_collision_hold'
  else if (nameCollision) classification = 'name_collision_hold'
  else if (noisyName(row.name)) classification = 'non_restaurant_or_generic'
  else if (eligible) classification = 'validated_address_only'
  return { row,payload,rank,core,collision,nameCollision,eligible,classification }
})

console.table(Object.entries(Object.groupBy(assessed,row=>row.classification)).map(([classification,items])=>({classification,count:items.length})))
console.table(assessed.filter(row=>row.eligible).slice(0,40).map(item=>({
  name:item.row.name,address:item.row.address,rating:item.row.rating,rank:item.rank,
})))

if (EXECUTE) {
  const save = db.prepare(`INSERT OR REPLACE INTO restaurant_candidate_validation
    (candidate_id,verdict,auto_promote,category,refreshed_year,menu_item_count,website_reachable,reason,evidence,validated_at)
    VALUES (?,?,?,NULL,NULL,0,NULL,?,?,?)`)
  db.exec('BEGIN')
  try {
    for (const item of assessed) {
      const evidence = JSON.stringify({ source:'restaurantguru',rank:item.rank,rating:item.row.rating,
        address_core:item.core,address_collision:item.collision,name_collision:item.nameCollision,address_only:true })
      save.run(item.row.candidate_id,item.classification,item.eligible?1:0,item.classification,evidence,now)
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
db.close()
