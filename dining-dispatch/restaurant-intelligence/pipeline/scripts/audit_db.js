import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function count(label, applyFilter = query => query) {
  const query = applyFilter(
    supabase.from('restaurants').select('id', { count: 'exact', head: true })
  )
  const { count: value, error } = await query
  if (error) throw new Error(`${label}: ${error.message}`)
  return { label, value }
}

function pct(value, total) {
  return total ? `${((value / total) * 100).toFixed(1)}%` : '0.0%'
}

async function main() {
  const metrics = await Promise.all([
    count('Restaurants total'),
    count('Avec GPS', query => query.not('latitud', 'is', null).not('longitud', 'is', null)),
    count('Avec telephone', query => query.not('telefono', 'is', null)),
    count('Avec site web', query => query.not('sitio_web', 'is', null)),
    count('Avec OSM id', query => query.not('osm_id', 'is', null)),
    count('Avec type cuisine', query => query.not('cuisine_type', 'is', null)),
    count('Avec horaires', query => query.not('horaires', 'is', null)),
    count('Verifies Google', query => query.not('google_place_id', 'is', null)),
  ])

  const total = metrics[0].value

  console.log('\nAudit restaurants CDMX')
  console.table(
    metrics.map(metric => ({
      donnee: metric.label,
      chiffre: metric.value,
      couverture: metric.label === 'Restaurants total' ? '100.0%' : pct(metric.value, total),
    }))
  )
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
