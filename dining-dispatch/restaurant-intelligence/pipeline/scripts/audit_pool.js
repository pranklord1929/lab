// Status check de la pool premium (les ~3000 candidats pour les 500 cibles).
// Lis seulement, n'écrit rien. À lancer souvent pour voir où on en est.

import { supabase } from './lib/supabase.js'
import { poolStats, PREMIUM_ALCALDIAS, PREMIUM_ESTRATOS } from './lib/pool.js'

async function main() {
  console.log('═══ POOL PREMIUM ═══')
  console.log(`  alcaldías  : ${PREMIUM_ALCALDIAS.join(', ')}`)
  console.log(`  estratos   : ${PREMIUM_ESTRATOS.join(', ')}`)
  console.log('')

  const stats = await poolStats()
  console.log(`Total pool       : ${stats.total}`)
  console.log(`  avec site web  : ${stats.with_sitio_web}     (${pct(stats.with_sitio_web, stats.total)})`)
  console.log(`  avec IG        : ${stats.with_instagram}     (${pct(stats.with_instagram, stats.total)})`)
  console.log(`  avec téléphone : ${stats.with_telefono}     (${pct(stats.with_telefono, stats.total)})`)
  console.log(`  avec horaires  : ${stats.with_horaires}     (${pct(stats.with_horaires, stats.total)})`)
  console.log(`  Google verified: ${stats.with_google_place_id}     (${pct(stats.with_google_place_id, stats.total)})`)

  // Couverture sources externes via restaurant_identities
  console.log('\n═══ IDENTITIES par source ═══')
  const { data: ids } = await supabase
    .from('restaurant_identities')
    .select('source, restaurant_id')
  const counts = {}
  for (const r of (ids || [])) counts[r.source] = (counts[r.source] || 0) + 1
  for (const [s, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(20)} : ${n}`)
  }

  // Source records staging
  console.log('\n═══ SOURCE_RECORDS staging ═══')
  const { data: srStats } = await supabase
    .from('source_records')
    .select('source, processed_at, match_method')
  const bySource = {}
  for (const r of (srStats || [])) {
    if (!bySource[r.source]) bySource[r.source] = { total: 0, processed: 0, methods: {} }
    bySource[r.source].total++
    if (r.processed_at) bySource[r.source].processed++
    if (r.match_method) bySource[r.source].methods[r.match_method] = (bySource[r.source].methods[r.match_method] || 0) + 1
  }
  for (const [s, v] of Object.entries(bySource).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${s.padEnd(20)} : ${v.processed}/${v.total} processed   ${JSON.stringify(v.methods)}`)
  }

  // Links + menus
  console.log('\n═══ ENRICHMENT ═══')
  const { count: links } = await supabase.from('restaurant_links').select('*', { count: 'exact', head: true })
  const { count: linksMenu } = await supabase.from('restaurant_links').select('*', { count: 'exact', head: true }).eq('link_type', 'menu')
  const { count: linksSocial } = await supabase.from('restaurant_links').select('*', { count: 'exact', head: true }).eq('link_type', 'social')
  const { count: menus } = await supabase.from('menu_documents').select('*', { count: 'exact', head: true })
  const { count: menuItems } = await supabase.from('menu_items').select('*', { count: 'exact', head: true })
  console.log(`  restaurant_links total : ${links}    (menu ${linksMenu}, social ${linksSocial})`)
  console.log(`  menu_documents         : ${menus}`)
  console.log(`  menu_items structurés  : ${menuItems}`)

  // Gaps actionnables
  console.log('\n═══ GAPS à enrichir prochainement ═══')
  const gaps = [
    ['sitio_web', 'website'],
    ['instagram', 'instagram'],
    ['telefono', 'phone'],
    ['horaires', 'hours'],
    ['google_place_id', 'google_place'],
  ]
  for (const [col, label] of gaps) {
    const missing = stats.total - (stats[`with_${col}`] || 0)
    console.log(`  manque ${label.padEnd(15)} : ${missing} restos`)
  }
}

const pct = (a, b) => b ? (Math.round((a / b) * 1000) / 10) + '%' : '0%'

main().catch(e => { console.error(e); process.exit(1) })
