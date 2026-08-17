// Analyse les sites cassés du backlog MVP et génère des candidats de correction.
// Ne touche pas à Supabase — produit data/mvp_website_corrections_candidates.json.
// Lancer avec --write pour appliquer les corrections avec confidence >= 0.85.

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
const MIN_CONFIDENCE_TO_WRITE = 0.85
const FETCH_TIMEOUT = 10000
const OUTPUT_PATH = resolve('data/mvp_website_corrections_candidates.json')

// ─── Corrections de domaine automatiques ──────────────────────────────────────

function tryFixDomain(rawUrl) {
  const fixes = []
  const url = String(rawUrl || '').trim()

  // 1. URL tierce-partie stockée comme site officiel → effacer
  if (url.match(/tripadvisor\.|opentable\.com/i)) {
    fixes.push({ proposed: null, reason: 'url_tierce_partie', confidence: 0.99 })
    return fixes
  }

  // 2. Instagram encodé comme URL → extraire handle
  const instaMatch = url.match(/instsgram\.com[._]+([a-z0-9_.]+)/i)
    || url.match(/instagram\.com\/([a-z0-9_.]+)/i)
  if (instaMatch) {
    fixes.push({
      proposed: null,
      instagram: `https://www.instagram.com/${instaMatch[1]}/`,
      reason: 'instagram_stocke_comme_site',
      confidence: 0.95,
    })
    return fixes
  }

  // 3. https:// ou http:// inclus dans le hostname
  const httpsInDomain = url.match(/^https?:\/\/https?([a-z0-9-]+\.[a-z0-9.]+)/i)
  if (httpsInDomain) {
    fixes.push({ proposed: `https://${httpsInDomain[1]}`, reason: 'https_dans_domaine', confidence: 0.90 })
  }

  // 4. Underscore dans le domaine → tiret ou suppression
  if (url.match(/^https?:\/\/[^/]*_[^/]*/)) {
    const withDash = url.replace(/(https?:\/\/[^/]*)_([^/]*)/g, '$1-$2')
    const withoutChar = url.replace(/(https?:\/\/[^/]*)_([^/]*)/g, '$1$2')
    if (withDash !== url) fixes.push({ proposed: withDash, reason: 'underscore_remplace_par_tiret', confidence: 0.75 })
    if (withoutChar !== url && withoutChar !== withDash)
      fixes.push({ proposed: withoutChar, reason: 'underscore_supprime', confidence: 0.70 })
  }

  // 5. .mc (Monaco) au lieu de .mx (Mexique)
  if (url.match(/\.mc(\/|$)/)) {
    fixes.push({ proposed: url.replace(/\.mc(\/|$)/, '.mx$1'), reason: 'tld_mc_vers_mx', confidence: 0.92 })
  }

  // 6. .coom. → .com.
  if (url.match(/\.coom\./)) {
    fixes.push({ proposed: url.replace('.coom.', '.com.'), reason: 'coom_vers_com', confidence: 0.95 })
  }

  // 7. .mx.com → .com.mx (extensions inversées)
  if (url.match(/\.mx\.com(\/|$)/)) {
    fixes.push({ proposed: url.replace('.mx.com', '.com.mx'), reason: 'extensions_inversees_mx_com', confidence: 0.90 })
  }

  // 8. TLD manquant (domaine sans point ou TLD invalide comme .condesa)
  try {
    const parsed = new URL(url)
    const host = parsed.hostname
    const knownTLDs = /\.(com|mx|com\.mx|net|org|io|restaurant|mx|bar|cafe)$/i
    if (!knownTLDs.test(host)) {
      // Tenter d'ajouter .com et .mx
      fixes.push({ proposed: url.replace(host, `${host}.com`).replace('.com.com', '.com'), reason: 'tld_manquant_essai_com', confidence: 0.60 })
      fixes.push({ proposed: url.replace(host, `${host}.mx`).replace('.mx.mx', '.mx'), reason: 'tld_manquant_essai_mx', confidence: 0.58 })
    }
  } catch { /* url invalide, pas parseable */ }

  // 9. Typos noms connus dans le domaine
  const domainTypos = [
    { from: 'pedropabro', to: 'pedropablo', confidence: 0.88 },
    { from: 'donuys', to: 'donuts', confidence: 0.85 },
    { from: 'moro' , to: 'mero', confidence: 0.55 },  // merotoro vs morotoro — incertain
  ]
  for (const typo of domainTypos) {
    if (url.includes(typo.from)) {
      fixes.push({
        proposed: url.replaceAll(typo.from, typo.to),
        reason: `typo_${typo.from}_vers_${typo.to}`,
        confidence: typo.confidence,
      })
    }
  }

  return fixes
}

// ─── Test réseau ───────────────────────────────────────────────────────────────

async function testUrl(url) {
  if (!url) return { reachable: false, status: null }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'cdmx-restaurants-domain-fix/1.0' },
    })
    return { reachable: res.ok || res.status === 405, status: res.status, finalUrl: res.url }
  } catch {
    // HEAD refusé → essai GET
    try {
      const res2 = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'cdmx-restaurants-domain-fix/1.0' },
      })
      return { reachable: res2.ok, status: res2.status, finalUrl: res2.url }
    } catch (e) {
      return { reachable: false, status: null, error: e.message }
    }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const backlog = JSON.parse(
    await readFile(resolve('data/mvp_failed_websites_backlog.json'), 'utf8')
  )

  console.log(`Analyse de ${backlog.length} sites cassés...`)
  const candidates = []

  for (const entry of backlog) {
    const fixes = tryFixDomain(entry.website)
    if (fixes.length === 0) continue

    for (const fix of fixes) {
      const candidate = {
        restaurantId: entry.restaurantId,
        restaurantName: entry.restaurantName,
        oldWebsite: entry.website,
        proposedWebsite: fix.proposed ?? null,
        instagram: fix.instagram ?? null,
        evidence: [],
        confidenceScore: fix.confidence,
        reason: fix.reason,
        verified: false,
      }

      // Tester l'URL proposée si elle existe
      if (fix.proposed) {
        process.stdout.write(`  Test ${fix.proposed} ... `)
        const result = await testUrl(fix.proposed)
        candidate.verified = result.reachable
        candidate.httpStatus = result.status
        candidate.finalUrl = result.finalUrl
        if (result.reachable) {
          candidate.confidenceScore = Math.min(fix.confidence + 0.10, 0.99)
          candidate.evidence.push(`url_reachable_${result.status}`)
          console.log(`OK (${result.status})`)
        } else {
          candidate.confidenceScore = Math.max(fix.confidence - 0.15, 0.10)
          console.log(`KO (${result.status || result.error || 'timeout'})`)
        }
      } else {
        candidate.verified = true  // effacement ou instagram : pas de test réseau
        candidate.evidence.push('no_network_test_needed')
        console.log(`  [${fix.reason}] ${entry.restaurantName} → ${fix.instagram || 'null'}`)
      }

      candidates.push(candidate)
    }
  }

  // Trier : corrections sûres en premier
  candidates.sort((a, b) => b.confidenceScore - a.confidenceScore)

  await writeFile(OUTPUT_PATH, JSON.stringify(candidates, null, 2))

  const safe = candidates.filter(c => c.confidenceScore >= MIN_CONFIDENCE_TO_WRITE)
  const reachable = candidates.filter(c => c.verified && c.proposedWebsite)
  const toNull = candidates.filter(c => c.proposedWebsite === null && !c.instagram)
  const toInstagram = candidates.filter(c => c.instagram)

  console.log(`\nCandidats generes : ${candidates.length}`)
  console.log(`Corrections sures (>= ${MIN_CONFIDENCE_TO_WRITE}) : ${safe.length}`)
  console.log(`URLs atteignables verifiees : ${reachable.length}`)
  console.log(`Sites a effacer (tierce-partie) : ${toNull.length}`)
  console.log(`Instagram a extraire : ${toInstagram.length}`)
  console.log(`Export : ${OUTPUT_PATH}`)

  if (!write) {
    console.log(`\nRelancer avec --write pour appliquer les ${safe.length} corrections sures.`)
    return
  }

  // ── Ecriture Supabase ──
  console.log(`\nApplication des ${safe.length} corrections >= ${MIN_CONFIDENCE_TO_WRITE}...`)
  let applied = 0
  let errors = 0

  for (const c of safe) {
    const patch = {}
    if (c.proposedWebsite !== undefined) patch.sitio_web = c.proposedWebsite
    if (c.instagram) patch.instagram = c.instagram
    if (Object.keys(patch).length === 0) continue

    const { error } = await supabase
      .from('restaurants')
      .update(patch)
      .eq('id', c.restaurantId)

    if (error) {
      console.error(`  ERREUR ${c.restaurantName}: ${error.message}`)
      errors++
    } else {
      console.log(`  OK: ${c.restaurantName} | ${c.oldWebsite} → ${c.proposedWebsite || c.instagram || 'null'}`)
      applied++
    }
  }

  console.log(`\nApplique: ${applied} | Erreurs: ${errors}`)
}

main().catch(err => { console.error(err.message); process.exit(1) })
