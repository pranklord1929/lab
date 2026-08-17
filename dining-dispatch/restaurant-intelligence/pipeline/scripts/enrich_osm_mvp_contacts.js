// Complete sites, telephones, reseaux, cuisine et horaires depuis OSM
// pour les restaurants MVP deja relies par osm_id.
// Par defaut: dry-run. Utiliser --write pour appliquer.

import { createClient } from '@supabase/supabase-js'
import { isMvpZoneRestaurant } from './mvp_zone.js'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const force = args.has('--force')
const limit = Number(getArg('limit', 0))

const MVP_BBOX = {
  south: 19.3955,
  west: -99.1905,
  north: 19.4265,
  east: -99.155,
}

function getArg(name, fallback) {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`))
  return raw ? raw.split('=').slice(1).join('=') : fallback
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) return null
  const trimmed = String(rawUrl).trim()
  if (!trimmed) return null
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    url.hash = ''
    if (url.pathname === '/') url.pathname = ''
    return url.href
  } catch {
    return trimmed
  }
}

function osmWebsite(tags) {
  return normalizeUrl(tags.website || tags['contact:website'] || tags.url)
}

function osmInstagram(tags) {
  const raw = tags['contact:instagram'] || tags.instagram
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://www.instagram.com/${String(raw).replace(/^@/, '')}/`
}

function osmFacebook(tags) {
  const raw = tags['contact:facebook'] || tags.facebook
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) return raw
  return `https://www.facebook.com/${raw}`
}

async function fetchOSMPlaces() {
  const query = `
    [out:json][timeout:180];
    (
      node["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub)$"](${MVP_BBOX.south},${MVP_BBOX.west},${MVP_BBOX.north},${MVP_BBOX.east});
      way["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub)$"](${MVP_BBOX.south},${MVP_BBOX.west},${MVP_BBOX.north},${MVP_BBOX.east});
      relation["amenity"~"^(restaurant|cafe|fast_food|food_court|bar|pub)$"](${MVP_BBOX.south},${MVP_BBOX.west},${MVP_BBOX.north},${MVP_BBOX.east});
    );
    out center tags;
  `

  let lastError = null
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': 'cdmx-restaurants-osm-mvp-contact/1.0',
        },
      })

      if (!res.ok) {
        lastError = new Error(`Overpass ${url} HTTP ${res.status}: ${await res.text()}`)
        continue
      }

      const json = await res.json()
      return json.elements
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Overpass indisponible')
}

async function fetchMvpRestaurants() {
  const rows = []
  const pageSize = 1000

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('restaurants')
      .select('id, nombre, colonia, alcaldia, osm_id, sitio_web, telefono, correo_electronico, instagram, facebook, cuisine_type, horaires')
      .in('alcaldia', ['Cuauhtémoc', 'Cuauhtemoc'])
      .range(from, from + pageSize - 1)

    if (error) throw new Error(`Supabase restaurants: ${error.message}`)
    if (!data || data.length === 0) break

    rows.push(...data)
    if (data.length < pageSize) break
  }

  return rows.filter(row => isMvpZoneRestaurant(row) && row.osm_id)
}

function buildPatch(restaurant, tags) {
  const patch = {}
  const website = osmWebsite(tags)
  const instagram = osmInstagram(tags)
  const facebook = osmFacebook(tags)
  const phone = tags.phone || tags['contact:phone']
  const email = tags.email || tags['contact:email']

  if ((force || !restaurant.sitio_web) && website) patch.sitio_web = website
  if ((force || !restaurant.telefono) && phone) patch.telefono = phone
  if ((force || !restaurant.correo_electronico) && email) patch.correo_electronico = email
  if ((force || !restaurant.instagram) && instagram) patch.instagram = instagram
  if ((force || !restaurant.facebook) && facebook) patch.facebook = facebook
  if ((force || !restaurant.cuisine_type) && tags.cuisine) patch.cuisine_type = tags.cuisine
  if ((force || !restaurant.horaires) && tags.opening_hours) patch.horaires = tags.opening_hours

  return patch
}

async function applyPatch(id, patch) {
  const { error } = await supabase
    .from('restaurants')
    .update(patch)
    .eq('id', id)

  if (error) throw new Error(`Supabase update: ${error.message}`)
}

async function main() {
  console.log(`Mode: ${write ? 'ecriture Supabase' : 'dry-run'}${force ? ' | force overwrite' : ''}`)

  const [osmElements, restaurants] = await Promise.all([
    fetchOSMPlaces(),
    fetchMvpRestaurants(),
  ])

  const osmById = new Map(
    osmElements
      .map(element => [`${element.type}/${element.id}`, element.tags || {}])
  )

  const scoped = restaurants.slice(0, limit || undefined)
  let updated = 0
  let withWebsite = 0

  for (const restaurant of scoped) {
    const tags = osmById.get(restaurant.osm_id)
    if (!tags) continue

    const patch = buildPatch(restaurant, tags)
    const keys = Object.keys(patch)
    if (keys.length === 0) continue

    if (patch.sitio_web) withWebsite++
    updated++
    console.log(`[${write ? 'write' : 'dry-run'}] ${restaurant.nombre} | ${keys.join(', ')}${patch.sitio_web ? ` | ${patch.sitio_web}` : ''}`)

    if (write) await applyPatch(restaurant.id, patch)
  }

  console.log('\nTermine.')
  console.log(`Restaurants avec osm_id lus: ${scoped.length}`)
  console.log(`Restaurants enrichissables/enrichis: ${updated}`)
  console.log(`Sites web ajoutes/proposes: ${withWebsite}`)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
