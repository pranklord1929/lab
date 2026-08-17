// Decouvre les URLs de menus depuis les sites officiels des restaurants.
// Par defaut: dry-run. Utiliser --write pour ecrire dans menu_documents.

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const limit = Number(getArg('limit', 50))
const offset = Number(getArg('offset', 0))
const alcaldia = getArg('alcaldia', '')
const timeoutMs = Number(getArg('timeout', 12000))

const MENU_KEYWORDS = [
  'menu',
  'menú',
  'carta',
  'cartas',
  'food',
  'comida',
  'platillo',
  'platillos',
  'bebida',
  'bebidas',
  'wine',
  'vinos',
  'drinks',
  'desayuno',
  'brunch',
]

const BLOCKED_PROTOCOLS = new Set(['mailto:', 'tel:', 'sms:', 'whatsapp:'])
const BLOCKED_HOSTS = [
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'maps.google.',
  'goo.gl',
]

function getArg(name, fallback) {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`))
  return raw ? raw.split('=').slice(1).join('=') : fallback
}

function normalizeWebsite(rawUrl) {
  if (!rawUrl) return null
  const trimmed = String(rawUrl).trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
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

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function classifyDocument(url, contentType = '') {
  const pathname = url.pathname.toLowerCase()
  const type = contentType.toLowerCase()
  if (pathname.endsWith('.pdf') || type.includes('application/pdf')) return 'pdf'
  if (/\.(jpg|jpeg|png|webp)$/i.test(pathname) || type.startsWith('image/')) return 'image'
  if (type.includes('text/html') || !pathname.includes('.')) return 'html'
  return 'unknown'
}

function isBlockedUrl(url) {
  if (BLOCKED_PROTOCOLS.has(url.protocol)) return true
  const host = url.hostname.replace(/^www\./, '')
  return BLOCKED_HOSTS.some(blocked => host.includes(blocked))
}

function scoreCandidate(url, anchorText, baseHost) {
  const haystack = normalizeText(`${url.href} ${anchorText}`)
  let score = 0

  for (const keyword of MENU_KEYWORDS) {
    if (haystack.includes(normalizeText(keyword))) score += 0.16
  }

  if (url.pathname.toLowerCase().endsWith('.pdf')) score += 0.35
  if (url.hostname.replace(/^www\./, '') === baseHost) score += 0.18
  if (/\/(menu|menus|carta|food|comida|bebidas)(\/|$|-|_)/i.test(url.pathname)) score += 0.25

  return Math.min(score, 1)
}

function extractLinks(html, baseUrl) {
  const base = new URL(baseUrl)
  const baseHost = base.hostname.replace(/^www\./, '')
  const candidates = new Map()
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

  let match
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1]
    const anchorText = stripHtml(match[2])

    let url
    try {
      url = new URL(href, base)
    } catch {
      continue
    }

    if (!['http:', 'https:'].includes(url.protocol) || isBlockedUrl(url)) continue
    url.hash = ''

    const score = scoreCandidate(url, anchorText, baseHost)
    if (score < 0.28) continue

    const key = url.href
    const previous = candidates.get(key)
    if (!previous || previous.discovery_score < score) {
      candidates.set(key, {
        source_url: key,
        source_host: url.hostname,
        document_type: classifyDocument(url),
        discovery_score: Number(score.toFixed(3)),
        anchor_text: anchorText,
      })
    }
  }

  return [...candidates.values()].sort((a, b) => b.discovery_score - a.discovery_score)
}

async function fetchText(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'cdmx-restaurants-menu-discovery/1.0',
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    const contentType = res.headers.get('content-type') || ''
    if (!res.ok || !contentType.toLowerCase().includes('text/html')) {
      return { ok: false, status: res.status, contentType, text: '' }
    }

    return { ok: true, status: res.status, contentType, text: await res.text() }
  } finally {
    clearTimeout(timeout)
  }
}

async function loadRestaurants() {
  const queryLimit = alcaldia ? Math.max((limit + offset) * 20, 500) : limit + offset
  const query = supabase
    .from('restaurants')
    .select('id, nombre, sitio_web, alcaldia')
    .not('sitio_web', 'is', null)
    .order('nombre')
    .limit(queryLimit)

  const { data, error } = await query
  if (error) throw new Error(`Supabase restaurants: ${error.message}`)

  const rows = data || []
  if (!alcaldia) return rows.slice(offset).slice(0, limit)

  const wanted = normalizeText(alcaldia)
  return rows
    .filter(row => normalizeText(row.alcaldia).includes(wanted))
    .slice(offset)
    .slice(0, limit)
}

async function writeCandidates(restaurant, candidates) {
  if (candidates.length === 0) return

  const rows = candidates.map(candidate => ({
    restaurant_id: restaurant.id,
    source_url: candidate.source_url,
    source_host: candidate.source_host,
    document_type: candidate.document_type,
    discovery_score: candidate.discovery_score,
    status: 'discovered',
    last_checked_at: new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('menu_documents')
    .upsert(rows, { onConflict: 'restaurant_id,source_url' })

  if (error) throw new Error(`Supabase menu_documents: ${error.message}`)
}

async function main() {
  console.log(`Mode: ${write ? 'ecriture Supabase' : 'dry-run'}`)
  console.log(`Limite restaurants: ${limit} | offset: ${offset}${alcaldia ? ` | alcaldia: ${alcaldia}` : ''}`)

  const restaurants = await loadRestaurants()
  let discovered = 0
  let failed = 0

  for (const restaurant of restaurants) {
    const website = normalizeWebsite(restaurant.sitio_web)
    if (!website) continue

    try {
      const res = await fetchText(website)
      if (!res.ok) {
        failed++
        console.log(`[skip] ${restaurant.nombre} | ${website} | HTTP ${res.status} ${res.contentType}`)
        continue
      }

      const candidates = extractLinks(res.text, website).slice(0, 5)
      discovered += candidates.length

      if (candidates.length === 0) {
        console.log(`[none] ${restaurant.nombre} | ${website}`)
        continue
      }

      console.log(`[menu] ${restaurant.nombre} | ${candidates.length} candidat(s)`)
      for (const candidate of candidates) {
        console.log(`  ${candidate.document_type} ${candidate.discovery_score}: ${candidate.source_url}`)
      }

      if (write) await writeCandidates(restaurant, candidates)
    } catch (error) {
      failed++
      console.log(`[error] ${restaurant.nombre} | ${website} | ${error.message}`)
    }
  }

  console.log('\nTermine.')
  console.log(`Restaurants lus: ${restaurants.length}`)
  console.log(`Documents menus decouverts: ${discovered}`)
  console.log(`Sites en erreur/ignores: ${failed}`)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
