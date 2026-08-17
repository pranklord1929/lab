// Audit supply-side delivery coverage on the premium pool.
// Signals:
// - restaurant_identities from scraped sources (Rappi now, Uber/Didi later)
// - restaurant_links in DB
// - local crawled links export data/processed/mvp_links_flat.json

import { readFile, mkdir, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { supabase } from './lib/supabase.js'
import { fetchPool } from './lib/pool.js'

const OUT = resolve('data/processed/delivery_coverage.json')
const LINKS_FLAT = resolve('data/processed/mvp_links_flat.json')
const PROVIDERS = ['rappi', 'ubereats', 'didi_food']

async function fetchAll(table, select, buildQuery = q => q) {
  const PAGE = 1000
  let rows = []
  let from = 0
  while (true) {
    const query = buildQuery(supabase.from(table).select(select).range(from, from + PAGE - 1))
    const { data, error } = await query
    if (error) throw error
    if (!data?.length) break
    rows = rows.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return rows
}

function addSignal(map, restaurantId, provider, signal) {
  if (!restaurantId || !PROVIDERS.includes(provider)) return
  if (!map.has(restaurantId)) {
    map.set(restaurantId, Object.fromEntries(PROVIDERS.map(p => [p, []])))
  }
  map.get(restaurantId)[provider].push(signal)
}

async function loadLocalLinks() {
  try {
    return JSON.parse(await readFile(LINKS_FLAT, 'utf8'))
  } catch {
    return []
  }
}

function summarizeRestaurant(row, signals) {
  const providers = PROVIDERS.filter(p => signals[p]?.length)
  return {
    restaurantId: row.id,
    name: row.nombre,
    alcaldia: row.alcaldia,
    colonia: row.colonia,
    website: row.sitio_web,
    providers,
    deliveryCoverageCount: providers.length,
    hasRappi: providers.includes('rappi'),
    hasUberEats: providers.includes('ubereats'),
    hasDidiFood: providers.includes('didi_food'),
    signals,
  }
}

async function main() {
  const pool = await fetchPool()
  const poolIds = new Set(pool.map(r => r.id))
  const signalMap = new Map()

  const identities = await fetchAll(
    'restaurant_identities',
    'restaurant_id, source, source_id, source_url, confidence, match_method',
    q => q.in('source', PROVIDERS),
  )
  for (const row of identities) {
    addSignal(signalMap, row.restaurant_id, row.source, {
      type: 'identity',
      sourceId: row.source_id,
      url: row.source_url,
      confidence: row.confidence,
      method: row.match_method,
    })
  }

  const dbLinks = await fetchAll(
    'restaurant_links',
    'restaurant_id, url, provider, link_type, status, confidence_score',
    q => q.eq('link_type', 'delivery').in('provider', PROVIDERS),
  )
  for (const row of dbLinks) {
    addSignal(signalMap, row.restaurant_id, row.provider, {
      type: 'restaurant_link',
      url: row.url,
      status: row.status,
      confidence: row.confidence_score,
    })
  }

  const localLinks = await loadLocalLinks()
  for (const row of localLinks) {
    if (row.linkType !== 'delivery') continue
    addSignal(signalMap, row.restaurantId, row.provider, {
      type: 'local_crawl',
      url: row.url,
      anchorText: row.anchorText,
      discoveredAt: row.discoveredAt,
    })
  }

  const rows = pool
    .map(r => summarizeRestaurant(r, signalMap.get(r.id) || Object.fromEntries(PROVIDERS.map(p => [p, []]))))
    .filter(r => r.deliveryCoverageCount > 0)
    .sort((a, b) => b.deliveryCoverageCount - a.deliveryCoverageCount || a.name.localeCompare(b.name))

  const stats = {
    poolTotal: pool.length,
    withAnyDelivery: rows.length,
    withAnyDeliveryPct: Number((rows.length / pool.length * 100).toFixed(1)),
    byProvider: Object.fromEntries(PROVIDERS.map(provider => [
      provider,
      rows.filter(r => r.providers.includes(provider)).length,
    ])),
    byCoverageCount: {
      three: rows.filter(r => r.deliveryCoverageCount === 3).length,
      two: rows.filter(r => r.deliveryCoverageCount === 2).length,
      one: rows.filter(r => r.deliveryCoverageCount === 1).length,
    },
  }

  const output = {
    generatedAt: new Date().toISOString(),
    providers: PROVIDERS,
    stats,
    topOverlap: rows.filter(r => r.deliveryCoverageCount >= 2).slice(0, 100),
    all: rows,
  }

  await mkdir(dirname(OUT), { recursive: true })
  await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`)

  console.log('Delivery coverage audit')
  console.log(`Pool: ${stats.poolTotal}`)
  console.log(`Any delivery: ${stats.withAnyDelivery} (${stats.withAnyDeliveryPct}%)`)
  console.log(`Providers: ${JSON.stringify(stats.byProvider)}`)
  console.log(`Overlap: ${JSON.stringify(stats.byCoverageCount)}`)
  console.log(`Output: ${OUT}`)
  console.log('\nTop overlap:')
  for (const row of output.topOverlap.slice(0, 15)) {
    console.log(`  ${row.name} | ${row.providers.join(', ')}`)
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
