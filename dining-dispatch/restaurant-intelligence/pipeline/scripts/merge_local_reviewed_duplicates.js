// Applies a small, human-reviewed set of local duplicate merges.
// Every removed row is serialized in restaurant_merge_quarantine first.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const EXECUTE = process.argv.includes('--execute')
const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))

const APPROVED = new Map([
  ['befa6f59-b79e-4fac-97be-94a0e515b0a2', 'Daikoku Michoacan: same phone/site, adjacent street number, 20m'],
  ['6bee8b68-fcce-4a70-ae87-a0ee002af239', 'Lalo: same phone/site, opposite-side address discrepancy, 71m'],
  ['e6a17fd9-c03e-45de-b381-ab8c19c5bc57', 'Sarde: same phone/site, corner addresses, 27m'],
  ['0daead34-c43d-4669-83cb-0b7a7124b359', 'Pizzas Mia: same name/phone/street number, postal-code discrepancy'],
  ['e6a2913c-619c-4d42-9763-3063f89bce91', 'Colmeneros: same phone, corner addresses, 26m'],
  ['81b726f6-1938-4244-8e25-07cc63df4d47', 'Zaza: same phone/site/address, 7m'],
])

const candidate = db.prepare(`
  SELECT d.*, a.*,
    b.id b_id, b.nombre b_nombre, b.denue_id b_denue_id, b.created_at b_created_at
  FROM restaurant_duplicate_candidates d
  JOIN restaurants a ON a.id=d.master_id
  JOIN restaurants b ON b.id=d.duplicate_id
  WHERE d.id=? AND d.resolved_at IS NULL
`)
const countRelated = db.prepare(`
  SELECT
    (SELECT count(*) FROM source_records WHERE matched_restaurant_id=?) +
    (SELECT count(*) FROM restaurant_identities WHERE restaurant_id=?) +
    (SELECT count(*) FROM restaurant_links WHERE restaurant_id=?) +
    (SELECT count(*) FROM menu_documents WHERE restaurant_id=?) +
    (SELECT count(*) FROM menu_items WHERE restaurant_id=?) AS n
`)
const fetchRestaurant = db.prepare('SELECT * FROM restaurants WHERE id=?')

function richness(row) {
  return Object.entries(row).filter(([key, value]) => !key.startsWith('b_') && value !== null && value !== '').length
}
function score(row) {
  return countRelated.get(row.id, row.id, row.id, row.id, row.id).n * 100 + richness(row)
}

const plans = []
for (const [candidateId, reason] of APPROVED) {
  const row = candidate.get(candidateId)
  if (!row) continue
  const left = fetchRestaurant.get(row.master_id)
  const right = fetchRestaurant.get(row.duplicate_id)
  if (!left || !right) continue
  const [master, duplicate] = score(left) >= score(right) ? [left, right] : [right, left]
  plans.push({ candidateId, reason, master, duplicate })
}

console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} — ${plans.length} doublons validés`)
console.table(plans.map(p => ({ master: p.master.nombre, duplicate: p.duplicate.nombre, reason: p.reason })))
if (!EXECUTE) {
  console.log('Relance avec --execute pour appliquer ces fusions réversibles.')
  db.close()
  process.exit(0)
}

db.exec(`CREATE TABLE IF NOT EXISTS restaurant_merge_quarantine (
  duplicate_id TEXT PRIMARY KEY, master_id TEXT NOT NULL, rule TEXT NOT NULL,
  master_before TEXT NOT NULL, duplicate_before TEXT NOT NULL,
  moved_children TEXT NOT NULL, merged_at TEXT NOT NULL
)`)
const columns = db.prepare('PRAGMA table_info(restaurants)').all().map(row => row.name)
const patchable = columns.filter(c => !['id', 'denue_id', 'google_place_id', 'created_at'].includes(c))
const updateMaster = db.prepare(`UPDATE restaurants SET ${patchable.map(c => `"${c}"=?`).join(',')} WHERE id=?`)
const save = db.prepare('INSERT INTO restaurant_merge_quarantine VALUES (?,?,?,?,?,?,?)')
const now = new Date().toISOString()
const childTables = [
  ['source_records', 'matched_restaurant_id'], ['restaurant_identities', 'restaurant_id'],
  ['restaurant_links', 'restaurant_id'], ['menu_documents', 'restaurant_id'],
  ['menu_items', 'restaurant_id'], ['google_local_enrichment_log', 'restaurant_id'],
  ['top500_web_crawl_log', 'restaurant_id'], ['restaurant_candidate_promotion_log', 'restaurant_id'],
  ['menu_document_quality', 'restaurant_id'], ['menu_items_local_extracted', 'restaurant_id'],
]

db.exec('BEGIN')
try {
  for (const plan of plans) {
    const master = fetchRestaurant.get(plan.master.id)
    const duplicate = fetchRestaurant.get(plan.duplicate.id)
    if (!master || !duplicate) continue
    const moved = {}
    for (const [table, column] of childTables) {
      moved[table] = db.prepare(`SELECT count(*) n FROM ${table} WHERE ${column}=?`).get(duplicate.id).n
    }
    save.run(duplicate.id, master.id, `reviewed:${plan.candidateId}`, JSON.stringify(master),
      JSON.stringify(duplicate), JSON.stringify({ ...moved, reason: plan.reason }), now)

    const merged = { ...master }
    for (const column of patchable) {
      if ((merged[column] === null || merged[column] === '') && duplicate[column] !== null && duplicate[column] !== '') {
        merged[column] = duplicate[column]
      }
    }
    merged.updated_at = now
    updateMaster.run(...patchable.map(column => merged[column]), master.id)

    for (const [table, column] of childTables) {
      db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${column}=?`).run(master.id, duplicate.id)
    }
    db.prepare(`UPDATE restaurant_duplicate_candidates SET resolved_at=?,resolution='merged'
      WHERE resolved_at IS NULL AND ((master_id=? AND duplicate_id=?) OR (master_id=? AND duplicate_id=?))`)
      .run(now, master.id, duplicate.id, duplicate.id, master.id)
    db.prepare('UPDATE restaurant_duplicate_candidates SET master_id=? WHERE master_id=?').run(master.id, duplicate.id)
    db.prepare('UPDATE restaurant_duplicate_candidates SET duplicate_id=? WHERE duplicate_id=?').run(master.id, duplicate.id)
    db.prepare(`UPDATE restaurant_duplicate_candidates SET resolved_at=?,resolution='superseded_by_merge'
      WHERE resolved_at IS NULL AND master_id=duplicate_id`).run(now)

    for (const table of ['restaurant_search_mv', 'restaurant_golden_record', 'restaurant_field_conflicts',
      'restaurant_conflict_decisions', 'top500_conflict_decisions', 'top500_enrichment_status']) {
      const column = table === 'restaurant_search_mv' ? 'id' : 'restaurant_id'
      db.prepare(`DELETE FROM ${table} WHERE ${column} IN (?,?)`).run(master.id, duplicate.id)
    }
    db.prepare('DELETE FROM restaurants WHERE id=?').run(duplicate.id)
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

console.log(`${plans.length} doublons fusionnés; snapshots de rollback conservés.`)
db.close()
