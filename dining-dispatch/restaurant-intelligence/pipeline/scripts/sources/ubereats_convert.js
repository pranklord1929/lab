// Convertit le dump legacy data/ubereats_cdmx.json vers le format standard
// data/raw/ubereats/<date>.json attendu par ingest.js (source_id, name, lat/lon, payload).
//
// Usage: node scripts/sources/ubereats_convert.js

import { mkdir, readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

const TODAY = new Date().toISOString().slice(0, 10)
const INPUT = resolve('data/ubereats_cdmx.json')
const OUT_DIR = resolve('data/raw/ubereats')
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

const raw = JSON.parse(await readFile(INPUT, 'utf8'))

const records = raw
  .filter(r => r.uberEatsId && r.name)
  .map(r => ({
    source_id: r.uberEatsId,
    name: r.name,
    latitude: r.lat ?? null,
    longitude: r.lon ?? null,
    address: r.address ?? null,
    phone: null,
    website: null,
    payload: r, // record complet, menu inclus
  }))

await mkdir(OUT_DIR, { recursive: true })
await writeFile(OUT_FILE, JSON.stringify(records, null, 2))

const withMenu = records.filter(r => r.payload.menu?.length).length
console.log(`${records.length} records → ${OUT_FILE} (${withMenu} avec menu)`)
console.log(`Etape suivante: npm run ingest -- --source=ubereats --date=${TODAY}`)
