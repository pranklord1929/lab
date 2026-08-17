// Records deterministic golden-record choices for top-500 high conflicts.
// Conflicting evidence remains in restaurant_field_conflicts; only resolution changes.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()

db.exec(`
  DROP TABLE IF EXISTS top500_conflict_decisions;
  CREATE TABLE top500_conflict_decisions (
    conflict_id INTEGER PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    rank INTEGER NOT NULL,
    restaurant_name TEXT NOT NULL,
    field TEXT NOT NULL,
    chosen_value TEXT,
    chosen_source TEXT,
    rejected_evidence TEXT NOT NULL,
    decision TEXT NOT NULL,
    decided_at TEXT NOT NULL
  );
`)

const rows = db.prepare(`
  SELECT c.*, t.rank, g.field_provenance,
    CASE c.field
      WHEN 'name' THEN g.name
      WHEN 'address' THEN g.address
      WHEN 'phone' THEN g.phone
      WHEN 'website' THEN g.website
      WHEN 'coordinates' THEN json_object('latitude',g.latitude,'longitude',g.longitude)
    END AS chosen_value
  FROM restaurant_field_conflicts c
  JOIN top500_enrichment_status t ON t.restaurant_id = c.restaurant_id
  JOIN restaurant_golden_record g ON g.restaurant_id = c.restaurant_id
  WHERE c.severity = 'high' AND c.resolution = 'open'
`).all()
const insert = db.prepare(`INSERT INTO top500_conflict_decisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'golden_priority', ?)`)
const mark = db.prepare(`UPDATE restaurant_field_conflicts SET resolution='golden_preferred' WHERE id=?`)

db.exec('BEGIN')
try {
  for (const row of rows) {
    let provenance = {}
    try { provenance = JSON.parse(row.field_provenance || '{}') } catch {}
    const source = provenance[row.field] || null
    insert.run(row.id, row.restaurant_id, row.rank, row.restaurant_name, row.field,
      row.chosen_value, source, JSON.stringify({
        source_a: row.source_a, value_a: row.value_a,
        source_b: row.source_b, value_b: row.value_b,
        similarity: row.similarity, distance_meters: row.distance_meters,
      }), now)
    mark.run(row.id)
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

const summary = db.prepare(`SELECT field,COUNT(*) count FROM top500_conflict_decisions GROUP BY field ORDER BY count DESC`).all()
console.table(summary)
console.log(`${rows.length} conflits forts top 500 arbitrés; preuves conservées.`)
db.close()
