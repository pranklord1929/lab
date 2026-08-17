// Marks only strict, provenance-backed geocoded candidates as promotable.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const EXECUTE=process.argv.includes('--execute')
const db=new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now=new Date().toISOString()
const rows=db.prepare(`
  SELECT c.*,t.classification,sr.payload
  FROM restaurant_candidate_pool c
  JOIN restaurant_candidate_triage t USING(candidate_id)
  JOIN restaurant_candidate_members m USING(candidate_id)
  JOIN source_records sr ON sr.id=m.source_record_id
  WHERE c.best_source='restaurantguru' AND json_extract(sr.payload,'$.geocode.provider')='nominatim'
`).all()
const assessed=rows.map(row=>{
  let payload={};try{payload=JSON.parse(row.payload||'{}')}catch{}
  const eligible=row.classification==='new_high_confidence'&&Number.isFinite(Number(row.latitude))&&Number.isFinite(Number(row.longitude))
  return {row,payload,eligible}
})
console.log(`${EXECUTE?'EXECUTE':'DRY-RUN'} ${JSON.stringify({assessed:assessed.length,validated:assessed.filter(v=>v.eligible).length})}`)
console.table(assessed.map(item=>({name:item.row.name,classification:item.row.classification,eligible:item.eligible,
  latitude:item.row.latitude,longitude:item.row.longitude})))
if(EXECUTE){
  const save=db.prepare(`INSERT OR REPLACE INTO restaurant_candidate_validation
    (candidate_id,verdict,auto_promote,category,refreshed_year,menu_item_count,website_reachable,reason,evidence,validated_at)
    VALUES (?,?,?,NULL,NULL,0,NULL,?,?,?)`)
  db.exec('BEGIN')
  try{
    for(const item of assessed){
      const verdict=item.eligible?'validated_strict_geocode':'geocoded_duplicate_hold'
      const evidence=JSON.stringify({source:'restaurantguru',provider:'nominatim',
        display_name:item.payload.geocode?.display_name,attribution:item.payload.geocode?.attribution,
        latitude:item.row.latitude,longitude:item.row.longitude})
      save.run(item.row.candidate_id,verdict,item.eligible?1:0,verdict,evidence,now)
    }
    db.exec('COMMIT')
  }catch(error){db.exec('ROLLBACK');throw error}
}
db.close()
