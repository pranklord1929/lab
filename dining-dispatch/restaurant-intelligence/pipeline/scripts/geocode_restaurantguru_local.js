// One-time, cached RestaurantGuru geocoding through public Nominatim.
// Policy: one thread, <=1 request/second, local cache, never periodic.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { nameSimilarity } from './lib/normalize.js'

const EXECUTE = process.argv.includes('--execute')
const LIMIT = Number(process.argv.find(arg=>arg.startsWith('--limit='))?.split('=')[1] || 50)
const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()

db.exec(`CREATE TABLE IF NOT EXISTS restaurant_candidate_geocodes (
  candidate_id TEXT PRIMARY KEY, provider TEXT NOT NULL, query TEXT NOT NULL,
  latitude REAL, longitude REAL, display_name TEXT, osm_type TEXT, osm_id TEXT,
  status TEXT NOT NULL, raw_result TEXT NOT NULL, queried_at TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS restaurant_candidate_geocode_attempts (
   candidate_id TEXT NOT NULL, provider TEXT NOT NULL, query TEXT NOT NULL,
   latitude REAL, longitude REAL, display_name TEXT, osm_type TEXT, osm_id TEXT,
   status TEXT NOT NULL, raw_result TEXT NOT NULL, queried_at TEXT NOT NULL,
   PRIMARY KEY(candidate_id,provider,query)
 )`)
db.exec(`INSERT OR IGNORE INTO restaurant_candidate_geocode_attempts
  SELECT * FROM restaurant_candidate_geocodes`)

const rows = db.prepare(`
  SELECT c.candidate_id,c.name,c.address,c.rating,v.verdict,v.evidence
  FROM restaurant_candidate_pool c
  JOIN restaurant_candidate_validation v USING(candidate_id)
  LEFT JOIN restaurant_candidate_geocodes g USING(candidate_id)
  WHERE c.best_source='restaurantguru' AND c.review_status='high'
    AND v.verdict='lower_signal' AND g.candidate_id IS NULL
  ORDER BY c.rating DESC,c.name
  LIMIT ?
`).all(LIMIT)

console.log(`${EXECUTE?'EXECUTE':'DRY-RUN'} ${JSON.stringify({planned:rows.length,limit:LIMIT})}`)
if (!EXECUTE) {
  console.table(rows.slice(0,20).map(row=>({name:row.name,address:row.address,rating:row.rating})))
  db.close(); process.exit(0)
}

const save = db.prepare('INSERT OR REPLACE INTO restaurant_candidate_geocodes VALUES (?,?,?,?,?,?,?,?,?,?,?)')
const saveAttempt = db.prepare('INSERT OR REPLACE INTO restaurant_candidate_geocode_attempts VALUES (?,?,?,?,?,?,?,?,?,?,?)')
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms))
let matched=0,miss=0,error=0

function words(value) {
  const stop=new Set(['calle','avenida','calzada','ciudad','mexico','cdmx','local','piso','colonia'])
  return new Set(String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(token=>token.length>2&&!/^\d/.test(token)&&!stop.has(token)))
}
function overlap(left,right) {
  if(!left.size||!right.size)return 0
  let common=0
  for(const token of left)if(right.has(token))common++
  return common/Math.min(left.size,right.size)
}

for (let index=0; index<rows.length; index++) {
  const row=rows[index]
  const query=`${row.name}, ${row.address}, Ciudad de México, CDMX, México`
  const params=new URLSearchParams({q:query,format:'jsonv2',countrycodes:'mx',
    viewbox:'-99.40,19.65,-98.90,19.15',bounded:'1',limit:'3',addressdetails:'1'})
  let status='error',result=null,raw=[]
  try {
    const response=await fetch(`https://nominatim.openstreetmap.org/search?${params}`,{
      headers:{'User-Agent':'CDMXRestaurantsLocalAudit/1.0','Accept':'application/json'}
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    raw=await response.json()
    result=raw.find(item=>{
      const lat=Number(item.lat),lon=Number(item.lon)
      const candidateNumbers=String(row.address||'').match(/\b\d+[a-z]?\b/gi)||[]
      const resultNumber=String(item.address?.house_number||'')
      const exactNumber=resultNumber&&candidateNumbers.some(number=>number.toLowerCase()===resultNumber.toLowerCase())
      const roadScore=overlap(words(row.address),words(`${item.address?.road||''} ${item.address?.pedestrian||''} ${item.address?.neighbourhood||''}`))
      const venueScore=nameSimilarity(row.name,item.name||String(item.display_name||'').split(',')[0])
      return lat>=19.15&&lat<=19.65&&lon>=-99.40&&lon<=-98.90&&
        /Ciudad de M[eé]xico|Distrito Federal|Mexico City/i.test(item.display_name||'')&&
        venueScore>=0.4&&(exactNumber||roadScore>=0.4)
    })||null
    status=result?'matched':raw.length?'ambiguous':'not_found'
  } catch (cause) {
    raw={error:String(cause?.message||cause)}
  }
  const values=[row.candidate_id,'nominatim',query,result?Number(result.lat):null,result?Number(result.lon):null,
    result?.display_name||null,result?.osm_type||null,result?.osm_id?String(result.osm_id):null,status,JSON.stringify(raw),now]
  save.run(...values); saveAttempt.run(...values)
  if(status==='matched') matched++; else if(status==='not_found') miss++; else error++
  console.log(`${index+1}/${rows.length} ${status} ${row.name}${result?` -> ${Number(result.lat).toFixed(5)},${Number(result.lon).toFixed(5)}`:''}`)
  if(index<rows.length-1) await sleep(1100)
}

console.log(JSON.stringify({processed:rows.length,matched,not_found:miss,error}))
db.close()
