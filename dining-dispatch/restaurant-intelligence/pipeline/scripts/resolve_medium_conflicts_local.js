// Resolves low-risk website disagreements through golden-record provenance.
// Identity-critical medium conflicts (name/address/phone) remain open.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()
db.exec(`
  CREATE TABLE IF NOT EXISTS restaurant_medium_conflict_decisions (
    conflict_id INTEGER PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    field TEXT NOT NULL,
    chosen_value TEXT,
    chosen_source TEXT,
    rejected_evidence TEXT NOT NULL,
    decision TEXT NOT NULL,
    decided_at TEXT NOT NULL
  )
`)
const rows = db.prepare(`
  SELECT c.*,g.website chosen_value,g.field_provenance
  FROM restaurant_field_conflicts c
  JOIN restaurant_golden_record g ON g.restaurant_id=c.restaurant_id
  WHERE c.severity='medium' AND c.resolution='open' AND c.field='website'
`).all()
const insert = db.prepare('INSERT OR REPLACE INTO restaurant_medium_conflict_decisions VALUES (?,?,?,?,?,?,?,?)')
const mark = db.prepare("UPDATE restaurant_field_conflicts SET resolution='golden_preferred' WHERE id=?")
db.exec('BEGIN')
try {
  for (const row of rows) {
    let provenance = {}
    try { provenance = JSON.parse(row.field_provenance || '{}') } catch {}
    insert.run(row.id,row.restaurant_id,row.field,row.chosen_value,provenance.website || null,
      JSON.stringify({source_a:row.source_a,value_a:row.value_a,source_b:row.source_b,value_b:row.value_b}),
      'golden_source_priority_low_risk',now)
    mark.run(row.id)
  }
  db.exec('COMMIT')
} catch (error) { db.exec('ROLLBACK'); throw error }
console.log(`${rows.length} conflits website arbitrés; preuves conservées.`)
db.close()
