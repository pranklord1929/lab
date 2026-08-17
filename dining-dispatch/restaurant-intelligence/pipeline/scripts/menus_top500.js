// Decouverte + extraction des menus pour le top 500.
// Remplace discover_menus.js + extract_menu_text.js (ecrits pour un ancien
// schema : colonnes status/document_type/http_status inexistantes en base).
//
// Pour chaque resto du top 500 (vue restaurant_score) avec un site web :
//   1. fetch la homepage, repere les liens menu (mots-cles + score)
//   2. fetch les meilleurs candidats (max 3), extrait le texte (HTML ou PDF)
//   3. upsert menu_documents avec le VRAI schema :
//      file_type, raw_text, confidence_score, extraction_method, statut
//
// Usage:
//   node scripts/menus_top500.js --dry --limit=10     → test sans ecrire
//   node scripts/menus_top500.js                      → run complet
//   node scripts/menus_top500.js --offset=100         → reprendre plus loin

import { createClient } from '@supabase/supabase-js'
import { PDFParse } from 'pdf-parse'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const getArg = (name, fallback) => {
  const raw = args.find(a => a.startsWith(`--${name}=`))
  return raw ? raw.split('=').slice(1).join('=') : fallback
}
const limit = Number(getArg('limit', 500))
const offset = Number(getArg('offset', 0))
const TIMEOUT_MS = 15000
const CONCURRENCY = 8
const MIN_TEXT_LENGTH = 120

const MENU_KEYWORDS = [
  'menu', 'menú', 'carta', 'cartas', 'food', 'comida', 'platillo', 'platillos',
  'bebida', 'bebidas', 'wine', 'vinos', 'drinks', 'desayuno', 'brunch',
]
const BLOCKED_HOSTS = [
  'facebook.com', 'instagram.com', 'tiktok.com', 'twitter.com', 'x.com',
  'youtube.com', 'maps.google.', 'goo.gl', 'wa.me', 'whatsapp.com',
]

const normalizeText = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

function cleanText(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function classifyFileType(url, contentType = '') {
  const pathname = url.pathname.toLowerCase()
  const type = contentType.toLowerCase()
  if (pathname.endsWith('.pdf') || type.includes('application/pdf')) return 'pdf'
  if (/\.(jpg|jpeg|png|webp)$/i.test(pathname) || type.startsWith('image/')) return 'image'
  if (type.includes('text/html') || !pathname.includes('.')) return 'html'
  return 'unknown'
}

function scoreCandidate(url, anchorText, baseHost) {
  const haystack = normalizeText(`${url.href} ${anchorText}`)
  let score = 0
  for (const kw of MENU_KEYWORDS) {
    if (haystack.includes(normalizeText(kw))) score += 0.16
  }
  if (url.pathname.toLowerCase().endsWith('.pdf')) score += 0.35
  if (url.hostname.replace(/^www\./, '') === baseHost) score += 0.18
  if (/\/(menu|menus|carta|food|comida|bebidas)(\/|$|-|_)/i.test(url.pathname)) score += 0.25
  return Math.min(score, 1)
}

function extractMenuLinks(html, baseUrl) {
  const base = new URL(baseUrl)
  const baseHost = base.hostname.replace(/^www\./, '')
  const candidates = new Map()
  const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi

  let match
  while ((match = anchorRegex.exec(html)) !== null) {
    let url
    try { url = new URL(match[1], base) } catch { continue }
    if (!['http:', 'https:'].includes(url.protocol)) continue
    const host = url.hostname.replace(/^www\./, '')
    if (BLOCKED_HOSTS.some(b => host.includes(b))) continue
    url.hash = ''

    const score = scoreCandidate(url, cleanText(match[2]), baseHost)
    if (score < 0.28) continue

    const prev = candidates.get(url.href)
    if (!prev || prev.score < score) {
      candidates.set(url.href, { url: url.href, score: Number(score.toFixed(3)) })
    }
  }
  return [...candidates.values()].sort((a, b) => b.score - a.score)
}

async function fetchUrl(url, accept) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: {
        Accept: accept,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) cdmx-menu-collector/1.0',
      },
      redirect: 'follow',
      signal: controller.signal,
    })
    const contentType = res.headers.get('content-type') || ''
    const buffer = Buffer.from(await res.arrayBuffer())
    return { ok: res.ok, status: res.status, contentType, buffer, finalUrl: res.url }
  } finally {
    clearTimeout(timer)
  }
}

async function extractDocText(buffer, fileType) {
  if (fileType === 'pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      const result = await parser.getText()
      return cleanText(result.text)
    } finally {
      await parser.destroy().catch(() => {})
    }
  }
  return cleanText(buffer.toString('utf8'))
}

async function loadTop500() {
  // La vue restaurant_score timeout via l'API REST → on lit l'export local
  // genere depuis la vue (data/exports/top_500_ids.json).
  const { readFile } = await import('fs/promises')
  const data = JSON.parse(await readFile('data/exports/top_500_ids.json', 'utf8'))

  const ids = (data || []).map(r => r.id)
  const sites = new Map()
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rows, error: e2 } = await supabase
      .from('restaurants')
      .select('id, sitio_web')
      .in('id', ids.slice(i, i + 200))
      .not('sitio_web', 'is', null)
    if (e2) throw new Error(`Supabase restaurants: ${e2.message}`)
    for (const row of rows || []) sites.set(row.id, row.sitio_web)
  }

  return (data || [])
    .filter(r => sites.has(r.id))
    .map(r => ({ ...r, sitio_web: sites.get(r.id) }))
}

async function alreadyExtracted() {
  const { data, error } = await supabase
    .from('menu_documents')
    .select('restaurant_id')
    .eq('statut', 'extracted')
  if (error) throw new Error(`Supabase menu_documents: ${error.message}`)
  return new Set((data || []).map(r => r.restaurant_id))
}

async function saveDocument(restaurantId, sourceUrl, fileType, rawText, score, statut, method) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase.from('menu_documents').upsert({
      restaurant_id: restaurantId,
      source_url: sourceUrl,
      file_type: fileType,
      raw_text: rawText,
      confidence_score: score,
      extraction_method: method,
      statut,
      last_checked_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id,source_url' })
    if (!error) return
    if (attempt === 3) console.log(`  upsert rate ${restaurantId}: ${error.message}`)
    else await new Promise(r => setTimeout(r, 2000 * attempt))
  }
}

async function processRestaurant(resto, counts) {
  const website = /^https?:\/\//i.test(resto.sitio_web) ? resto.sitio_web : `https://${resto.sitio_web}`

  let home
  try {
    home = await fetchUrl(website, 'text/html,application/xhtml+xml,*/*;q=0.8')
  } catch (e) {
    counts.site_mort++
    return
  }
  if (!home.ok || !home.contentType.toLowerCase().includes('text/html')) {
    counts.site_mort++
    return
  }

  const links = extractMenuLinks(home.buffer.toString('utf8'), home.finalUrl || website).slice(0, 3)
  if (links.length === 0) {
    counts.sans_candidat++
    return
  }

  let got = 0
  for (const link of links) {
    if (got >= 2) break
    let url
    try { url = new URL(link.url) } catch { continue }

    try {
      const res = await fetchUrl(link.url, 'application/pdf,text/html,*/*;q=0.8')
      const fileType = classifyFileType(url, res.contentType)
      if (!res.ok) {
        if (!dry) await saveDocument(resto.id, link.url, fileType, null, link.score, 'failed', null)
        continue
      }
      if (fileType === 'image' || fileType === 'unknown') continue

      const text = await extractDocText(res.buffer, fileType)
      const useful = text.length >= MIN_TEXT_LENGTH
      const method = fileType === 'pdf' ? 'pdf_parse' : 'website_crawl'

      if (!dry) {
        await saveDocument(resto.id, link.url, fileType, useful ? text.slice(0, 200000) : null, link.score, useful ? 'extracted' : 'fetched', method)
      }
      if (useful) {
        got++
        counts.menus_extraits++
      }
    } catch {
      counts.candidat_erreur++
    }
  }

  if (got > 0) counts.restos_avec_menu++
}

async function main() {
  console.log(`Mode: ${dry ? 'dry-run (aucune ecriture)' : 'ecriture Supabase'}`)
  const top = await loadTop500()
  const skip = await alreadyExtracted()
  const targets = top.filter(r => !skip.has(r.id)).slice(offset, offset + limit)
  console.log(`Top 500 avec site: ${top.length} | deja couverts: ${top.length - targets.length - Math.max(0, top.length - targets.length - skip.size)} | a traiter: ${targets.length}`)

  const counts = { restos_avec_menu: 0, menus_extraits: 0, sans_candidat: 0, site_mort: 0, candidat_erreur: 0 }
  let done = 0
  const queue = [...targets]

  async function worker() {
    while (queue.length > 0) {
      const resto = queue.shift()
      await processRestaurant(resto, counts)
      done++
      if (done % 25 === 0) {
        console.log(`${done}/${targets.length} | restos avec menu ${counts.restos_avec_menu} | docs extraits ${counts.menus_extraits} | sites morts ${counts.site_mort} | sans candidat ${counts.sans_candidat}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  console.log('\nTermine.')
  console.log(JSON.stringify(counts, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
