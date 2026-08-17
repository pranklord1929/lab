// Merges only canonical rows sharing the exact same Google Place ID nearby.
// Default: dry-run. --execute writes a full rollback snapshot before each merge.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const EXECUTE = process.argv.includes('--execute')
const DB_PATH = resolve('data/local_db/cdmx_local.sqlite')
const db = new DatabaseSync(DB_PATH)

function num(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function distanceMeters(a, b) {
  const coords = [a.latitud, a.longitud, b.latitud, b.longitud].map(num)
  if (coords.some(value => value === null)) return null
  const [lat1d, lon1d, lat2d, lon2d] = coords
  const toRad = degrees => degrees * Math.PI / 180
  const earth = 6371000
  const dLat = toRad(lat2d - lat1d), dLon = toRad(lon2d - lon1d)
  const lat1 = toRad(lat1d), lat2 = toRad(lat2d)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * earth * Math.asin(Math.sqrt(h))
}

const groups = db.prepare(`
  SELECT google_place_id
  FROM restaurants
  WHERE google_place_id IS NOT NULL AND trim(google_place_id) <> ''
  GROUP BY google_place_id
  HAVING COUNT(*) > 1
`).all()

const fetchGroup = db.prepare('SELECT * FROM restaurants WHERE google_place_id = ?')
const countRelated = {
  source_records: db.prepare('SELECT COUNT(*) AS count FROM source_records WHERE matched_restaurant_id = ?'),
  restaurant_identities: db.prepare('SELECT COUNT(*) AS count FROM restaurant_identities WHERE restaurant_id = ?'),
  restaurant_links: db.prepare('SELECT COUNT(*) AS count FROM restaurant_links WHERE restaurant_id = ?'),
  menu_documents: db.prepare('SELECT COUNT(*) AS count FROM menu_documents WHERE restaurant_id = ?'),
  menu_items: db.prepare('SELECT COUNT(*) AS count FROM menu_items WHERE restaurant_id = ?'),
}

function completeness(row) {
  return ['telefono', 'correo_electronico', 'sitio_web', 'instagram', 'facebook', 'nom_vialidad',
    'numero_exterior', 'colonia', 'alcaldia', 'cp', 'latitud', 'longitud', 'cuisine_type', 'horaires']
    .filter(field => row[field] !== null && row[field] !== '').length
}

function score(row) {
  const related = Object.values(countRelated).reduce((sum, statement) => sum + statement.get(row.id).count, 0)
  return related * 100 + completeness(row)
}

const plans = []
for (const { google_place_id: placeId } of groups) {
  const rows = fetchGroup.all(placeId)
  const maxDistance = Math.max(...rows.flatMap((a, i) => rows.slice(i + 1).map(b => distanceMeters(a, b) ?? Infinity)))
  if (maxDistance > 120) continue
  rows.sort((a, b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)))
  const [master, ...duplicates] = rows
  for (const duplicate of duplicates) {
    plans.push({ placeId, master, duplicate, distance: Math.round(distanceMeters(master, duplicate) || 0) })
  }
}

console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} — ${plans.length} doublons exacts à fusionner`)
for (const plan of plans) {
  console.log(`${plan.master.nombre} ← ${plan.duplicate.nombre} | ${plan.distance}m | ${plan.placeId}`)
}

if (!EXECUTE) {
  console.log('\nRelance avec --execute pour fusionner localement.')
  db.close()
  process.exit(0)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS restaurant_merge_quarantine (
    duplicate_id TEXT PRIMARY KEY,
    master_id TEXT NOT NULL,
    rule TEXT NOT NULL,
    master_before TEXT NOT NULL,
    duplicate_before TEXT NOT NULL,
    moved_children TEXT NOT NULL,
    merged_at TEXT NOT NULL
  );
`)

const restaurantColumns = db.prepare('PRAGMA table_info(restaurants)').all().map(row => row.name)
const updatableColumns = restaurantColumns.filter(column => !['id', 'denue_id', 'google_place_id', 'created_at'].includes(column))
const updateMaster = db.prepare(`UPDATE restaurants SET ${updatableColumns.map(column => `"${column}" = ?`).join(', ')} WHERE id = ?`)
const saveMerge = db.prepare('INSERT OR IGNORE INTO restaurant_merge_quarantine VALUES (?, ?, ?, ?, ?, ?, ?)')
const deleteRestaurant = db.prepare('DELETE FROM restaurants WHERE id = ?')
const deleteSearch = db.prepare('DELETE FROM restaurant_search_mv WHERE id = ?')
const mergedAt = new Date().toISOString()

function childIds(table, column, id) {
  return db.prepare(`SELECT id FROM ${table} WHERE ${column} = ?`).all(id).map(row => row.id)
}

db.exec('BEGIN')
try {
  for (const plan of plans) {
    const master = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(plan.master.id)
    const duplicate = db.prepare('SELECT * FROM restaurants WHERE id = ?').get(plan.duplicate.id)
    if (!master || !duplicate) continue

    const moved = {
      source_records: childIds('source_records', 'matched_restaurant_id', duplicate.id),
      restaurant_identities: childIds('restaurant_identities', 'restaurant_id', duplicate.id),
      restaurant_links: childIds('restaurant_links', 'restaurant_id', duplicate.id),
      menu_documents: childIds('menu_documents', 'restaurant_id', duplicate.id),
      menu_items: childIds('menu_items', 'restaurant_id', duplicate.id),
    }
    saveMerge.run(
      duplicate.id, master.id, 'same_google_place_id_120m',
      JSON.stringify(master), JSON.stringify(duplicate), JSON.stringify(moved), mergedAt,
    )

    const merged = { ...master }
    for (const column of updatableColumns) {
      if ((merged[column] === null || merged[column] === '') && duplicate[column] !== null && duplicate[column] !== '') {
        merged[column] = duplicate[column]
      }
    }
    merged.updated_at = mergedAt
    updateMaster.run(...updatableColumns.map(column => merged[column]), master.id)

    db.prepare('UPDATE source_records SET matched_restaurant_id = ? WHERE matched_restaurant_id = ?').run(master.id, duplicate.id)
    db.prepare('UPDATE restaurant_identities SET restaurant_id = ? WHERE restaurant_id = ?').run(master.id, duplicate.id)
    db.prepare('UPDATE restaurant_links SET restaurant_id = ? WHERE restaurant_id = ?').run(master.id, duplicate.id)
    db.prepare('UPDATE menu_documents SET restaurant_id = ? WHERE restaurant_id = ?').run(master.id, duplicate.id)
    db.prepare('UPDATE menu_items SET restaurant_id = ? WHERE restaurant_id = ?').run(master.id, duplicate.id)

    db.prepare(`
      UPDATE restaurant_duplicate_candidates
      SET resolved_at = ?, resolution = 'merged'
      WHERE resolved_at IS NULL
        AND ((master_id = ? AND duplicate_id = ?) OR (master_id = ? AND duplicate_id = ?))
    `).run(mergedAt, master.id, duplicate.id, duplicate.id, master.id)
    db.prepare('UPDATE restaurant_duplicate_candidates SET master_id = ? WHERE master_id = ?').run(master.id, duplicate.id)
    db.prepare('UPDATE restaurant_duplicate_candidates SET duplicate_id = ? WHERE duplicate_id = ?').run(master.id, duplicate.id)

    deleteSearch.run(duplicate.id)
    deleteRestaurant.run(duplicate.id)
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

console.log(`${plans.length} doublons fusionnés. Rollback conservé dans restaurant_merge_quarantine.`)
db.close()

