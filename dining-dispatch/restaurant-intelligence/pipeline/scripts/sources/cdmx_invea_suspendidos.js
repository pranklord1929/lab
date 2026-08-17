// =============================================================================
// CDMX — INVEA suspendidos COVID-19 (août 2021)
//
// 444 établissements suspendus par l'INVEA pendant la pandémie : bars, cantinas,
// restaurantes, salones de fiestas, etc. Nom commercial + alcaldía + giro.
//
// Source : datos.cdmx.gob.mx (geo-bloqué) → récupéré via Wayback Machine.
//
// Champs : No, FECHA, ALCALDÍA, GIRO, DENOMINACIÓN, DILIGENCIA
// =============================================================================

import 'dotenv/config'
import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { parse } from 'csv-parse/sync'

const SOURCE = 'cdmx_invea_suspendidos'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

const WAYBACK_URL =
  'https://web.archive.org/web/20220817005855id_/https://datos.cdmx.gob.mx/dataset/9caee1b0-db31-4a18-aa6f-49d8c69e26c4/resource/1e84b683-b7c8-44a2-9f3f-500f82e1ffa4/download/suspensiones_invea_covid19_agosto_2021.xlsx-sheet1.csv'

async function scrape() {
  const res = await fetch(WAYBACK_URL)
  if (!res.ok) throw new Error(`Wayback ${res.status} on ${WAYBACK_URL}`)
  const csv = await res.text()
  const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true })

  return rows
    .filter(r => r.DENOMINACIÓN)
    .map(r => ({
      source_id: `invea_${r.No}`,
      name: r.DENOMINACIÓN,
      latitude: null,
      longitude: null,
      address: null,
      phone: null,
      website: null,
      payload: {
        alcaldia: r.ALCALDÍA || null,
        giro: r.GIRO || null,
        fecha_suspension: r.FECHA ? new Date(r.FECHA).toISOString().slice(0, 10) : null,
        diligencia: r.DILIGENCIA || null,
        snapshot: '2021-08',
        wayback_url: WAYBACK_URL,
      },
    }))
}

async function main() {
  console.log(`[${SOURCE}] scrape via Wayback...`)
  const records = await scrape()
  console.log(`  ${records.length} records`)

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
  console.log(`Écrit : ${OUT_FILE}`)
  console.log(`\nProchaine étape :`)
  console.log(`  npm run ingest -- --source=${SOURCE} --date=${TODAY}`)
}

main().catch(e => { console.error(e); process.exit(1) })
