// =============================================================================
// CDMX — Mercados Públicos
//
// 329 marchés publics CDMX avec GPS, alcaldía, nb locales, surface, giro
// dominant. Pas des restaurants individuels, mais contexte géographique :
// chaque marché contient N locales dont une part = fondas/comida prep.
//
// Source : datos.cdmx.gob.mx (geo-bloqué) → récupéré via Wayback Machine.
// =============================================================================

import 'dotenv/config'
import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'
import { parse } from 'csv-parse/sync'

const SOURCE = 'cdmx_mercados_publicos'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

const WAYBACK_URL =
  'https://web.archive.org/web/20250319223849id_/https://datos.cdmx.gob.mx/dataset/6e008c6b-197c-49f2-899f-47b9a406596c/resource/c27dbd03-6083-40d5-a5cc-9e8c429779bc/download/mercados_publicos.csv'

function numOrNull(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function scrape() {
  const res = await fetch(WAYBACK_URL)
  if (!res.ok) throw new Error(`Wayback ${res.status} on ${WAYBACK_URL}`)
  const csv = await res.text()
  const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true })

  return rows
    .filter(r => r.mercado && r.numero)
    .map(r => ({
      source_id: `mercado_${r.numero}`,
      name: `Mercado ${r.mercado}`,
      latitude: numOrNull(r.latitud),
      longitude: numOrNull(r.longitud),
      address: r.direccion || null,
      phone: null,
      website: null,
      payload: {
        mercado: r.mercado,
        numero: r.numero,
        locales: numOrNull(r.locales),
        colonia: r.colonia_mercado || null,
        alcaldia: r.alcaldia_mercado || null,
        tipo: r.tipo || null,
        superficie_m2: numOrNull(r.superficie_m2),
        anio_inauguracion: r.anio_inauguracion || null,
        giro: r.giro && r.giro !== 'NA' ? r.giro : null,
        detalle: r.detalle && r.detalle !== 'NA' ? r.detalle : null,
        protegido: r.protegido === 'SI',
        tamano: r['tamaño'] || null,
        forma: r.forma || null,
        niveles: r.niveles || null,
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
