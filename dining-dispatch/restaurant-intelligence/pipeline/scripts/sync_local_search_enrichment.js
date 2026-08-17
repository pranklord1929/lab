// Fills missing product-facing search fields from the traceable local golden record.
// Derived SQLite only; canonical restaurants and Supabase stay untouched.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const before = db.prepare(`SELECT
  SUM(website IS NOT NULL) website,
  SUM(instagram IS NOT NULL) instagram
  FROM restaurant_search_mv WHERE is_enriched = 1`).get()

db.exec(`
  UPDATE restaurant_search_mv
  SET website = COALESCE(NULLIF(trim(website), ''), (
        SELECT g.website FROM restaurant_golden_record g WHERE g.restaurant_id = restaurant_search_mv.id
      )),
      instagram = COALESCE(NULLIF(trim(instagram), ''), (
        SELECT g.instagram FROM restaurant_golden_record g WHERE g.restaurant_id = restaurant_search_mv.id
      ))
  WHERE is_enriched = 1
    AND ((website IS NULL OR trim(website) = '') OR (instagram IS NULL OR trim(instagram) = ''));
`)

const after = db.prepare(`SELECT
  SUM(website IS NOT NULL) website,
  SUM(instagram IS NOT NULL) instagram
  FROM restaurant_search_mv WHERE is_enriched = 1`).get()
console.log(JSON.stringify({ before, after,
  added_websites: after.website - before.website,
  added_instagram: after.instagram - before.instagram }))
db.close()
