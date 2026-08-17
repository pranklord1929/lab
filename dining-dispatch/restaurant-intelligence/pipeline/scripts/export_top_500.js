import 'dotenv/config'
import { writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'
import { supabase } from './lib/supabase.js'

const OUT_DIR = resolve('data/exports')
const OUT_CSV = resolve(OUT_DIR, 'top_500.csv')
const OUT_JSON = resolve(OUT_DIR, 'top_500.json')

function csvEscape(value) {
  if (value == null) return ''
  const s = String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

async function fetchTop500() {
  const { data, error } = await supabase
    .from('restaurant_score')
    .select('rank_overall, nombre, alcaldia, score, signal_prestige, signal_volume, signal_quality, signal_cross_source, signal_completion, signal_editorial, google_place_id, sitio_web, instagram')
    .order('score', { ascending: false })
    .order('nombre', { ascending: true })
    .limit(500)

  if (error) throw error
  return data || []
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const rows = await fetchTop500()

  const csvHeader = [
    'rank',
    'nombre',
    'alcaldia',
    'score',
    'signal_prestige',
    'signal_volume',
    'signal_quality',
    'signal_cross_source',
    'signal_completion',
    'signal_editorial',
    'google_place_id',
    'sitio_web',
    'instagram',
  ]

  const csvLines = [
    csvHeader.join(','),
    ...rows.map(row => [
      row.rank_overall,
      row.nombre,
      row.alcaldia,
      row.score,
      row.signal_prestige,
      row.signal_volume,
      row.signal_quality,
      row.signal_cross_source,
      row.signal_completion,
      row.signal_editorial,
      row.google_place_id,
      row.sitio_web,
      row.instagram,
    ].map(csvEscape).join(',')),
  ]

  const jsonRows = rows.map(row => ({
    rank: row.rank_overall,
    nombre: row.nombre,
    alcaldia: row.alcaldia,
    score: row.score,
    signal_prestige: row.signal_prestige,
    signal_volume: row.signal_volume,
    signal_quality: row.signal_quality,
    signal_cross_source: row.signal_cross_source,
    signal_completion: row.signal_completion,
    signal_editorial: row.signal_editorial,
    google_place_id: row.google_place_id,
    sitio_web: row.sitio_web,
    instagram: row.instagram,
  }))

  await writeFile(OUT_CSV, csvLines.join('\n'))
  await writeFile(OUT_JSON, JSON.stringify(jsonRows, null, 2))

  console.log(`Wrote ${rows.length} rows`)
  console.log(OUT_CSV)
  console.log(OUT_JSON)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
