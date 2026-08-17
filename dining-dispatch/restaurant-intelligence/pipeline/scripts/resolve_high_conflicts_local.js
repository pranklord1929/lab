// Resolves every high-severity field conflict through the traceable golden layer.
// Raw/canonical evidence is preserved; only the derived conflict status changes.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()

db.exec(`
  DROP TABLE IF EXISTS restaurant_conflict_decisions;
  CREATE TABLE restaurant_conflict_decisions (
    conflict_id INTEGER PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
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
  SELECT c.*, g.field_provenance,
    CASE c.field
      WHEN 'name' THEN g.name
      WHEN 'address' THEN g.address
      WHEN 'phone' THEN g.phone
      WHEN 'website' THEN g.website
      WHEN 'coordinates' THEN json_object('latitude',g.latitude,'longitude',g.longitude)
    END AS chosen_value
  FROM restaurant_field_conflicts c
  JOIN restaurant_golden_record g ON g.restaurant_id = c.restaurant_id
  WHERE c.severity = 'high' AND c.resolution = 'open'
`).all()

const insert = db.prepare('INSERT INTO restaurant_conflict_decisions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
const mark = db.prepare("UPDATE restaurant_field_conflicts SET resolution='golden_preferred' WHERE id=?")

db.exec('BEGIN')
try {
  for (const row of rows) {
    let provenance = {}
    try { provenance = JSON.parse(row.field_provenance || '{}') } catch {}
    insert.run(
      row.id, row.restaurant_id, row.restaurant_name, row.field,
      row.chosen_value, provenance[row.field] || null,
      JSON.stringify({
        source_a: row.source_a, value_a: row.value_a,
        source_b: row.source_b, value_b: row.value_b,
        similarity: row.similarity, distance_meters: row.distance_meters,
        min_match_confidence: row.min_match_confidence,
      }),
      'golden_source_priority', now,
    )
    mark.run(row.id)
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

const summary = db.prepare(`
  SELECT field, chosen_source, COUNT(*) count
  FROM restaurant_conflict_decisions
  GROUP BY field, chosen_source
  ORDER BY field, count DESC
`).all()
console.table(summary)
console.log(`${rows.length} conflits forts arbitrés; preuves conservées dans restaurant_conflict_decisions.`)
db.close()
