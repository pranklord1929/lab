import { createClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse'
import { createReadStream } from 'fs'
import { resolve } from 'path'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Colonnes du CSV DENUE — ne pas modifier
const DENUE_CSV_COLUMNS = {
  id: 'id',
  nombre: 'nom_estab',
  razon_social: 'raz_social',
  codigo_scian: 'codigo_act',
  actividad: 'nombre_act',
  estrato: 'per_ocu',
  telefono: 'telefono',
  correo_electronico: 'correoelec',
  sitio_web: 'www',
  tipo_vialidad: 'tipo_vial',
  nom_vialidad: 'nom_vial',
  numero_exterior: 'numero_ext',
  numero_interior: 'numero_int',
  colonia: 'nomb_asent',
  alcaldia: 'municipio',
  cp: 'cod_postal',
  latitud: 'latitud',
  longitud: 'longitud',
}

const BATCH_SIZE = 500

async function importDENUE(csvPath) {
  const absolutePath = resolve(csvPath)
  console.log(`Lecture du fichier : ${absolutePath}`)

  const rows = []
  let total = 0
  let inserted = 0
  let errors = 0

  const parser = createReadStream(absolutePath).pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      encoding: 'latin1',   // DENUE utilise ISO-8859-1
    })
  )

  for await (const row of parser) {
    // On ne garde que les etablissements de restauration (722 = services de preparation d'aliments)
    if (!row[DENUE_CSV_COLUMNS.codigo_scian]?.startsWith('722')) continue

    const restaurant = {
      denue_id: row[DENUE_CSV_COLUMNS.id],
      nombre: row[DENUE_CSV_COLUMNS.nombre] || 'Sans nom',
      razon_social: row[DENUE_CSV_COLUMNS.razon_social] || null,
      codigo_scian: row[DENUE_CSV_COLUMNS.codigo_scian],
      actividad: row[DENUE_CSV_COLUMNS.actividad],
      estrato: row[DENUE_CSV_COLUMNS.estrato],
      telefono: row[DENUE_CSV_COLUMNS.telefono] || null,
      correo_electronico: row[DENUE_CSV_COLUMNS.correo_electronico] || null,
      sitio_web: row[DENUE_CSV_COLUMNS.sitio_web] || null,
      tipo_vialidad: row[DENUE_CSV_COLUMNS.tipo_vialidad] || null,
      nom_vialidad: row[DENUE_CSV_COLUMNS.nom_vialidad] || null,
      numero_exterior: row[DENUE_CSV_COLUMNS.numero_exterior] || null,
      numero_interior: row[DENUE_CSV_COLUMNS.numero_interior] || null,
      colonia: row[DENUE_CSV_COLUMNS.colonia] || null,
      alcaldia: row[DENUE_CSV_COLUMNS.alcaldia] || null,
      cp: row[DENUE_CSV_COLUMNS.cp] || null,
      latitud: parseFloat(row[DENUE_CSV_COLUMNS.latitud]) || null,
      longitud: parseFloat(row[DENUE_CSV_COLUMNS.longitud]) || null,
      source: 'denue',
      statut: 'actif',
    }

    rows.push(restaurant)

    if (rows.length >= BATCH_SIZE) {
      const result = await insertBatch(rows.splice(0, BATCH_SIZE))
      inserted += result.inserted
      errors += result.errors
      total += BATCH_SIZE
      console.log(`Progres : ${total} lignes traitees — ${inserted} inserees — ${errors} erreurs`)
    }
  }

  // Dernier batch
  if (rows.length > 0) {
    const result = await insertBatch(rows)
    inserted += result.inserted
    errors += result.errors
    total += rows.length
  }

  console.log(`\nTermine. Total : ${total} | Inserees : ${inserted} | Erreurs : ${errors}`)
}

async function insertBatch(batch) {
  const { data, error } = await supabase
    .from('restaurants')
    .upsert(batch, { onConflict: 'denue_id' })

  if (error) {
    console.error('Erreur batch :', error.message)
    return { inserted: 0, errors: batch.length }
  }

  return { inserted: batch.length, errors: 0 }
}

// Recupere le chemin du CSV depuis les arguments
const csvPath = process.argv[2]
if (!csvPath) {
  console.error('Usage : node scripts/import_denue.js <chemin_vers_csv>')
  console.error('Exemple : node scripts/import_denue.js data/denue_cdmx.csv')
  process.exit(1)
}

importDENUE(csvPath)
