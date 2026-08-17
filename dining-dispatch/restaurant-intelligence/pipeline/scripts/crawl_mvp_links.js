// Crawl leger des sites MVP pour extraire liens utiles:
// menus, reservation, livraison, reseaux sociaux, pages review.
// Ecrit un export JSON local par defaut. Option --write-social pour enrichir
// instagram/facebook dans restaurants.

import { createClient } from '@supabase/supabase-js'
import { writeFile, mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import { isMvpZoneRestaurant } from './mvp_zone.js'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const args = new Set(process.argv.slice(2))
const writeSocial = args.has('--write-social')
const limit = Number(getArg('limit', 325))
const offset = Number(getArg('offset', 0))
const timeoutMs = Number(getArg('timeout', 12000))
const outputPath = getArg('output', 'data/mvp_discovered_links.json')

const PROVIDERS = [
  { provider: 'opentable', linkType: 'reservation', hosts: ['opentable.com', 'opentable.com.mx'] },
  { provider: 'ubereats', linkType: 'delivery', hosts: ['ubereats.com'] },
  { provider: 'rappi', linkType: 'delivery', hosts: ['rappi.com'] },
  { provider: 'didi_food', linkType: 'delivery', hosts: ['didi-food.com'] },
  { provider: 'tripadvisor', linkType: 'review', hosts: ['tripadvisor.com', 'tripadvisor.com.mx'] },
  { provider: 'instagram', linkType: 'social', hosts: ['instagram.com'] },
  { provider: 'facebook', linkType: 'social', hosts: ['facebook.com', 'm.facebook.com'] },
  { provider: 'tiktok', linkType: 'social', hosts: ['tiktok.com'] },
  { provider: 'youtube', linkType: 'social', hosts: ['youtube.com', 'youtu.be'] },
  { provider: 'whatsapp', linkType: 'contact', hosts: ['wa.me', 'api.whatsapp.com'] },
]

const MENU_KEYWORDS = [
  'menu',
  'menú',
  'carta',
  'cartas',
  'comida',
  'food',
  'bebidas',
  'drinks',
  'brunch',
  'desayuno',
  'qrco.de',
]

function getArg(name, fallback) {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`))
  return raw ? raw.split('=').slice(1).join('=') : fallback
}

function normalizeUrl(rawUrl, baseUrl = null) {
  if (!rawUrl) return null
  const trimmed = String(rawUrl).trim()
  if (!trimmed || trimmed.startsWith('#')) return null

  try {
    const url = baseUrl
      ? new URL(trimmed, baseUrl)
      : new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)

    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.hash = ''
    if (url.pathname === '/') url.pathname = ''
    return url
  } catch {
    return null
  }
}

function hostWithoutWww(hostname) {
  return String(hostname || '').replace(/^www\./i, '').toLowerCase()
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function classifyUrl(url, anchorText = '') {
  const host = hostWithoutWww(url.hostname)
  const provider = PROVIDERS.find(item =>
    item.hosts.some(providerHost => host === providerHost || host.endsWith(`.${providerHost}`))
  )

  if (provider) {
    return { linkType: provider.linkType, provider: provider.provider }
  }

  const haystack = `${url.href} ${anchorText}`.toLowerCase()
  if (MENU_KEYWORDS.some(keyword => haystack.includes(keyword))) {
    return { linkType: 'menu', provider: 'website' }
  }

  return { linkType: 'other', provider: 'website' }
}

function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return stripHtml(match?.[1] || '').slice(0, 240) || null
}

function extractAnchors(html, baseUrl) {
  const links = new Map()
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

  let match
  while ((match = anchorRegex.exec(html)) !== null) {
    const url = normalizeUrl(match[1], baseUrl)
    if (!url) continue

    const anchorText = stripHtml(match[2])
    const classified = classifyUrl(url, anchorText)
    if (classified.linkType === 'other') continue

    const key = url.href
    if (!links.has(key)) {
      links.set(key, {
        url: key,
        host: hostWithoutWww(url.hostname),
        anchorText,
        ...classified,
      })
    }
  }

  return [...links.values()]
}

async function fetchHtml(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url.href, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'cdmx-restaurants-link-crawler/1.0',
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    const contentType = res.headers.get('content-type') || ''
    if (!res.ok || !contentType.toLowerCase().includes('text/html')) {
      return {
        ok: false,
        status: res.status,
        finalUrl: res.url,
        contentType,
        html: '',
      }
    }

    return {
      ok: true,
      status: res.status,
      finalUrl: res.url,
      contentType,
      html: await res.text(),
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchMvpRestaurants() {
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, nombre, colonia, alcaldia, sitio_web, instagram, facebook')
    .in('alcaldia', ['Cuauhtémoc', 'Cuauhtemoc'])
    .not('sitio_web', 'is', null)
    .order('nombre')
    .limit(Math.max((limit + offset) * 20, 500))

  if (error) throw new Error(`Supabase restaurants: ${error.message}`)

  return (data || [])
    .filter(isMvpZoneRestaurant)
    .slice(offset)
    .slice(0, limit)
}

async function updateSocialColumns(restaurant, links) {
  const patch = {}
  const instagram = links.find(link => link.provider === 'instagram')?.url
  const facebook = links.find(link => link.provider === 'facebook')?.url

  if (!restaurant.instagram && instagram) patch.instagram = instagram
  if (!restaurant.facebook && facebook) patch.facebook = facebook
  if (Object.keys(patch).length === 0) return false

  const { error } = await supabase
    .from('restaurants')
    .update(patch)
    .eq('id', restaurant.id)

  if (error) throw new Error(`Supabase social update: ${error.message}`)
  return true
}

function summarizeLinks(links) {
  const counts = {}
  for (const link of links) {
    counts[link.linkType] = (counts[link.linkType] || 0) + 1
  }
  return counts
}

async function main() {
  console.log(`Crawl MVP links | limite: ${limit} | offset: ${offset}${writeSocial ? ' | write-social' : ''}`)

  const restaurants = await fetchMvpRestaurants()
  const output = []
  let failed = 0
  let socialUpdates = 0

  for (const restaurant of restaurants) {
    const website = normalizeUrl(restaurant.sitio_web)
    if (!website) continue

    try {
      const response = await fetchHtml(website)
      if (!response.ok) {
        failed++
        output.push({
          restaurantId: restaurant.id,
          name: restaurant.nombre,
          website: website.href,
          status: 'failed',
          httpStatus: response.status,
          finalUrl: response.finalUrl,
          contentType: response.contentType,
          links: [],
        })
        console.log(`[skip] ${restaurant.nombre} | HTTP ${response.status} | ${website.href}`)
        continue
      }

      const links = extractAnchors(response.html, response.finalUrl)
      const summary = summarizeLinks(links)
      console.log(`[ok] ${restaurant.nombre} | ${links.length} lien(s) | ${JSON.stringify(summary)}`)

      if (writeSocial && await updateSocialColumns(restaurant, links)) {
        socialUpdates++
      }

      output.push({
        restaurantId: restaurant.id,
        name: restaurant.nombre,
        colonia: restaurant.colonia,
        website: website.href,
        status: 'ok',
        httpStatus: response.status,
        finalUrl: response.finalUrl,
        title: extractTitle(response.html),
        discoveredAt: new Date().toISOString(),
        links,
      })
    } catch (error) {
      failed++
      output.push({
        restaurantId: restaurant.id,
        name: restaurant.nombre,
        website: website.href,
        status: 'error',
        error: error.message,
        links: [],
      })
      console.log(`[error] ${restaurant.nombre} | ${website.href} | ${error.message}`)
    }
  }

  const absoluteOutput = resolve(outputPath)
  await mkdir(dirname(absoluteOutput), { recursive: true })
  await writeFile(absoluteOutput, `${JSON.stringify(output, null, 2)}\n`)

  const totals = output.flatMap(item => item.links || []).reduce((acc, link) => {
    acc[link.linkType] = (acc[link.linkType] || 0) + 1
    return acc
  }, {})

  console.log('\nTermine.')
  console.log(`Restaurants crawles: ${restaurants.length}`)
  console.log(`Sites en erreur: ${failed}`)
  console.log(`Social updates: ${socialUpdates}`)
  console.log(`Liens trouves: ${JSON.stringify(totals)}`)
  console.log(`Export: ${absoluteOutput}`)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
