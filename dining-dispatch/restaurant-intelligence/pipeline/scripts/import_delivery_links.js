// Importe uniquement les liens delivery du crawl local vers restaurant_links.
// Source: data/processed/mvp_links_flat.json

import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { supabase } from './lib/supabase.js'

const INPUT = resolve('data/processed/mvp_links_flat.json')
const PROVIDERS = new Set(['rappi', 'ubereats', 'didi_food'])

const args = new Set(process.argv.slice(2))
const dry = args.has('--dry')

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value)
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    url.hash = ''
    let out = url.toString()
    if (out.endsWith('/')) out = out.slice(0, -1)
    return out
  } catch {
    return value
  }
}

async function loadRows() {
  const raw = JSON.parse(await readFile(INPUT, 'utf8'))
  const seen = new Map()

  for (const item of raw) {
    if (item.linkType !== 'delivery') continue
    if (!PROVIDERS.has(item.provider)) continue
    if (!item.restaurantId || !item.url) continue

    const row = {
      restaurant_id: item.restaurantId,
      url: item.url,
      normalized_url: normalizeUrl(item.url),
      host: item.host || hostFromUrl(item.url),
      source: 'website_crawl',
      link_type: 'delivery',
      provider: item.provider,
      status: 'candidate',
      title: item.anchorText || null,
      checked_at: item.discoveredAt || null,
    }

    seen.set(`${row.restaurant_id}::${row.normalized_url}`, row)
  }

  return [...seen.values()]
}

async function main() {
  const rows = await loadRows()
  const byProvider = rows.reduce((acc, row) => {
    acc[row.provider] = (acc[row.provider] || 0) + 1
    return acc
  }, {})

  console.log(`Delivery links: ${rows.length}`)
  console.log(`Providers: ${JSON.stringify(byProvider)}`)

  if (dry) {
    console.log('Dry run sample:')
    console.log(JSON.stringify(rows.slice(0, 3), null, 2))
    return
  }

  const { error } = await supabase
    .from('restaurant_links')
    .upsert(rows, { onConflict: 'restaurant_id,normalized_url' })

  if (error) throw error
  console.log(`Imported: ${rows.length}`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
