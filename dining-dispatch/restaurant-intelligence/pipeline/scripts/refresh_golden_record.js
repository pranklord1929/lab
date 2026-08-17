import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis')
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const started = Date.now()

const { error } = await supabase.rpc('refresh_restaurant_golden_record')
if (error?.code === 'PGRST202') {
  console.error('Golden record non déployé. Exécute scripts/sql/golden_record.sql dans le SQL Editor Supabase.')
  process.exit(1)
}
if (error) throw error

const [{ count: total, error: totalError }, { count: rich, error: richError }] = await Promise.all([
  supabase.from('restaurant_golden_record_mv').select('*', { count: 'exact', head: true }),
  supabase.from('restaurant_golden_record_mv').select('*', { count: 'exact', head: true }).gte('richness_score', 5),
])
if (totalError) throw totalError
if (richError) throw richError

console.log(`Golden record rafraîchi en ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`${total} restaurants, dont ${rich} avec richness_score >= 5/7`)
