// =============================================================================
// INGEST — pousse un raw dump dans la DB en 3 phases :
//
//   Phase A : raw JSON   → source_records (staging immutable + JSONB)
//   Phase B : entity res → matche chaque source_record à un restaurant canonique
//   Phase C : identity   → persiste le mapping pour les prochains scrapes
//
// Usage :
//   node scripts/ingest.js --source=rappi --date=2026-06-26
//   node scripts/ingest.js --source=rappi --date=2026-06-26 --file=data/raw/rappi/2026-06-26.json
//   node scripts/ingest.js --source=rappi --date=2026-06-26 --dry         # n'écrit rien
//   node scripts/ingest.js --source=rappi --date=2026-06-26 --skip-match  # juste staging
//
// =============================================================================

import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { supabase, upsertBatch, sanitizeText } from './lib/supabase.js'
import { resolveEntity, persistIdentity } from './lib/match.js'
import { normalizeUrl, normalizePhoneMx } from './lib/normalize.js'

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=')
    return [k, v ?? true]
  })
)

if (!args.source || !args.date) {
  console.error('Usage: node scripts/ingest.js --source=<src> --date=YYYY-MM-DD [--file=...] [--dry] [--skip-match]')
  process.exit(1)
}

const SOURCE = args.source
const DATE = args.date
const FILE = args.file || resolve('data/raw', SOURCE, `${DATE}.json`)
const DRY = !!args.dry

// ─── Phase A : raw → source_records ─────────────────────────────────────────
async function loadRaw() {
  const raw = await readFile(FILE, 'utf8')
  const arr = JSON.parse(raw)
  if (!Array.isArray(arr)) throw new Error(`${FILE} n'est pas un array`)
  return arr
}

async function pushStaging(records) {
  const rows = records
    .filter(r => r.source_id)
    .map(r => ({
      source: SOURCE,
      source_id: String(r.source_id),
      scrape_date: DATE,
      name: sanitizeText(r.name),
      latitude: r.latitude ?? null,
      longitude: r.longitude ?? null,
      address: sanitizeText(r.address),
      phone: normalizePhoneMx(r.phone),
      website: normalizeUrl(r.website),
      payload: r.payload || r,
    }))

  console.log(`[${SOURCE}] phase A : ${rows.length} records → source_records (date=${DATE})`)
  if (DRY) { console.log('  (dry) sample:', JSON.stringify(rows[0], null, 2).slice(0, 400)); return [] }

  const res = await upsertBatch('source_records', rows, {
    onConflict: 'source,source_id,scrape_date',
    dedupKey: r => `${r.source}::${r.source_id}::${r.scrape_date}`,
  })
  console.log(`  staged ${res.ok}/${res.total}`)

  // Re-fetch pour avoir les IDs (en mode upsert, supabase-js ne les renvoie pas par défaut)
  const { data } = await supabase
    .from('source_records')
    .select('id, source_id, name, latitude, longitude, payload')
    .eq('source', SOURCE).eq('scrape_date', DATE)
    .is('processed_at', null)
  return data || []
}

// ─── Phase B : entity resolution ────────────────────────────────────────────
async function resolveEntities(stagedRows) {
  console.log(`[${SOURCE}] phase B : entity resolution sur ${stagedRows.length} records`)
  if (DRY) return

  const stats = { identity: 0, coords_name: 0, coords_name_fuzzy: 0, name_alcaldia: 0, name_only_high_conf: 0, new_insert: 0 }
  let i = 0
  for (const sr of stagedRows) {
    i++
    const { restaurantId, method, confidence } = await resolveEntity({
      source: SOURCE,
      sourceId: sr.source_id,
      name: sr.name,
      latitude: sr.latitude,
      longitude: sr.longitude,
      alcaldia: sr.payload?.alcaldia,
    })

    stats[method] = (stats[method] || 0) + 1

    // Update source_records avec le match
    await supabase.from('source_records').update({
      processed_at: new Date().toISOString(),
      matched_restaurant_id: restaurantId,
      match_confidence: confidence,
      match_method: method,
    }).eq('id', sr.id)

    // Phase C : persiste l'identity si on a un match avec confiance correcte
    if (restaurantId && confidence >= 0.65) {
      await persistIdentity({
        restaurantId,
        source: SOURCE,
        sourceId: sr.source_id,
        sourceUrl: sr.payload?.url || sr.payload?.source_url || null,
        confidence,
        method,
      })
    }

    if (i % 50 === 0) process.stdout.write(`  ${i}/${stagedRows.length}\r`)
  }
  process.stdout.write('\n')
  console.log('  match stats:', stats)
  console.log(`  → ${stats.new_insert || 0} records sont des "nouveaux restos" à revoir manuellement`)
}

// ─── main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Mode: ${DRY ? 'DRY-RUN' : 'écriture Supabase'}`)
  const records = await loadRaw()
  console.log(`Lu ${records.length} records depuis ${FILE}`)

  const staged = await pushStaging(records)

  if (args['skip-match']) {
    console.log('--skip-match → stop ici')
    return
  }
  await resolveEntities(staged)

  console.log('\nFini.')
}

main().catch(e => { console.error(e); process.exit(1) })
