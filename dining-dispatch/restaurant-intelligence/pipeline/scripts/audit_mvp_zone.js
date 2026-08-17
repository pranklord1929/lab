import { createClient } from '@supabase/supabase-js'
import { isMvpZoneRestaurant, MVP_ZONE, normalizeText } from './mvp_zone.js'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const PAGE_SIZE = 1000

function normalizeWebsite(rawUrl) {
  if (!rawUrl) return null
  const trimmed = String(rawUrl).trim()
  if (!trimmed) return null
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    return new URL(withProtocol)
  } catch {
    return null
  }
}

function classifyWebsite(rawUrl) {
  const url = normalizeWebsite(rawUrl)
  if (!url) return 'missing'

  const host = url.hostname.replace(/^www\./i, '').toLowerCase()
  if (host.includes('instagram.') || host.includes('facebook.') || host.includes('tiktok.')) return 'social'
  if (host.includes('instsgram') || host.includes('gmail.') || host.includes('_')) return 'invalid'
  return 'website'
}

function hasSocialProfile(restaurant) {
  return Boolean(
    String(restaurant.instagram || '').trim() ||
    String(restaurant.facebook || '').trim()
  )
}

async function fetchRestaurants() {
  const rows = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('restaurants')
      .select('id, nombre, colonia, alcaldia, sitio_web, telefono, instagram, facebook, osm_id, google_place_id')
      .in('alcaldia', ['Cuauhtémoc', 'Cuauhtemoc'])
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`Supabase restaurants: ${error.message}`)
    if (!data || data.length === 0) break

    rows.push(...data)
    if (data.length < PAGE_SIZE) break
  }

  return rows.filter(isMvpZoneRestaurant)
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1)
}

function printSamples(label, rows) {
  console.log(`\n${label}`)
  for (const row of rows.slice(0, 12)) {
    console.log(`- ${row.nombre} | ${row.colonia || 'sans colonia'} | ${row.sitio_web || 'sans site'}`)
  }
}

async function main() {
  const restaurants = await fetchRestaurants()
  const byColonia = new Map()
  const byWebsiteClass = new Map()
  const bySignal = new Map()

  for (const restaurant of restaurants) {
    increment(byColonia, normalizeText(restaurant.colonia) || 'SANS COLONIA')
    increment(byWebsiteClass, classifyWebsite(restaurant.sitio_web))
    if (hasSocialProfile(restaurant)) increment(bySignal, 'social_profile')
    if (restaurant.telefono) increment(bySignal, 'phone')
    if (restaurant.osm_id) increment(bySignal, 'osm_match')
  }

  const withWebsite = restaurants.filter(r => classifyWebsite(r.sitio_web) === 'website')
  const withSocial = restaurants.filter(r => classifyWebsite(r.sitio_web) === 'social')
  const invalid = restaurants.filter(r => classifyWebsite(r.sitio_web) === 'invalid')
  const missing = restaurants.filter(r => classifyWebsite(r.sitio_web) === 'missing')

  console.log(`\nAudit MVP zone: ${MVP_ZONE.name}`)
  console.log(`Colonias cible: ${MVP_ZONE.colonias.join(', ')}`)
  console.log(`Restaurants MVP: ${restaurants.length}`)
  console.table([...byColonia.entries()].map(([colonia, count]) => ({ colonia, restaurants: count })))
  console.table([...byWebsiteClass.entries()].map(([type, count]) => ({
    type,
    count,
    couverture: restaurants.length ? `${((count / restaurants.length) * 100).toFixed(1)}%` : '0.0%',
  })))
  console.table([...bySignal.entries()].map(([type, count]) => ({
    type,
    count,
    couverture: restaurants.length ? `${((count / restaurants.length) * 100).toFixed(1)}%` : '0.0%',
  })))

  printSamples('Exemples sans site', missing)
  printSamples('Exemples site social uniquement', withSocial)
  printSamples('Exemples site invalide', invalid)
  printSamples('Exemples site web a verifier', withWebsite)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
