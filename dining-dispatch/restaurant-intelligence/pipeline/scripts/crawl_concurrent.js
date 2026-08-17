// Crawl concurrent des sites officiels pour extraire menus, réseaux sociaux, réservations.
// Version haute performance : 15 requêtes simultanées au lieu de séquentiel.
// Cible : tous les restaurants MVP avec sitio_web renseigné.
// Produit : data/mvp_crawl_concurrent.json + mise à jour Supabase avec --write.

import { createClient } from '@supabase/supabase-js'
import { writeFile } from 'fs/promises'
import { resolve } from 'path'
import https from 'https'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const CONCURRENCY = 15
const TIMEOUT = 18000
const OUTPUT = resolve('data/mvp_crawl_concurrent.json')

// Agent SSL permissif pour sites avec certs expirés
const insecureAgent = new https.Agent({ rejectUnauthorized: false })

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]
let uaIdx = 0
const nextUA = () => USER_AGENTS[uaIdx++ % USER_AGENTS.length]

// ─── Providers connus ─────────────────────────────────────────────────────────

const PROVIDERS = [
  { p: 'instagram',  t: 'social',       h: ['instagram.com'] },
  { p: 'facebook',   t: 'social',       h: ['facebook.com', 'm.facebook.com', 'fb.com'] },
  { p: 'tiktok',     t: 'social',       h: ['tiktok.com', 'vm.tiktok.com'] },
  { p: 'twitter',    t: 'social',       h: ['twitter.com', 'x.com'] },
  { p: 'youtube',    t: 'social',       h: ['youtube.com', 'youtu.be'] },
  { p: 'opentable',  t: 'reservation',  h: ['opentable.com', 'opentable.com.mx'] },
  { p: 'resy',       t: 'reservation',  h: ['resy.com'] },
  { p: 'yelp',       t: 'reservation',  h: ['yelp.com'] },
  { p: 'ubereats',   t: 'delivery',     h: ['ubereats.com'] },
  { p: 'rappi',      t: 'delivery',     h: ['rappi.com'] },
  { p: 'didi',       t: 'delivery',     h: ['didiglobal.com', 'didi.com.mx'] },
  { p: 'whatsapp',   t: 'contact',      h: ['wa.me', 'api.whatsapp.com', 'wa.link'] },
  { p: 'linktree',   t: 'hub',          h: ['linktr.ee'] },
  { p: 'beacons',    t: 'hub',          h: ['beacons.ai'] },
  { p: 'campsite',   t: 'hub',          h: ['campsite.bio'] },
  { p: 'tripadvisor',t: 'review',       h: ['tripadvisor.com', 'tripadvisor.com.mx'] },
  { p: 'google',     t: 'review',       h: ['g.page', 'maps.google.com', 'goo.gl'] },
]

const MENU_KEYWORDS = ['menu', 'menú', 'carta', 'food', 'comida', 'bebidas', 'drinks', 'brunch', 'platillos', 'qrco.de', 'qr.menu', 'menudigital']

function classifyLink(url, anchor) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    const provider = PROVIDERS.find(pr => pr.h.some(h => host === h || host.endsWith(`.${h}`)))
    if (provider) return { linkType: provider.t, provider: provider.p }

    const hay = `${url} ${anchor}`.toLowerCase()
    if (MENU_KEYWORDS.some(k => hay.includes(k))) return { linkType: 'menu', provider: 'website' }
  } catch { /* url invalide */ }
  return null
}

function extractLinks(html, baseUrl) {
  const links = []
  const seen = new Set()

  // Balises <a href>
  const anchorRe = /<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = anchorRe.exec(html)) !== null) {
    try {
      const raw = m[1].trim()
      const url = new URL(raw, baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) continue
      url.hash = ''
      const href = url.href
      if (seen.has(href)) continue
      seen.add(href)

      const anchor = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
      const classified = classifyLink(href, anchor)
      if (classified) links.push({ url: href, ...classified, anchor: anchor.slice(0, 80) })
    } catch { /* lien invalide */ }
  }

  // Meta og: pour les réseaux sociaux parfois déclarés en balise meta
  const metaRe = /<meta\b[^>]*(?:property|name)=["'][^"']*(?:site|url|twitter|og)[^"']*["'][^>]*content=["']([^"']+)["'][^>]*>/gi
  while ((m = metaRe.exec(html)) !== null) {
    try {
      const url = new URL(m[1])
      if (!['http:', 'https:'].includes(url.protocol)) continue
      if (seen.has(url.href)) continue
      seen.add(url.href)
      const classified = classifyLink(url.href, '')
      if (classified && classified.linkType === 'social') {
        links.push({ url: url.href, ...classified, anchor: 'meta' })
      }
    } catch { /* ignore */ }
  }

  return links
}

// ─── Fetch avec variants ──────────────────────────────────────────────────────

function buildVariants(raw) {
  const variants = []
  try {
    const u = new URL(raw)
    const host = u.hostname
    const path = u.pathname + u.search
    const hosts = host.startsWith('www.')
      ? [host, host.slice(4)]
      : [host, `www.${host}`]
    for (const h of hosts) {
      variants.push(`https://${h}${path}`)
      variants.push(`http://${h}${path}`)
    }
  } catch {
    const clean = raw.replace(/^https?:\/\//, '')
    variants.push(`https://${clean}`, `http://${clean}`)
  }
  return [...new Set(variants)]
}

async function fetchSite(rawUrl) {
  const variants = buildVariants(rawUrl)

  for (const url of variants) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT)
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': nextUA(),
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'es-MX,es;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        ...(url.startsWith('https://') ? { agent: insecureAgent } : {}),
      })

      if (!res.ok && res.status !== 403) continue

      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('text/html')) {
        return { ok: true, status: res.status, finalUrl: res.url, html: '', links: [] }
      }

      const html = await res.text()
      const links = extractLinks(html, res.url)
      return { ok: true, status: res.status, finalUrl: res.url, html: html.length, links }
    } catch {
      continue
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, links: [] }
}

// ─── Semaphore pour limiter la concurrence ────────────────────────────────────

class Semaphore {
  constructor(max) {
    this.max = max
    this.count = 0
    this.queue = []
  }
  acquire() {
    return new Promise(resolve => {
      if (this.count < this.max) { this.count++; resolve() }
      else this.queue.push(resolve)
    })
  }
  release() {
    this.count--
    if (this.queue.length > 0) { this.count++; this.queue.shift()() }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Charger tous les restaurants MVP avec un site web
  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, nombre, sitio_web, instagram, facebook, alcaldia, colonia')
    .not('sitio_web', 'is', null)
    .in('colonia', [
      'ROMA NORTE', 'ROMA SUR', 'COLONIA ROMA SUR',
      'CONDESA', 'HIPODROMO', 'HIPÓDROMO',
      'HIPODROMO CONDESA', 'HIPÓDROMO CONDESA',
      'HIPODROMO DE LA CONDES', 'CONDESA VMC',
    ])

  if (error) { console.error(error.message); process.exit(1) }

  // Filtrer les URLs tierces qui ne sont pas des sites officiels
  const toProcess = restaurants.filter(r => {
    const w = r.sitio_web || ''
    return !w.match(/tripadvisor|facebook\.com|instagram\.com|opentable|rappi|ubereats/i)
  })

  console.log(`Crawl concurrent — ${toProcess.length} sites | concurrence: ${CONCURRENCY} | timeout: ${TIMEOUT / 1000}s`)
  console.log(`Mode écriture : ${write ? 'OUI (--write)' : 'NON'}`)
  console.log('')

  const sem = new Semaphore(CONCURRENCY)
  const results = []
  let done = 0
  let ok = 0
  let fail = 0

  const tasks = toProcess.map(async (r, idx) => {
    await sem.acquire()
    try {
      const result = await fetchSite(r.sitio_web)
      done++

      const linkSummary = {}
      result.links.forEach(l => { linkSummary[l.provider] = (linkSummary[l.provider] || 0) + 1 })
      const summaryStr = Object.keys(linkSummary).length
        ? Object.entries(linkSummary).map(([k, v]) => `${k}:${v}`).join(' ')
        : 'aucun lien'

      if (result.ok) {
        ok++
        process.stdout.write(`[${done}/${toProcess.length}] ${r.nombre.slice(0, 35).padEnd(35)} OK ${result.status} | ${summaryStr}\n`)
      } else {
        fail++
        process.stdout.write(`[${done}/${toProcess.length}] ${r.nombre.slice(0, 35).padEnd(35)} FAIL\n`)
      }

      const entry = {
        restaurantId: r.id,
        restaurantName: r.nombre,
        website: r.sitio_web,
        ok: result.ok,
        status: result.status || null,
        finalUrl: result.finalUrl || null,
        links: result.links,
        linkCount: result.links.length,
      }
      results.push(entry)

      // Écriture Supabase si demandée
      if (write && result.ok && result.links.length > 0) {
        const patch = {}
        const ig = result.links.find(l => l.provider === 'instagram')
        const fb = result.links.find(l => l.provider === 'facebook')
        if (ig && !r.instagram) patch.instagram = ig.url
        if (fb && !r.facebook) patch.facebook = fb.url
        if (Object.keys(patch).length > 0) {
          await supabase.from('restaurants').update(patch).eq('id', r.id)
        }
      }
    } finally {
      sem.release()
    }
  })

  await Promise.allSettled(tasks)
  await writeFile(OUTPUT, JSON.stringify(results, null, 2))

  // Stats finales
  const allLinks = results.flatMap(r => r.links)
  const byType = {}
  allLinks.forEach(l => { byType[l.linkType] = (byType[l.linkType] || 0) + 1 })

  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Sites crawlés : ${done} | OK : ${ok} | Fail : ${fail}`)
  console.log(`Total liens trouvés : ${allLinks.length}`)
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => {
    console.log(`  ${t.padEnd(15)} ${n}`)
  })
  console.log(`Export : ${OUTPUT}`)
  if (!write) console.log(`\nRelancer avec --write pour appliquer les mises à jour sociales.`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
