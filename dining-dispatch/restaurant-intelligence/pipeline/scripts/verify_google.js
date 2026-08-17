// Verification "encore ouvert" via Google Places API
// Utilise uniquement le credit gratuit ($200/mois)
// Ne traiter que les restaurants avec statut = 'incertain'

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY
const DELAY_MS = 200  // 5 requetes/seconde max pour rester dans le quota gratuit

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function verifyBatch(limit = 100) {
  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, nombre, nom_vialidad, numero_exterior, colonia, alcaldia')
    .eq('statut', 'incertain')
    .is('google_place_id', null)
    .limit(limit)

  if (error) {
    console.error('Erreur lecture :', error.message)
    return
  }

  console.log(`${restaurants.length} restaurants a verifier`)

  for (const r of restaurants) {
    const query = `${r.nombre} ${r.nom_vialidad || ''} ${r.colonia || ''} ${r.alcaldia || ''} Mexico City`
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,business_status&key=${GOOGLE_API_KEY}`

    try {
      const res = await fetch(url)
      const json = await res.json()
      const candidate = json.candidates?.[0]

      const update = {
        verified_at: new Date().toISOString(),
        google_place_id: candidate?.place_id || null,
        verified_open: candidate?.business_status === 'OPERATIONAL',
        statut: candidate
          ? (candidate.business_status === 'OPERATIONAL' ? 'actif' : 'ferme')
          : 'incertain',
      }

      await supabase.from('restaurants').update(update).eq('id', r.id)
      process.stdout.write('.')
    } catch (err) {
      console.error(`\nErreur pour ${r.nombre} :`, err.message)
    }

    await sleep(DELAY_MS)
  }

  console.log('\nVerification terminee.')
}

const limit = parseInt(process.argv[2]) || 100
verifyBatch(limit)
