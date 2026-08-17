import { createClient } from '@supabase/supabase-js'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const curatedPath = process.argv[2] || 'data/curated_mvp_restaurants.json'

function normalizeRestaurant(row) {
  if (!row.denue_id?.startsWith('curated:')) {
    throw new Error(`denue_id curated invalide pour ${row.nombre || 'restaurant sans nom'}`)
  }

  return {
    denue_id: row.denue_id,
    nombre: row.nombre,
    razon_social: row.razon_social || null,
    codigo_scian: row.codigo_scian || null,
    actividad: row.actividad || null,
    estrato: row.estrato || null,
    telefono: row.telefono || null,
    correo_electronico: row.correo_electronico || null,
    sitio_web: row.sitio_web || null,
    instagram: row.instagram || null,
    facebook: row.facebook || null,
    tipo_vialidad: row.tipo_vialidad || null,
    nom_vialidad: row.nom_vialidad || null,
    numero_exterior: row.numero_exterior || null,
    numero_interior: row.numero_interior || null,
    colonia: row.colonia || null,
    alcaldia: row.alcaldia || null,
    cp: row.cp || null,
    latitud: row.latitud ?? null,
    longitud: row.longitud ?? null,
    osm_id: row.osm_id || null,
    cuisine_type: row.cuisine_type || null,
    horaires: row.horaires || null,
    categorie: row.categorie || null,
    gamme_prix: row.gamme_prix || null,
    statut: row.statut || 'actif',
    source: row.source || 'curated',
    notes: row.notes || null,
  }
}

async function main() {
  const file = resolve(curatedPath)
  const rows = JSON.parse(await readFile(file, 'utf8'))
  const restaurants = rows.map(normalizeRestaurant)

  const { error } = await supabase
    .from('restaurants')
    .upsert(restaurants, { onConflict: 'denue_id' })

  if (error) throw new Error(`Supabase upsert: ${error.message}`)

  const { data, error: readError } = await supabase
    .from('restaurants')
    .select('id, denue_id, nombre, colonia, alcaldia, sitio_web, latitud, longitud, source')
    .in('denue_id', restaurants.map(row => row.denue_id))
    .order('nombre')

  if (readError) throw new Error(`Supabase readback: ${readError.message}`)

  console.log(`Restaurants curated upserted: ${restaurants.length}`)
  console.table(data)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
