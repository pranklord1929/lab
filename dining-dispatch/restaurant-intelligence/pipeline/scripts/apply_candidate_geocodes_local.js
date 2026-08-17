// Applies only strictly matched cached geocodes to source records, preserving provenance.
// Default is dry-run; --execute mutates local SQLite only.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const EXECUTE=process.argv.includes('--execute')
const db=new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now=new Date().toISOString()
const rows=db.prepare(`
  SELECT g.*,m.source_record_id,sr.source,sr.source_id,sr.name,sr.payload
  FROM restaurant_candidate_geocodes g
  JOIN restaurant_candidate_members m USING(candidate_id)
  JOIN source_records sr ON sr.id=m.source_record_id
  WHERE g.status='matched' AND sr.source='restaurantguru'
`).all()

console.log(`${EXECUTE?'EXECUTE':'DRY-RUN'} ${JSON.stringify({matched:rows.length})}`)
console.table(rows.map(row=>({name:row.name,latitude:row.latitude,longitude:row.longitude,display_name:row.display_name})))
if(!EXECUTE){db.close();process.exit(0)}

db.exec(`CREATE TABLE IF NOT EXISTS source_record_geocode_provenance (
  source_record_id TEXT PRIMARY KEY,provider TEXT NOT NULL,query TEXT NOT NULL,
  original_latitude REAL,original_longitude REAL,latitude REAL NOT NULL,longitude REAL NOT NULL,
  display_name TEXT,raw_result TEXT NOT NULL,applied_at TEXT NOT NULL
)`)
const provenance=db.prepare('INSERT OR REPLACE INTO source_record_geocode_provenance VALUES (?,?,?,?,?,?,?,?,?,?)')
const update=db.prepare('UPDATE source_records SET latitude=?,longitude=?,payload=? WHERE id=?')
db.exec('BEGIN')
try{
  for(const row of rows){
    let payload={};try{payload=JSON.parse(row.payload||'{}')}catch{}
    payload.geocode={provider:row.provider,query:row.query,display_name:row.display_name,
      latitude:row.latitude,longitude:row.longitude,queried_at:row.queried_at,
      attribution:'© OpenStreetMap contributors, ODbL'}
    provenance.run(row.source_record_id,row.provider,row.query,null,null,row.latitude,row.longitude,row.display_name,row.raw_result,now)
    update.run(row.latitude,row.longitude,JSON.stringify(payload),row.source_record_id)
  }
  db.exec('COMMIT')
}catch(error){db.exec('ROLLBACK');throw error}
db.close()
