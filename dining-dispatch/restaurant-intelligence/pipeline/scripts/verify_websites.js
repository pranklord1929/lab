// Verifie les liens existants pour la zone MVP Roma Norte + Condesa.
// Par defaut: dry-run. Utiliser --write apres avoir cree restaurant_links.

import { createClient } from '@supabase/supabase-js'
import { isMvpZoneRestaurant, MVP_ZONE } from './mvp_zone.js'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const limit = Number(getArg('limit', 50))
const offset = Number(getArg('offset', 0))
const timeoutMs = Number(getArg('timeout', 12000))

const SOCIAL_HOSTS = ['instagram.com', 'facebook.com', 'tiktok.com', 'x.com', 'twitter.com', 'youtube.com']
const BAD_HOST_PARTS = ['instsgram', 'gmail.com', 'hotmail.com', 'outlook.com']
const THIRD_PARTY_HOSTS = [
  'opentable.com',
  'opentable.com.mx',
  'tripadvisor.com',
  'tripadvisor.com.mx',
  'ubereats.com',
  'rappi.com',
  'didi-food.com',
]
const PROVIDERS = [
  { provider: 'opentable', type: 'reservation', hosts: ['opentable.com', 'opentable.com.mx'] },
  { provider: 'tripadvisor', type: 'review', hosts: ['tripadvisor.com', 'tripadvisor.com.mx'] },
  { provider: 'ubereats', type: 'delivery', hosts: ['ubereats.com'] },
  { provider: 'rappi', type: 'delivery', hosts: ['rappi.com'] },
  { provider: 'didi_food', type: 'delivery', hosts: ['didi-food.com'] },
  { provider: 'instagram', type: 'social', hosts: ['instagram.com'] },
  { provider: 'facebook', type: 'social', hosts: ['facebook.com'] },
  { provider: 'tiktok', type: 'social', hosts: ['tiktok.com'] },
  { provider: 'youtube', type: 'social', hosts: ['youtube.com'] },
]
const PARKED_SIGNALS = [
  'hugedomains',
  'domain is for sale',
  'is for sale',
  'buy this domain',
  'sedo domain parking',
  'parkingcrew',
]

function getArg(name, fallback) {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`))
  return raw ? raw.split('=').slice(1).join('=') : fallback
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) return null
  const trimmed = String(rawUrl).trim()
  if (!trimmed) return null
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(withProtocol)
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

function isSocialHost(host) {
  return SOCIAL_HOSTS.some(socialHost => host === socialHost || host.endsWith(`.${socialHost}`))
}

function isClearlyBadHost(host) {
  return BAD_HOST_PARTS.some(part => host.includes(part)) || host.includes('_')
}

function isThirdPartyHost(host) {
  return THIRD_PARTY_HOSTS.some(thirdPartyHost => host === thirdPartyHost || host.endsWith(`.${thirdPartyHost}`))
}

function classifyLink(host) {
  const providerMatch = PROVIDERS.find(provider =>
    provider.hosts.some(providerHost => host === providerHost || host.endsWith(`.${providerHost}`))
  )

  if (providerMatch) {
    return {
      linkType: providerMatch.type,
      provider: providerMatch.provider,
    }
  }

  if (isSocialHost(host)) {
    return {
      linkType: 'social',
      provider: host.split('.').at(-2) || 'social',
    }
  }

  return {
    linkType: 'official_site',
    provider: 'website',
  }
}

function isParkedPage(host, title) {
  const haystack = `${host} ${title || ''}`.toLowerCase()
  return PARKED_SIGNALS.some(signal => haystack.includes(signal))
}

function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match?.[1]
    ?.replace(/\s+/g, ' ')
    .replace(/&amp;/gi, '&')
    .trim()
    .slice(0, 240) || null
}

function scoreWebsite({ restaurant, inputUrl, finalUrl, status, contentType, title }) {
  const inputHost = hostWithoutWww(inputUrl.hostname)
  const finalHost = finalUrl ? hostWithoutWww(finalUrl.hostname) : inputHost
  let score = 0.35

  if (status >= 200 && status < 400) score += 0.25
  if (contentType?.toLowerCase().includes('text/html')) score += 0.12
  if (finalHost === inputHost) score += 0.08
  if (title) score += 0.08

  const nameTokens = String(restaurant.nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 3 && !['restaurante', 'restaurant', 'cafe', 'bar'].includes(token))

  const haystack = `${finalHost} ${title || ''}`.toLowerCase()
  if (nameTokens.some(token => haystack.includes(token))) score += 0.12

  if (isSocialHost(finalHost)) score -= 0.18
  if (isThirdPartyHost(finalHost)) score -= 0.28
  if (isParkedPage(finalHost, title)) score -= 0.65
  if (isClearlyBadHost(finalHost)) score -= 0.4

  return Math.max(0, Math.min(1, Number(score.toFixed(3))))
}

function classifyResult({ httpStatus, finalHost, title }) {
  if (isParkedPage(finalHost, title)) return 'parked'
  if (httpStatus >= 200 && httpStatus < 400) return 'valid'
  return 'invalid'
}

async function fetchWebsite(inputUrl) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(inputUrl.href, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'cdmx-restaurants-website-verifier/1.0',
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    const contentType = res.headers.get('content-type') || ''
    const text = contentType.toLowerCase().includes('text/html') ? await res.text() : ''

    return {
      ok: true,
      status: res.status,
      finalUrl: new URL(res.url),
      contentType,
      title: extractTitle(text),
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchMvpRestaurants() {
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, nombre, colonia, alcaldia, sitio_web')
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

async function writeResult(restaurant, inputUrl, result) {
  const finalHost = result.finalUrl ? hostWithoutWww(result.finalUrl.hostname) : hostWithoutWww(inputUrl.hostname)
  const status = result.statusLabel
  const link = classifyLink(finalHost)

  const row = {
    restaurant_id: restaurant.id,
    url: inputUrl.href,
    normalized_url: inputUrl.href,
    host: hostWithoutWww(inputUrl.hostname),
    source: 'denue',
    link_type: link.linkType,
    provider: link.provider,
    status,
    confidence_score: result.confidence,
    http_status: result.httpStatus || null,
    final_url: result.finalUrl?.href || null,
    final_host: finalHost,
    content_type: result.contentType || null,
    title: result.title || null,
    checked_at: new Date().toISOString(),
    error_message: result.error || null,
  }

  const { error } = await supabase
    .from('restaurant_links')
    .upsert(row, { onConflict: 'restaurant_id,normalized_url' })

  if (error) throw new Error(`Supabase restaurant_links: ${error.message}`)
}

async function main() {
  console.log(`Mode: ${write ? 'ecriture Supabase' : 'dry-run'}`)
  console.log(`Zone: ${MVP_ZONE.name} | limite: ${limit} | offset: ${offset}`)

  const restaurants = await fetchMvpRestaurants()
  let valid = 0
  let invalid = 0
  let social = 0
  let reservation = 0
  let delivery = 0
  let review = 0

  for (const restaurant of restaurants) {
    const inputUrl = normalizeUrl(restaurant.sitio_web)
    if (!inputUrl) {
      invalid++
      console.log(`[invalid] ${restaurant.nombre} | ${restaurant.sitio_web}`)
      continue
    }

    const inputHost = hostWithoutWww(inputUrl.hostname)
    if (isSocialHost(inputHost)) {
      social++
      const link = classifyLink(inputHost)
      const result = {
        statusLabel: 'valid',
        confidence: 0.35,
        finalUrl: inputUrl,
      }
      console.log(`[${link.linkType}] ${restaurant.nombre} | ${inputUrl.href}`)
      if (write) await writeResult(restaurant, inputUrl, result)
      continue
    }

    if (isClearlyBadHost(inputHost)) {
      invalid++
      const result = {
        statusLabel: 'invalid',
        confidence: 0,
        finalUrl: inputUrl,
        error: 'Host invalide ou email deguise en site',
      }
      console.log(`[invalid] ${restaurant.nombre} | ${inputUrl.href}`)
      if (write) await writeResult(restaurant, inputUrl, result)
      continue
    }

    try {
      const response = await fetchWebsite(inputUrl)
      const confidence = scoreWebsite({
        restaurant,
        inputUrl,
        finalUrl: response.finalUrl,
        status: response.status,
        contentType: response.contentType,
        title: response.title,
      })
      const statusLabel = classifyResult({
        httpStatus: response.status,
        finalHost: hostWithoutWww(response.finalUrl.hostname),
        title: response.title,
      })
      const link = classifyLink(hostWithoutWww(response.finalUrl.hostname))

      if (statusLabel === 'valid') valid++
      else invalid++
      if (statusLabel === 'valid' && link.linkType === 'social') social++
      if (statusLabel === 'valid' && link.linkType === 'reservation') reservation++
      if (statusLabel === 'valid' && link.linkType === 'delivery') delivery++
      if (statusLabel === 'valid' && link.linkType === 'review') review++

      console.log(
        `[${statusLabel}/${link.linkType}] ${restaurant.nombre} | ${response.status} | score ${confidence} | ${response.finalUrl.href}${response.title ? ` | ${response.title}` : ''}`
      )

      if (write) {
        await writeResult(restaurant, inputUrl, {
          statusLabel,
          confidence,
          httpStatus: response.status,
          finalUrl: response.finalUrl,
          contentType: response.contentType,
          title: response.title,
        })
      }
    } catch (error) {
      invalid++
      console.log(`[timeout] ${restaurant.nombre} | ${inputUrl.href} | ${error.message}`)
      if (write) {
        await writeResult(restaurant, inputUrl, {
          statusLabel: 'timeout',
          confidence: 0,
          finalUrl: inputUrl,
          error: error.message,
        })
      }
    }
  }

  console.log('\nTermine.')
  console.log(`Restaurants verifies: ${restaurants.length}`)
  console.log(`Liens valides: ${valid}`)
  console.log(`Reservations: ${reservation}`)
  console.log(`Livraison: ${delivery}`)
  console.log(`Avis/reviews: ${review}`)
  console.log(`Sociaux: ${social}`)
  console.log(`Invalides/parked/timeouts: ${invalid}`)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
