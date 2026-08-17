// =============================================================================
// SOURCE TEMPLATE — copier ce fichier en `<source>.js` pour ajouter une source.
// =============================================================================
//
// Contract d'une source :
//   1. Le scraper produit un array d'objets et l'écrit dans
//      `data/raw/<source>/<YYYY-MM-DD>.json`.
//   2. Chaque objet doit AU MINIMUM avoir :
//        - `source_id`  : identifiant unique chez la source (slug, store_id, ...)
//        - `name`       : nom du restaurant tel qu'affiché par la source
//      Et idéalement :
//        - `latitude`, `longitude`
//        - `address`
//        - `phone`
//        - `website`
//        - `payload`    : l'enregistrement brut tel quel (toute la donnée)
//   3. Ne JAMAIS écrire directement dans `restaurants`. C'est `ingest.js` qui s'en charge.
//
// Workflow :
//   node scripts/sources/<source>.js              → scrape uniquement (dry, fichier raw)
//   node scripts/ingest.js --source=<source>      → push raw → source_records → entity res
//
// =============================================================================

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'TEMPLATE'                       // ← change moi : 'foursquare', 'yelp', 'tabelog', ...
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

// ─── 1. SCRAPE ───────────────────────────────────────────────────────────────
// Implémente ta logique : Playwright, fetch, GraphQL, ce que tu veux.
// Doit renvoyer un array de records normalisés.
async function scrape() {
  /*
    Exemple :
      const res = await fetch('https://api.foursquare.com/v3/...')
      const json = await res.json()
      return json.results.map(r => ({
        source_id: r.fsq_id,
        name:      r.name,
        latitude:  r.geocodes?.main?.latitude,
        longitude: r.geocodes?.main?.longitude,
        address:   r.location?.formatted_address,
        phone:     r.tel,
        website:   r.website,
        payload:   r,                                   // <-- toujours garder le raw
      }))
  */
  return []
}

// ─── 2. WRITE RAW DUMP ───────────────────────────────────────────────────────
async function main() {
  console.log(`[${SOURCE}] scrape...`)
  const records = await scrape()
  console.log(`  ${records.length} records`)

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
  console.log(`Écrit : ${OUT_FILE}`)
  console.log(`\nProchaine étape :`)
  console.log(`  node scripts/ingest.js --source=${SOURCE} --date=${TODAY}`)
}

main().catch(e => { console.error(e); process.exit(1) })
