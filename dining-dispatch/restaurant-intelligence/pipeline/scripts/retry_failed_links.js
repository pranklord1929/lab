// Deuxieme passe sur les sites MVP echoues au crawl initial.
// Essaie des variantes http/https + www/sans-www avec un user-agent navigateur,
// puis produit un export retry et un export fusionne.

import { createClient } from '@supabase/supabase-js'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const args = new Set(process.argv.slice(2))
const inputPath = getArg('input', 'data/mvp_discovered_links.json')
const outputPath = getArg('output', 'data/mvp_discovered_links_retry.json')
const mergedPath = getArg('merged', 'data/mvp_discovered_links_merged.json')
const limit = Number(getArg('limit', 200))
const timeoutMs = Number(getArg('timeout', 15000))
const writeSocial = args.has('--write-social')

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

function buildUrlVariants(rawUrl) {
  const original = normalizeUrl(rawUrl)
  if (!original) return []

  const variants = new Map()
  const hosts = new Set([original.hostname])
  const noWww = original.hostname.replace(/^www\./i, '')

  hosts.add(noWww)
  hosts.add(`www.${noWww}`)

  for (const protocol of ['https:', 'http:']) {
    for (const host of hosts) {
      const url = new URL(original.href)
      url.protocol = protocol
      url.hostname = host
      variants.set(url.href, url)
    }
  }

  variants.set(original.href, original)
  return [...variants.values()]
}

function classifyUrl(url, anchorText = '') {
  const host = hostWithoutWww(url.hostname)
  const provider = PROVIDERS.find(item =>
    item.hosts.some(providerHost => host === providerHost || host.endsWith(`.${providerHost}`))
  )

  if (provider) return { linkType: provider.linkType, provider: provider.provider }

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
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.7',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
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

function summarizeLinks(links) {
  const counts = {}
  for (const link of links) counts[link.linkType] = (counts[link.linkType] || 0) + 1
  return counts
}

async function updateSocialColumns(item, links) {
  if (!item.restaurantId) return false

  const instagram = links.find(link => link.provider === 'instagram')?.url
  const facebook = links.find(link => link.provider === 'facebook')?.url
  if (!instagram && !facebook) return false

  const { data, error: readError } = await supabase
    .from('restaurants')
    .select('instagram, facebook')
    .eq('id', item.restaurantId)
    .single()

  if (readError) throw new Error(`Supabase restaurant read: ${readError.message}`)

  const patch = {}
  if (!data.instagram && instagram) patch.instagram = instagram
  if (!data.facebook && facebook) patch.facebook = facebook
  if (Object.keys(patch).length === 0) return false

  const { error } = await supabase
    .from('restaurants')
    .update(patch)
    .eq('id', item.restaurantId)

  if (error) throw new Error(`Supabase social update: ${error.message}`)
  return true
}

async function writeJson(path, data) {
  const absolutePath = resolve(path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(data, null, 2)}\n`)
  return absolutePath
}

async function retryItem(item) {
  const attempts = []

  for (const candidate of buildUrlVariants(item.website)) {
    try {
      const response = await fetchHtml(candidate)
      attempts.push({
        url: candidate.href,
        status: response.status,
        ok: response.ok,
        finalUrl: response.finalUrl,
        contentType: response.contentType,
      })

      if (!response.ok) continue

      const links = extractAnchors(response.html, response.finalUrl)
      return {
        ...item,
        status: 'ok',
        recovered: true,
        recoveredFrom: candidate.href,
        httpStatus: response.status,
        finalUrl: response.finalUrl,
        title: extractTitle(response.html),
        retriedAt: new Date().toISOString(),
        attempts,
        links,
      }
    } catch (error) {
      attempts.push({
        url: candidate.href,
        status: null,
        ok: false,
        error: error.message,
      })
    }
  }

  return {
    ...item,
    status: 'failed',
    recovered: false,
    retriedAt: new Date().toISOString(),
    attempts,
    links: [],
  }
}

async function main() {
  const original = JSON.parse(await readFile(inputPath, 'utf8'))
  const failed = original
    .filter(item => item.status !== 'ok')
    .slice(0, limit)

  console.log(`Retry liens MVP | input: ${inputPath} | sites echoues: ${failed.length}`)

  const retried = []
  let recovered = 0
  let socialUpdates = 0

  for (const item of failed) {
    const result = await retryItem(item)
    retried.push(result)

    if (result.recovered) {
      recovered++
      const summary = summarizeLinks(result.links)
      console.log(`[recovered] ${item.name} | ${result.recoveredFrom} | ${result.links.length} lien(s) | ${JSON.stringify(summary)}`)

      if (writeSocial && await updateSocialColumns(item, result.links)) {
        socialUpdates++
      }
    } else {
      console.log(`[failed] ${item.name} | ${item.website}`)
    }
  }

  const retriedById = new Map(retried.map(item => [item.restaurantId || item.website, item]))
  const merged = original.map(item => {
    const key = item.restaurantId || item.website
    const retry = retriedById.get(key)
    return retry?.recovered ? retry : item
  })

  const retryOutput = await writeJson(outputPath, retried)
  const mergedOutput = await writeJson(mergedPath, merged)
  const links = merged.flatMap(item => item.links || [])
  const totals = links.reduce((acc, link) => {
    acc[link.linkType] = (acc[link.linkType] || 0) + 1
    return acc
  }, {})

  console.log('\nTermine.')
  console.log(`Sites retentes: ${failed.length}`)
  console.log(`Sites recuperes: ${recovered}`)
  console.log(`Social updates: ${socialUpdates}`)
  console.log(`Liens fusionnes: ${JSON.stringify(totals)}`)
  console.log(`Export retry: ${retryOutput}`)
  console.log(`Export fusionne: ${mergedOutput}`)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
