// Retry agressif des 102+ sites en erreur reseau.
// Strategies : timeout long, HTTP fallback, www/sans-www, SSL ignore, user-agents rotatifs.
// Produit : data/mvp_retry_aggressive.json + mise a jour Supabase si --write-social.

import { createClient } from '@supabase/supabase-js'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import https from 'https'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const args = new Set(process.argv.slice(2))
const writeSocial = args.has('--write-social')
const TIMEOUT = 30000
const OUTPUT = resolve('data/mvp_retry_aggressive.json')

// User-agents realistes en rotation pour eviter les blocages simples
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
]
let uaIndex = 0
const nextUA = () => USER_AGENTS[uaIndex++ % USER_AGENTS.length]

// Agent HTTPS qui ignore les erreurs de certificat SSL expire
const insecureAgent = new https.Agent({ rejectUnauthorized: false })

function buildVariants(rawUrl) {
  const variants = []
  try {
    const url = new URL(rawUrl)
    const host = url.hostname
    const path = url.pathname + url.search

    const hosts = []
    if (host.startsWith('www.')) {
      hosts.push(host, host.replace(/^www\./, ''))
    } else {
      hosts.push(host, `www.${host}`)
    }

    for (const h of hosts) {
      variants.push(`https://${h}${path}`)
      variants.push(`http://${h}${path}`)
    }
  } catch {
    // URL non parseable — tenter en brut avec et sans https
    const clean = rawUrl.replace(/^https?:\/\//, '')
    variants.push(`https://${clean}`, `http://${clean}`)
  }

  // Dedupliquer en gardant l'ordre
  return [...new Set(variants)]
}

async function fetchWithTimeout(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)

  const isHttps = url.startsWith('https://')
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': nextUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
      },
      // Ignorer SSL uniquement pour les URLs http ou via agent
      ...(isHttps ? { agent: insecureAgent } : {}),
    })

    const contentType = res.headers.get('content-type') || ''
    const isHtml = contentType.includes('text/html')
    return {
      ok: res.ok || res.status === 403,  // 403 = site vivant, juste bloque
      status: res.status,
      finalUrl: res.url,
      isHtml,
      html: (res.ok && isHtml) ? await res.text() : '',
    }
  } catch (e) {
    return { ok: false, status: null, error: e.message }
  } finally {
    clearTimeout(timer)
  }
}

const MENU_KW = ['menu', 'menú', 'carta', 'food', 'bebidas', 'drinks', 'brunch', 'qrco.de']
const PROVIDERS = [
  { p: 'instagram', t: 'social', h: ['instagram.com'] },
  { p: 'facebook', t: 'social', h: ['facebook.com', 'm.facebook.com'] },
  { p: 'tiktok', t: 'social', h: ['tiktok.com'] },
  { p: 'opentable', t: 'reservation', h: ['opentable.com', 'opentable.com.mx'] },
  { p: 'ubereats', t: 'delivery', h: ['ubereats.com'] },
  { p: 'rappi', t: 'delivery', h: ['rappi.com'] },
  { p: 'whatsapp', t: 'contact', h: ['wa.me', 'api.whatsapp.com'] },
]

function extractLinks(html, baseUrl) {
  const links = []
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let m
  while ((m = anchorRe.exec(html)) !== null) {
    try {
      const url = new URL(m[1].trim(), baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) continue
      url.hash = ''
      const host = url.hostname.replace(/^www\./, '')
      const anchor = m[2].replace(/<[^>]+>/g, '').trim().toLowerCase()

      const provider = PROVIDERS.find(pr => pr.h.some(h => host === h || host.endsWith(`.${h}`)))
      if (provider) {
        links.push({ url: url.href, linkType: provider.t, provider: provider.p, anchor })
        continue
      }
      const hay = `${url.href} ${anchor}`
      if (MENU_KW.some(k => hay.includes(k))) {
        links.push({ url: url.href, linkType: 'menu', provider: 'website', anchor })
      }
    } catch { /* lien invalide */ }
  }
  // Dedupliquer par URL
  const seen = new Set()
  return links.filter(l => seen.has(l.url) ? false : seen.add(l.url))
}

async function updateSocial(restaurantId, links) {
  const ig = links.find(l => l.provider === 'instagram')?.url
  const fb = links.find(l => l.provider === 'facebook')?.url
  if (!ig && !fb) return false
  const patch = {}
  if (ig) patch.instagram = ig
  if (fb) patch.facebook = fb
  const { error } = await supabase.from('restaurants').update(patch).eq('id', restaurantId)
  if (error) console.error(`  social update error: ${error.message}`)
  return !error
}

async function main() {
  const backlog = JSON.parse(await readFile(resolve('data/mvp_failed_websites_backlog.json'), 'utf8'))
  const toRetry = backlog.filter(r =>
    r.status === 'error' &&
    !r.website.match(/tripadvisor|opentable\.com\.mx|facebook\.com|instagram\.com/)
  )

  console.log(`Retry agressif : ${toRetry.length} sites | timeout ${TIMEOUT}ms | SSL ignore | user-agent rotation`)
  console.log(`Mode ecriture sociale : ${writeSocial ? 'OUI' : 'NON (ajouter --write-social)'}`)
  console.log('')

  const results = []
  let recovered = 0
  let stillDead = 0

  for (let i = 0; i < toRetry.length; i++) {
    const entry = toRetry[i]
    const variants = buildVariants(entry.website)
    let success = null

    process.stdout.write(`[${i + 1}/${toRetry.length}] ${entry.restaurantName.slice(0, 35).padEnd(35)} `)

    for (const variant of variants) {
      const res = await fetchWithTimeout(variant)
      if (res.ok) {
        success = { ...res, testedUrl: variant }
        break
      }
    }

    if (success) {
      const links = success.html ? extractLinks(success.html, success.finalUrl) : []
      const summary = {}
      links.forEach(l => { summary[l.linkType] = (summary[l.linkType] || 0) + 1 })

      console.log(`OK ${success.status} | ${success.testedUrl.replace(/^https?:\/\//, '').slice(0, 40)} | liens: ${JSON.stringify(summary)}`)
      recovered++

      if (writeSocial) await updateSocial(entry.restaurantId, links)

      results.push({
        restaurantId: entry.restaurantId,
        restaurantName: entry.restaurantName,
        originalUrl: entry.website,
        successUrl: success.testedUrl,
        finalUrl: success.finalUrl,
        httpStatus: success.status,
        status: 'recovered',
        links,
      })
    } else {
      console.log(`MORT`)
      stillDead++
      results.push({
        restaurantId: entry.restaurantId,
        restaurantName: entry.restaurantName,
        originalUrl: entry.website,
        status: 'dead',
        links: [],
      })
    }

    // Pause courte pour ne pas saturer
    await new Promise(r => setTimeout(r, 150))
  }

  await writeFile(OUTPUT, JSON.stringify(results, null, 2))

  const menus = results.flatMap(r => r.links || []).filter(l => l.linkType === 'menu').length
  const social = results.flatMap(r => r.links || []).filter(l => l.linkType === 'social').length
  const reservations = results.flatMap(r => r.links || []).filter(l => l.linkType === 'reservation').length

  console.log(`\nTermine.`)
  console.log(`Sites recuperes : ${recovered} / ${toRetry.length}`)
  console.log(`Sites definitivement morts : ${stillDead}`)
  console.log(`Liens menus trouves : ${menus}`)
  console.log(`Liens sociaux trouves : ${social}`)
  console.log(`Liens reservation trouves : ${reservations}`)
  console.log(`Export : ${OUTPUT}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
