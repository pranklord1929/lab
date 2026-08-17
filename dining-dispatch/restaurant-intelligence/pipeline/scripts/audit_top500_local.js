// Materializes top-500 enrichment coverage inside SQLite and writes a JSON summary.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const DB_PATH = resolve('data/local_db/cdmx_local.sqlite')
const OUT_PATH = resolve('data/exports/top500_local_audit.json')
const db = new DatabaseSync(DB_PATH)
const generatedAt = new Date().toISOString()

db.exec(`
  DROP TABLE IF EXISTS top500_enrichment_status;
  CREATE TABLE top500_enrichment_status AS
  SELECT
    s.rank_overall AS rank,
    g.restaurant_id,
    g.name,
    g.alcaldia,
    g.richness_score,
    g.prestige_score,
    g.source_count,
    (g.phone IS NOT NULL) AS has_phone,
    (g.website IS NOT NULL) AS has_website,
    (g.instagram IS NOT NULL) AS has_instagram,
    (g.opening_hours IS NOT NULL) AS has_hours,
    (g.rating IS NOT NULL) AS has_rating,
    (g.photo_count > 0) AS has_photos,
    g.photo_count,
    EXISTS(SELECT 1 FROM menu_documents m WHERE m.restaurant_id = g.restaurant_id) AS has_menu_document,
    EXISTS(SELECT 1 FROM menu_document_quality q WHERE q.restaurant_id = g.restaurant_id AND q.quality_status IN ('high','index')) AS has_quality_menu,
    EXISTS(SELECT 1 FROM menu_documents m JOIN menu_document_quality q ON q.menu_document_id = m.id WHERE m.restaurant_id = g.restaurant_id AND m.statut = 'extracted' AND q.quality_status = 'high') AS has_extracted_menu,
    (EXISTS(SELECT 1 FROM menu_items i WHERE i.restaurant_id = g.restaurant_id) OR EXISTS(SELECT 1 FROM menu_items_local_extracted i WHERE i.restaurant_id = g.restaurant_id)) AS has_menu_items,
    (SELECT COUNT(*) FROM menu_documents m WHERE m.restaurant_id = g.restaurant_id) AS menu_document_count,
    (SELECT COUNT(*) FROM menu_items i WHERE i.restaurant_id = g.restaurant_id) + (SELECT COUNT(*) FROM menu_items_local_extracted i WHERE i.restaurant_id = g.restaurant_id) AS menu_item_count,
    EXISTS(SELECT 1 FROM source_records sr WHERE sr.matched_restaurant_id = g.restaurant_id AND sr.source = 'google_places') AS has_google,
    COALESCE((SELECT high_conflicts FROM restaurant_conflict_summary c WHERE c.restaurant_id = g.restaurant_id), 0) AS high_conflicts,
    trim(
      CASE WHEN g.instagram IS NULL THEN 'instagram,' ELSE '' END ||
      CASE WHEN g.website IS NULL THEN 'website,' ELSE '' END ||
      CASE WHEN g.opening_hours IS NULL THEN 'hours,' ELSE '' END ||
      CASE WHEN g.photo_count = 0 THEN 'photos,' ELSE '' END ||
      CASE WHEN NOT EXISTS(SELECT 1 FROM menu_document_quality q WHERE q.restaurant_id = g.restaurant_id AND q.quality_status IN ('high','index')) THEN 'menu,' ELSE '' END,
      ','
    ) AS missing_fields,
    (
      (g.instagram IS NULL) * 3 +
      (NOT EXISTS(SELECT 1 FROM menu_document_quality q WHERE q.restaurant_id = g.restaurant_id AND q.quality_status IN ('high','index'))) * 3 +
      (g.website IS NULL) * 2 +
      (g.opening_hours IS NULL) * 2 +
      (g.photo_count = 0) * 2 +
      COALESCE((SELECT MIN(high_conflicts, 3) FROM restaurant_conflict_summary c WHERE c.restaurant_id = g.restaurant_id), 0) * 4
    ) AS action_priority,
    '${generatedAt}' AS generated_at
  FROM restaurant_search_mv s
  JOIN restaurant_golden_record g ON g.restaurant_id = s.id
  WHERE s.rank_overall BETWEEN 1 AND 500;

  CREATE UNIQUE INDEX idx_top500_status_rank ON top500_enrichment_status(rank);
  CREATE INDEX idx_top500_status_priority ON top500_enrichment_status(action_priority DESC);
`)

const summary = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(has_phone) AS phone,
    SUM(has_website) AS website,
    SUM(has_instagram) AS instagram,
    SUM(has_hours) AS hours,
    SUM(has_rating) AS rating,
    SUM(has_photos) AS photos,
    SUM(has_menu_document) AS menu_document,
    SUM(has_quality_menu) AS quality_menu,
    SUM(has_extracted_menu) AS extracted_menu,
    SUM(has_menu_items) AS menu_items,
    SUM(has_google) AS google,
    SUM(high_conflicts > 0) AS with_high_conflicts
  FROM top500_enrichment_status
`).get()
const priority = db.prepare(`
  SELECT rank,name,missing_fields,high_conflicts,action_priority
  FROM top500_enrichment_status
  WHERE action_priority > 0
  ORDER BY action_priority DESC, rank
  LIMIT 100
`).all()

mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, `${JSON.stringify({ generatedAt, summary, priority }, null, 2)}\n`)
console.log(JSON.stringify(summary))
console.log(OUT_PATH)
db.close()
