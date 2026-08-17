// Resolves obvious false-positive duplicate pairs without deleting any venue.
// Default is dry-run; pass --execute to update the local review queue.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { normalizeName } from './lib/normalize.js'

const EXECUTE = process.argv.includes('--execute')
const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))

function fold(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function phone(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length >= 8 ? digits : null
}

function addressKey(row, prefix = '') {
  const parts = [
    fold(row[`${prefix}tipo_vialidad`]), fold(row[`${prefix}nom_vialidad`]),
    fold(row[`${prefix}numero_exterior`]), String(row[`${prefix}cp`] ?? '').replace(/\D/g, ''),
  ]
  if (parts.some(part => !part) || /^(ninguno|sin numero|s n|sn|0)$/.test(parts[2])) return null
  return parts.join('|')
}

function distanceMeters(row) {
  const values = [row.latitud, row.longitud, row.b_latitud, row.b_longitud].map(Number)
  if (values.some(value => !Number.isFinite(value))) return null
  const [lat1d, lon1d, lat2d, lon2d] = values
  const rad = degrees => degrees * Math.PI / 180
  const lat1 = rad(lat1d), lat2 = rad(lat2d)
  const dLat = lat2 - lat1, dLon = rad(lon2d - lon1d)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.sqrt(h))
}

const rows = db.prepare(`
  SELECT d.id candidate_id, d.payload candidate_payload, d.master_id, d.duplicate_id,
    a.nombre, a.telefono, a.tipo_vialidad, a.nom_vialidad, a.numero_exterior, a.cp,
    a.alcaldia, a.latitud, a.longitud,
    b.nombre b_nombre, b.telefono b_telefono, b.tipo_vialidad b_tipo_vialidad,
    b.nom_vialidad b_nom_vialidad, b.numero_exterior b_numero_exterior, b.cp b_cp,
    b.alcaldia b_alcaldia, b.latitud b_latitud, b.longitud b_longitud
  FROM restaurant_duplicate_candidates d
  JOIN restaurants a ON a.id = d.master_id
  JOIN restaurants b ON b.id = d.duplicate_id
  WHERE d.resolved_at IS NULL AND d.rule = 'name_phone'
`).all()

const plans = []
for (const row of rows) {
  const leftAddress = addressKey(row)
  const rightAddress = addressKey(row, 'b_')
  const distance = distanceMeters(row)
  const differentAlcaldia = fold(row.alcaldia) && fold(row.b_alcaldia)
    && fold(row.alcaldia) !== fold(row.b_alcaldia)
  if (normalizeName(row.nombre) !== normalizeName(row.b_nombre)) continue
  if (!phone(row.telefono) || phone(row.telefono) !== phone(row.b_telefono)) continue
  if (!leftAddress || !rightAddress || leftAddress === rightAddress) continue
  if (!(distance === null ? differentAlcaldia : distance >= 150)) continue
  plans.push({ ...row, distance })
}

console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} — ${plans.length} paires = succursales distinctes`)
const names = new Map()
for (const row of plans) names.set(row.nombre, (names.get(row.nombre) || 0) + 1)
console.table([...names].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, pairs]) => ({ name, pairs })))

if (!EXECUTE) {
  console.log('Relance avec --execute pour fermer ces faux positifs sans fusion.')
  db.close()
  process.exit(0)
}

const update = db.prepare(`
  UPDATE restaurant_duplicate_candidates
  SET resolved_at = ?, resolution = 'kept_distinct_branch', payload = ?
  WHERE id = ? AND resolved_at IS NULL
`)
const now = new Date().toISOString()
db.exec('BEGIN')
try {
  for (const row of plans) {
    let payload = {}
    try { payload = JSON.parse(row.candidate_payload || '{}') } catch {}
    payload.local_adjudication = {
      decision: 'kept_distinct_branch', reason: 'same phone but distinct complete addresses',
      calculated_distance_meters: row.distance === null ? null : Math.round(row.distance), decided_at: now,
    }
    update.run(now, JSON.stringify(payload), row.candidate_id)
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

console.log(`${plans.length} faux positifs fermés; aucune fiche restaurant modifiée.`)
db.close()
