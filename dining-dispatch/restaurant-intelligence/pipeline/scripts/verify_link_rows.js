// Verifie en HTTP les lignes existantes de restaurant_links jamais testees
// (checked_at IS NULL). Met a jour status, http_status, final_url, title.
//
// Usage:
//   node scripts/verify_link_rows.js --dry            → teste sans ecrire
//   node scripts/verify_link_rows.js                  → teste et ecrit
//   node scripts/verify_link_rows.js --limit=100      → borne le nombre de liens
//
// Statuts poses :
//   valid    → repond en 2xx/3xx
//   invalid  → repond en 4xx/5xx
//   parked   → domaine en vente / page de parking
//   timeout  → pas de reponse dans les 12s ou erreur reseau
// Les 429 (rate limit) ne changent pas le statut : on ne peut pas conclure.

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const limitArg = args.find(a => a.startsWith('--limit='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : null
const TIMEOUT_MS = 12000
const CONCURRENCY = 8

const PARKED_SIGNALS = [
  'hugedomains',
  'domain is for sale',
  'is for sale',
  'buy this domain',
  'sedo domain parking',
  'parkingcrew',
]

const SOCIAL_HOSTS = ['instagram.com', 'facebook.com', 'tiktok.com', 'x.com', 'twitter.com', 'youtube.com']

function isSocial(host) {
  const h = String(host || '').replace(/^www\./i, '').toLowerCase()
  return SOCIAL_HOSTS.some(s => h === s || h.endsWith(`.${s}`))
}

function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 240) || null
}

function isParked(host, title) {
  const haystack = `${host} ${title || ''}`.toLowerCase()
  return PARKED_SIGNALS.some(s => haystack.includes(s))
}

async function checkUrl(rawUrl) {
  let url
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`)
  } catch {
    return { status: 'invalid', error: 'URL non parsable' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    // HEAD suffit pour valider la grande majorité des liens et évite de
    // télécharger des pages lourdes / déclencher certains anti-bots.
    // Si le serveur refuse HEAD (405/501), on retente en GET.
    let res = await fetch(url.href, {
      method: 'HEAD',
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) cdmx-link-verifier/1.0',
      },
      // Une redirection 3xx prouve déjà que le domaine répond. La suivre peut
      // déclencher Cloudflare / des erreurs HTTP2 et créer de faux timeouts.
      redirect: 'manual',
      signal: controller.signal,
    })
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url.href, {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) cdmx-link-verifier/1.0',
        },
        redirect: 'manual',
        signal: controller.signal,
      })
    }
    const contentType = res.headers.get('content-type') || ''
    const text = res.body && contentType.toLowerCase().includes('text/html') ? await res.text() : ''
    const title = extractTitle(text)
    const location = res.headers.get('location')
    const finalUrl = location ? new URL(location, url.href).href : res.url
    const finalHost = new URL(finalUrl).hostname.replace(/^www\./i, '')

    let status
    if (res.status === 429) status = null // rate limit : on ne conclut pas
    else if (isParked(finalHost, title)) status = 'parked'
    else if (res.status >= 200 && res.status < 400) status = 'valid'
    else status = 'invalid'

    return { status, httpStatus: res.status, finalUrl, finalHost, contentType, title }
  } catch (error) {
    return { status: 'timeout', error: String(error.message || error).slice(0, 200) }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchUncheckedLinks() {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('restaurant_links')
      .select('id, url, normalized_url, host, provider, link_type')
      .is('http_status', null)
      .order('link_type')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`Supabase: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
    if (limit && rows.length >= limit) break
  }
  return limit ? rows.slice(0, limit) : rows
}

async function updateRow(row, result) {
  const patch = {
    http_status: result.httpStatus ?? null,
    final_url: result.finalUrl ?? null,
    final_host: result.finalHost ?? null,
    content_type: result.contentType ?? null,
    title: result.title ?? null,
    checked_at: new Date().toISOString(),
    error_message: result.error ?? null,
  }
  if (result.status) patch.status = result.status

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { error } = await supabase.from('restaurant_links').update(patch).eq('id', row.id)
      if (!error) return
      if (attempt === 3) console.log(`  update rate ${row.id}: ${error.message}`)
    } catch (e) {
      if (attempt === 3) { console.log(`  update rate ${row.id}: ${e.message}`); return }
    }
    await new Promise(r => setTimeout(r, 2000 * attempt))
  }
}

async function main() {
  console.log(`Mode: ${dry ? 'dry-run (aucune ecriture)' : 'ecriture Supabase'}`)
  const links = await fetchUncheckedLinks()
  const groups = new Map()
  for (const row of links) {
    const key = row.normalized_url || row.url
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  console.log(`Lignes a verifier: ${links.length}`)
  console.log(`URLs uniques: ${groups.size}`)

  const counts = { valid: 0, invalid: 0, parked: 0, timeout: 0, rate_limited: 0 }
  let done = 0

  const queue = [...groups.values()]
  async function worker() {
    while (queue.length > 0) {
      const rows = queue.shift()
      const row = rows[0]
      let result
      try {
        const parsed = new URL(/^https?:\/\//i.test(row.url) ? row.url : `https://${row.url}`)
        const host = parsed.hostname.toLowerCase()
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') {
          result = { status: 'invalid', error: 'URL locale non publique' }
        } else {
          result = await checkUrl(row.url)
        }
      } catch {
        result = { status: 'invalid', error: 'URL non parsable' }
      }
      if (result.status) counts[result.status] += rows.length
      else counts.rate_limited += rows.length

      if (!dry) await Promise.all(rows.map(item => updateRow(item, result)))

      done += rows.length
      if (done % 100 === 0) {
        console.log(`${done}/${links.length} | valid ${counts.valid} | invalid ${counts.invalid} | parked ${counts.parked} | timeout ${counts.timeout}`)
      }
      // petite pause pour les hosts sociaux, plus sensibles au rate limit
      if (isSocial(row.host)) await new Promise(r => setTimeout(r, 400))
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  console.log('\nTermine.')
  console.log(JSON.stringify(counts, null, 2))
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
