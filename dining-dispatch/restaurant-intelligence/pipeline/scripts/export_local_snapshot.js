// Télécharge TOUTES les tables Supabase vers un snapshot local :
//   data/local_db/cdmx_local.sqlite  (base SQLite requêtable, un seul fichier)
//   data/local_db/jsonl/<table>.jsonl (backup texte brut, 1 ligne JSON par enregistrement)
//   data/local_db/manifest.json      (comptes par table + vérification)
// Usage : node scripts/export_local_snapshot.js
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const OUT_DIR = path.resolve('data/local_db');
const JSONL_DIR = path.join(OUT_DIR, 'jsonl');
const DB_PATH = path.join(OUT_DIR, 'cdmx_local.sqlite');
const TMP_DB_PATH = path.join(OUT_DIR, 'cdmx_local.sqlite.next');
const PAGE_SIZE = 1000;

// Colonnes relevées sur le projet Supabase le 2026-07-14 (information_schema).
// Types : sert uniquement à déclarer les colonnes SQLite avec la bonne affinité.
const TABLES = {
  restaurants: { id: 'uuid', denue_id: 'text', nombre: 'text', razon_social: 'text', codigo_scian: 'text', actividad: 'text', estrato: 'text', telefono: 'text', correo_electronico: 'text', sitio_web: 'text', instagram: 'text', facebook: 'text', tipo_vialidad: 'text', nom_vialidad: 'text', numero_exterior: 'text', numero_interior: 'text', colonia: 'text', alcaldia: 'text', cp: 'text', latitud: 'numeric', longitud: 'numeric', osm_id: 'text', cuisine_type: 'text', horaires: 'text', google_place_id: 'text', verified_open: 'boolean', verified_at: 'timestamp', categorie: 'text', gamme_prix: 'text', statut: 'text', source: 'text', prospect_statut: 'text', contact_nom: 'text', contact_poste: 'text', derniere_contact: 'timestamp', notes: 'text', created_at: 'timestamp', updated_at: 'timestamp', search_vector: 'text' },
  source_records: { id: 'uuid', source: 'text', source_id: 'text', scrape_date: 'date', scraped_at: 'timestamp', name: 'text', latitude: 'numeric', longitude: 'numeric', address: 'text', phone: 'text', website: 'text', payload: 'jsonb', processed_at: 'timestamp', matched_restaurant_id: 'uuid', match_confidence: 'numeric', match_method: 'text', created_at: 'timestamp' },
  restaurant_identities: { id: 'uuid', restaurant_id: 'uuid', source: 'text', source_id: 'text', source_url: 'text', confidence: 'numeric', match_method: 'text', notes: 'text', created_at: 'timestamp', updated_at: 'timestamp' },
  restaurant_links: { id: 'uuid', restaurant_id: 'uuid', url: 'text', normalized_url: 'text', host: 'text', source: 'text', link_type: 'text', provider: 'text', status: 'text', confidence_score: 'numeric', http_status: 'integer', final_url: 'text', final_host: 'text', content_type: 'text', title: 'text', checked_at: 'timestamp', error_message: 'text', created_at: 'timestamp', updated_at: 'timestamp' },
  restaurant_duplicate_candidates: { id: 'uuid', master_id: 'uuid', duplicate_id: 'uuid', rule: 'text', name_similarity: 'numeric', distance_meters: 'numeric', confidence: 'numeric', payload: 'jsonb', created_at: 'timestamp', resolved_at: 'timestamp', resolution: 'text' },
  menu_documents: { id: 'uuid', restaurant_id: 'uuid', source_url: 'text', file_type: 'text', raw_text: 'text', langue: 'text', confidence_score: 'numeric', extraction_method: 'text', statut: 'text', last_checked_at: 'timestamp', created_at: 'timestamp', updated_at: 'timestamp' },
  menu_items: { id: 'uuid', restaurant_id: 'uuid', menu_document_id: 'uuid', nom: 'text', description: 'text', prix: 'numeric', devise: 'text', categorie: 'text', created_at: 'timestamp' },
  pipeline_events: { id: 'uuid', agent_name: 'text', terminal: 'text', status: 'text', task: 'text', blocker: 'text', pct: 'integer', records: 'integer', notes: 'text', created_at: 'timestamp' },
  restaurant_search_mv: { id: 'uuid', name: 'text', colonia: 'text', alcaldia: 'text', address: 'text', lat: 'numeric', lng: 'numeric', phone: 'text', website: 'text', instagram: 'text', rating: 'numeric', review_count: 'integer', price_level: 'integer', photo_ref: 'text', photo_refs: 'jsonb', photo_count: 'integer', summary: 'text', hours: 'jsonb', google_maps_uri: 'text', business_status: 'text', cuisine_key: 'text', michelin_cuisine: 'text', opentable_cuisine: 'text', michelin_distinction: 'text', michelin_stars: 'integer', bib_gourmand: 'boolean', michelin_url: 'text', in_worlds_50_best: 'boolean', w50_rank: 'text', w50_list: 'text', opentable_url: 'text', score: 'numeric', rank_overall: 'bigint', is_enriched: 'boolean', has_photo: 'boolean' },
  // Tables Bistrot Bastards (même projet Supabase) : incluses pour que le backup soit complet
  clients: { id: 'uuid', slug: 'text', name: 'text', owner_name: 'text', neighborhood: 'text', website_url: 'text', website_repo: 'text', instagram_handle: 'text', google_place_id: 'text', created_at: 'timestamp', updated_at: 'timestamp' },
  brand_kits: { id: 'uuid', client_id: 'uuid', logo_url: 'text', primary_color: 'text', secondary_color: 'text', primary_font: 'text', pitch: 'text', signature_items: 'text', tone_of_voice: 'text', words_to_use: 'text', words_to_avoid: 'text', reference_photos: 'jsonb', updated_at: 'timestamp', palette: 'jsonb', logo_variants: 'jsonb' },
  drafts: { id: 'uuid', client_id: 'uuid', kind: 'text', status: 'text', title: 'text', body: 'text', hashtags: 'text', image_urls: 'array', source_photos: 'jsonb', target_metadata: 'jsonb', generated_by_model: 'text', created_at: 'timestamp', approved_at: 'timestamp', published_at: 'timestamp', rendered_png_url: 'text', note: 'text', instagram_post_id: 'text', publish_attempts: 'integer', last_publish_error: 'text', last_publish_attempt_at: 'timestamp' },
  actions_log: { id: 'uuid', client_id: 'uuid', draft_id: 'uuid', action: 'text', payload: 'jsonb', result: 'jsonb', success: 'boolean', error: 'text', created_at: 'timestamp' },
  schedules: { id: 'uuid', client_id: 'uuid', name: 'text', kind: 'text', template_slug: 'text', recurrence: 'text', config: 'jsonb', active: 'boolean', last_generated_at: 'timestamp', next_run_at: 'timestamp', created_at: 'timestamp', updated_at: 'timestamp' },
  photos: { id: 'uuid', client_id: 'uuid', filename: 'text', relative_path: 'text', thumbnail_path: 'text', width: 'integer', height: 'integer', size_bytes: 'bigint', mime_type: 'text', exif_taken_at: 'timestamp', exif_camera: 'text', exif_lens: 'text', tags: 'array', caption: 'text', alt_text: 'text', source: 'text', used_in_post_ids: 'array', last_used_at: 'timestamp', created_at: 'timestamp', updated_at: 'timestamp' },
  webhooks: { id: 'uuid', client_id: 'uuid', kind: 'text', provider: 'text', url: 'text', active: 'boolean', notes: 'text', created_at: 'timestamp', updated_at: 'timestamp' },
  wines: { id: 'uuid', client_id: 'uuid', name: 'text', domain: 'text', appellation: 'text', region: 'text', country: 'text', vintage: 'integer', color: 'text', style: 'text', grapes: 'array', tasting_notes: 'text', fabrice_note: 'text', price_glass_cts: 'integer', price_bottle_cts: 'integer', available: 'boolean', featured_last_at: 'timestamp', created_at: 'timestamp' },
  seo_queue: { id: 'uuid', client_slug: 'text', article_title: 'text', article_slug: 'text', article_body_html: 'text', meta_description: 'text', target_keyword: 'text', reading_minutes: 'integer', publish_at: 'timestamp', published_at: 'timestamp', article_url: 'text', relay_url: 'text', status: 'text', created_at: 'timestamp' },
  seo_publish_log: { id: 'uuid', client_slug: 'text', article_title: 'text', article_slug: 'text', article_url: 'text', relay_url: 'text', published_at: 'timestamp', triggered_by: 'text' },
};

function sqliteType(pgType) {
  if (['integer', 'bigint'].includes(pgType)) return 'INTEGER';
  if (pgType === 'numeric') return 'REAL';
  if (pgType === 'boolean') return 'INTEGER'; // 0/1
  return 'TEXT'; // uuid, text, timestamp, date, jsonb, array, tsvector
}

function toSqliteValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v); // jsonb + arrays
  return v;
}

async function exportTable(db, table, columns) {
  const cols = Object.keys(columns);
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  const defs = cols.map((c) => `"${c}" ${sqliteType(columns[c])}`).join(', ');
  db.exec(`DROP TABLE IF EXISTS "${table}"`);
  db.exec(`CREATE TABLE "${table}" (${defs})`);
  const insert = db.prepare(`INSERT INTO "${table}" (${quoted}) VALUES (${cols.map(() => '?').join(', ')})`);

  const jsonlPath = path.join(JSONL_DIR, `${table}.jsonl`);
  const jsonl = fs.createWriteStream(jsonlPath);

  const { count: expected, error: countError } = await supabase
    .from(table).select('id', { count: 'exact', head: true });
  if (countError) throw new Error(`${table} count: ${countError.message}`);

  let exported = 0;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table).select('*')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table} range ${from}: ${error.message}`);
    if (!data.length) break;

    db.exec('BEGIN');
    for (const row of data) {
      jsonl.write(JSON.stringify(row) + '\n');
      insert.run(...cols.map((c) => toSqliteValue(row[c])));
    }
    db.exec('COMMIT');
    exported += data.length;
    process.stdout.write(`\r  ${table}: ${exported}/${expected ?? '?'}`);
    if (data.length < PAGE_SIZE) break;
  }
  await new Promise((resolve) => jsonl.end(resolve));
  const ok = expected === null || exported === expected;
  console.log(ok ? '  ✔' : `  ✖ ATTENDU ${expected}`);
  return { exported, expected, ok };
}

async function main() {
  fs.mkdirSync(JSONL_DIR, { recursive: true });
  // Build beside the live snapshot, then replace it atomically. This keeps the
  // website readable throughout the export and preserves the old DB on error.
  fs.rmSync(TMP_DB_PATH, { force: true });
  fs.rmSync(`${TMP_DB_PATH}-wal`, { force: true });
  fs.rmSync(`${TMP_DB_PATH}-shm`, { force: true });
  const db = new DatabaseSync(TMP_DB_PATH);
  // A snapshot is a single portable file. WAL would leave committed pages in a
  // sidecar that is not part of the atomic rename and can corrupt the handoff.
  db.exec('PRAGMA journal_mode = DELETE');
  db.exec('PRAGMA synchronous = FULL');

  const manifest = { exported_at: new Date().toISOString(), supabase_project: 'pdbgbpqrpcveivhvxsus', tables: {} };
  let allOk = true;
  for (const [table, columns] of Object.entries(TABLES)) {
    manifest.tables[table] = await exportTable(db, table, columns);
    allOk &&= manifest.tables[table].ok;
  }
  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (!integrity || Object.values(integrity)[0] !== 'ok') {
    throw new Error(`SQLite integrity_check: ${JSON.stringify(integrity)}`);
  }
  db.close();
  // Old WAL sidecars belong to the previous inode and must never be paired with
  // the new snapshot. With DELETE journal mode they will not be recreated.
  fs.rmSync(`${DB_PATH}-wal`, { force: true });
  fs.rmSync(`${DB_PATH}-shm`, { force: true });
  fs.renameSync(TMP_DB_PATH, DB_PATH);
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\nSnapshot : ${DB_PATH}`);
  console.log(allOk ? 'Tous les comptes correspondent ✔' : 'ATTENTION : écarts de comptes, voir manifest.json');
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
