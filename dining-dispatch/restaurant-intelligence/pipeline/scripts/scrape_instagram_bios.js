// Scrape les liens en bio des profils Instagram déjà identifiés.
// Instagram embed les données utilisateur en JSON dans le HTML de la page profil.
// On extrait external_url (lien en bio) et biography pour enrichir la base.
// Produit : data/mvp_instagram_bios.json
// Lancer avec --write pour sauvegarder les liens en Supabase.

import { createClient } from '@supabase/supabase-js'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import 'dotenv/config'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const OUTPUT = resolve('data/mvp_instagram_bios.json')
const DELAY = 1200  // ms entre requetes (Instagram rate-limit agressif)
const CONCURRENCY = 3

// User-agents iPhone et Android pour imiter un mobile (Instagram moins restrictif)
const USER_AGENTS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
]
let uaIdx = 0
const nextUA = () => USER_AGENTS[uaIdx++ % USER_AGENTS.length]

// ─── Extraction du lien bio depuis le HTML Instagram ──────────────────────────

function extractExternalUrl(html) {
  // Instagram embed les données en JSON dans plusieurs formats selon la version
  // Pattern 1 : "external_url":"https://..."
  const p1 = html.match(/"external_url"\s*:\s*"([^"]+)"/)
  if (p1 && p1[1] && p1[1] !== 'null' && p1[1].startsWith('http')) return p1[1]

  // Pattern 2 : external_url":"https:\/\/..." (backslash-escaped)
  const p2 = html.match(/"external_url":"(https?:\\\/\\\/[^"]+)"/)
  if (p2) return p2[1].replace(/\\\//g, '/')

  // Pattern 3 : externalUrl:"https://..."
  const p3 = html.match(/externalUrl\s*:\s*"([^"]+)"/)
  if (p3 && p3[1].startsWith('http')) return p3[1]

  // Pattern 4 : meta og:description peut contenir le site web dans certains cas
  // (fallback très peu fiable, on skip)

  return null
}

function extractBiography(html) {
  const p1 = html.match(/"biography"\s*:\s*"([^"]*)"/)
  if (p1) return p1[1].replace(/\\n/g, ' ').replace(/\\u[\da-f]{4}/gi, '').trim()
  return null
}

function extractLinksFromBio(bio) {
  if (!bio) return []
  // Chercher des URLs dans le texte de la bio
  const urlRe = /https?:\/\/[^\s"')]+/g
  return (bio.match(urlRe) || []).map(u => u.replace(/[.,;!?)]+$/, ''))
}

// ─── Requete Instagram ────────────────────────────────────────────────────────

async function fetchInstagramProfile(handle) {
  const profileUrl = `https://www.instagram.com/${handle}/`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)

  try {
    const res = await fetch(profileUrl, {
      headers: {
        'User-Agent': nextUA(),
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    if (!res.ok) return { ok: false, status: res.status, handle }

    const html = await res.text()

    // Si Instagram redirige vers login, la page contient "Log in"
    if (html.includes('"viewer":null') && html.includes('login_page')) {
      return { ok: false, status: 'login_wall', handle }
    }

    const externalUrl = extractExternalUrl(html)
    const biography = extractBiography(html)
    const bioLinks = extractLinksFromBio(biography)

    return {
      ok: true,
      status: res.status,
      handle,
      externalUrl,
      biography,
      bioLinks,
      hasData: !!(externalUrl || biography),
    }
  } catch (e) {
    return { ok: false, status: null, handle, error: e.message }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Batch concurrent ─────────────────────────────────────────────────────────

async function processBatch(batch, allResults, offset) {
  const promises = batch.map(async (entry, idx) => {
    await new Promise(r => setTimeout(r, idx * (DELAY / CONCURRENCY)))
    const result = await fetchInstagramProfile(entry.instagramHandle)

    const label = `[${offset + idx + 1}] @${entry.instagramHandle.padEnd(30)}`

    if (result.ok && result.hasData) {
      const parts = []
      if (result.externalUrl) parts.push(`→ ${result.externalUrl}`)
      if (result.biography) parts.push(`bio: "${result.biography.slice(0, 60)}..."`)
      console.log(`${label} ${parts.join(' | ')}`)
    } else if (result.status === 'login_wall') {
      console.log(`${label} [login wall]`)
    } else {
      console.log(`${label} [${result.status || result.error?.slice(0, 30) || 'no data'}]`)
    }

    return {
      restaurantId: entry.restaurantId,
      restaurantName: entry.restaurantName,
      instagramHandle: entry.instagramHandle,
      instagramUrl: entry.instagramUrl,
      externalUrl: result.externalUrl || null,
      biography: result.biography || null,
      bioLinks: result.bioLinks || [],
      httpStatus: result.status,
      scraped: result.ok,
    }
  })

  return Promise.all(promises)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const candidates = JSON.parse(await readFile(resolve('data/mvp_instagram_candidates.json'), 'utf8'))
  const found = candidates.filter(c => c.status === 'found')

  console.log(`Scraping bios Instagram : ${found.length} profils`)
  console.log(`Concurrence : ${CONCURRENCY} | Délai : ${DELAY}ms | Mode écriture : ${write ? 'OUI' : 'NON'}`)
  console.log('')

  const results = []
  for (let i = 0; i < found.length; i += CONCURRENCY) {
    const batch = found.slice(i, i + CONCURRENCY)
    const batchResults = await processBatch(batch, results, i)
    results.push(...batchResults)
    // Pause inter-batch pour éviter le rate-limit
    if (i + CONCURRENCY < found.length) {
      await new Promise(r => setTimeout(r, DELAY))
    }
  }

  await writeFile(OUTPUT, JSON.stringify(results, null, 2))

  const withExternal = results.filter(r => r.externalUrl)
  const withBio = results.filter(r => r.biography)
  const withBioLinks = results.filter(r => r.bioLinks.length > 0)

  console.log(`\nTerminé.`)
  console.log(`Profils avec lien externe : ${withExternal.length} / ${found.length}`)
  console.log(`Profils avec bio : ${withBio.length}`)
  console.log(`Bios contenant des URLs : ${withBioLinks.length}`)
  console.log(`Export : ${OUTPUT}`)

  if (!write) {
    console.log(`\nRelancer avec --write pour appliquer ${withExternal.length} liens en base.`)
    return
  }

  // ── Écriture Supabase : sitio_web si pas encore rempli ──
  console.log(`\nApplication de ${withExternal.length} liens externes...`)
  let applied = 0

  for (const r of withExternal) {
    // Ne pas écraser un site web existant — seulement compléter si vide
    const { data: existing } = await supabase
      .from('restaurants')
      .select('sitio_web')
      .eq('id', r.restaurantId)
      .single()

    if (existing?.sitio_web) {
      console.log(`  SKIP: ${r.restaurantName} a déjà un site`)
      continue
    }

    const { error } = await supabase
      .from('restaurants')
      .update({ sitio_web: r.externalUrl })
      .eq('id', r.restaurantId)

    if (error) {
      console.error(`  ERREUR ${r.restaurantName}: ${error.message}`)
    } else {
      console.log(`  OK: ${r.restaurantName} → ${r.externalUrl}`)
      applied++
    }
  }

  console.log(`\nAppliqué: ${applied}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
