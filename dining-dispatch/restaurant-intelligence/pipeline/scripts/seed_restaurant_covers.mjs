#!/usr/bin/env node
/**
 * Seed 1–2 free cover photos for app_catalogue restaurants only (~800).
 *
 * Sources (priority):
 *  1. Free raw dumps already on disk (Reservándonos, Michelin, Wikidata, Resy)
 *  2. Official website og:image / twitter:image
 *
 * Downloads, compresses (sips → JPEG ≤1600px), uploads to Storage bucket
 * `restaurant-media`, inserts `restaurant_media` rows.
 *
 * Never uses Google Places Media API.
 *
 * Usage:
 *   node scripts/seed_restaurant_covers.mjs              # full run
 *   node scripts/seed_restaurant_covers.mjs --dry-run    # plan only
 *   node scripts/seed_restaurant_covers.mjs --limit 20
 *   node scripts/seed_restaurant_covers.mjs --skip-website
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const ENV_PATH = resolve('.env.staging.local')
const BUCKET = 'restaurant-media'
const MAX_PER_RESTAURANT = 2
const CONCURRENCY = 6
const FETCH_TIMEOUT_MS = 14_000
const UA = 'TheDiningDispatchCoverBot/1.0 (+https://thediningdispatch.app; research covers)'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const skipWebsite = args.has('--skip-website')
const limitArg = process.argv.find((a, i, arr) => arr[i - 1] === '--limit')
const limit = limitArg ? Number(limitArg) : Infinity

function loadEnv(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trimStart().startsWith('#')) continue
    const i = line.indexOf('=')
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return env
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const STOP = new Set([
  'restaurante', 'restaurant', 'cafe', 'café', 'bar', 'the', 'de', 'la', 'el',
  'los', 'las', 'del', 'and', 'cdmx', 'mexico', 'mex', 'suc', 'sucursal',
])

function tokens(s) {
  return new Set(norm(s).split(' ').filter((t) => t.length > 2 && !STOP.has(t)))
}

function jaccard(a, b) {
  const A = tokens(a)
  const B = tokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

function domain(u) {
  try {
    const href = /^https?:\/\//i.test(u) ? u : `https://${u}`
    return new URL(href).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

function isUsableImageUrl(u) {
  if (typeof u !== 'string' || !/^https?:\/\//i.test(u)) return false
  if (/googleusercontent\.com\/a\//i.test(u)) return false
  if (/maps\.google|ggpht\.com|lh3\.googleusercontent\.com\/p\//i.test(u)) return false
  if (/facebook\.com\/.*\/photo/i.test(u) && !/\.(jpg|jpeg|png|webp)/i.test(u)) return false
  return (
    /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(u) ||
    /image\.resy\.com|reservandonos-cdn|wixstatic|cdn-website|cloudinary|imgix|supabase\.co\/storage/i.test(u) ||
    /commons\.wikimedia\.org\/wiki\/Special:FilePath\//i.test(u) ||
    /cdninstagram\.com|fbcdn\.net/i.test(u)
  )
}

function loadRawJson(dir) {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse()
    if (!files.length) return []
    return JSON.parse(readFileSync(join(dir, files[0]), 'utf8'))
  } catch {
    return []
  }
}

function collectCandidates() {
  /** @type {{ name: string, urls: string[], source: string, website?: string|null }[]} */
  const out = []

  const push = (name, urls, source, website = null) => {
    const clean = [...new Set((urls || []).filter(isUsableImageUrl))].slice(0, 6)
    if (!name || !clean.length) return
    out.push({ name: String(name), urls: clean, source, website })
  }

  for (const r of loadRawJson('data/raw/reservandonos')) {
    push(r.name, r.payload?.gallery || [], 'reservandonos', r.website || r.payload?.profile_url)
  }

  for (const r of loadRawJson('data/raw/michelin')) {
    const imgs = []
    if (r.payload?.image) imgs.push(r.payload.image)
    if (Array.isArray(r.payload?.images)) {
      for (const im of r.payload.images) {
        imgs.push(typeof im === 'string' ? im : im?.url || im?.src)
      }
    }
    push(r.name, imgs, 'michelin', r.website || r.payload?.website)
  }

  for (const r of loadRawJson('data/raw/wikidata')) {
    if (r.payload?.image) push(r.name, [r.payload.image], 'wikidata', r.website || r.payload?.website)
  }

  // Resy + any free http urls in local golden record
  try {
    const local = new DatabaseSync('data/local_db/cdmx_local.sqlite', { readonly: true })
    for (const row of local.prepare("SELECT payload FROM source_records WHERE source = 'resy'").all()) {
      try {
        const p = JSON.parse(row.payload)
        const imgs = []
        if (p.image) imgs.push(typeof p.image === 'string' ? p.image : p.image?.url)
        if (Array.isArray(p.images)) {
          for (const im of p.images) imgs.push(typeof im === 'string' ? im : im?.url)
        }
        push(p.name, imgs.filter(Boolean), 'resy', p.resyUrl || p.website)
      } catch { /* skip */ }
    }
    for (const row of local.prepare(
      'SELECT name, photos, website FROM restaurant_golden_record WHERE photo_count > 0',
    ).all()) {
      const urls = []
      try {
        const walk = (o) => {
          if (!o) return
          if (typeof o === 'string') {
            if (isUsableImageUrl(o)) urls.push(o)
            return
          }
          if (Array.isArray(o)) return o.forEach(walk)
          if (typeof o === 'object') Object.values(o).forEach(walk)
        }
        walk(JSON.parse(row.photos || '[]'))
      } catch { /* skip */ }
      // Prefer non-google only (isUsableImageUrl already filters most)
      push(row.name, urls, 'other', row.website)
    }
  } catch (e) {
    console.warn('local sqlite optional:', e.message)
  }

  return out
}

function bestMatch(restaurant, candidates) {
  const d = domain(restaurant.website)
  const rTokens = tokens(restaurant.name)
  let best = null
  let bestScore = 0
  for (const c of candidates) {
    let score = jaccard(restaurant.name, c.name)
    if (d && c.website && domain(c.website) === d) score = Math.max(score, 0.9)
    // exact normalized name
    if (norm(restaurant.name) === norm(c.name)) score = 1
    // Short brand names ("Toks") need near-exact match — jaccard is too loose.
    if (rTokens.size <= 1 && score < 0.99 && !(d && c.website && domain(c.website) === d)) {
      score = 0
    }
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  // Prefer precise matches; domain/website matches already boosted to 0.9+.
  if (best && bestScore >= 0.72) return { ...best, score: bestScore }
  return null
}

function extractOgImage(html) {
  const patterns = [
    /property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i,
    /name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
    /content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m?.[1]) return m[1].replace(/&amp;/g, '&').trim()
  }
  return null
}

async function fetchOgImage(website) {
  if (!website || /facebook\.com|instagram\.com|linktr\.ee|wa\.me|bit\.ly/i.test(website)) {
    return null
  }
  let url = website.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
    })
    if (!res.ok) return null
    const html = await res.text()
    const og = extractOgImage(html)
    if (!og) return null
    try {
      return new URL(og, res.url).href
    } catch {
      return og
    }
  } catch {
    return null
  }
}

async function downloadImage(url) {
  let finalUrl = url
  // Wikidata Special:FilePath redirects to real file
  if (/commons\.wikimedia\.org\/wiki\/Special:FilePath\//i.test(url)) {
    finalUrl = url.includes('?') ? `${url}&width=1600` : `${url}?width=1600`
  }
  const res = await fetch(finalUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': UA, Accept: 'image/*,*/*' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ctype = (res.headers.get('content-type') || '').toLowerCase()
  if (ctype && !ctype.startsWith('image/') && !ctype.includes('octet-stream')) {
    throw new Error(`not image: ${ctype}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 2_000) throw new Error('too small')
  // Allow large sources; sips compresses before upload (Storage limit 5 MB).
  if (buf.length > 40_000_000) throw new Error('too large')
  return buf
}

function compressToJpeg(inputBuf) {
  const id = randomUUID()
  const inPath = join(tmpdir(), `tdd-cover-in-${id}`)
  const outPath = join(tmpdir(), `tdd-cover-out-${id}.jpg`)
  writeFileSync(inPath, inputBuf)
  try {
    // sips is available on macOS; resize longest side + jpeg
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', '-Z', '1600', inPath, '--out', outPath], {
      stdio: 'ignore',
    })
    const out = readFileSync(outPath)
    if (out.length < 1_000) throw new Error('compress failed')
    return out
  } finally {
    try { unlinkSync(inPath) } catch { /* */ }
    try { unlinkSync(outPath) } catch { /* */ }
  }
}

async function ensureBucket(sb) {
  const { data: buckets } = await sb.storage.listBuckets()
  if (buckets?.some((b) => b.name === BUCKET)) return
  const { error } = await sb.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 5_000_000,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  })
  if (error && !/already exists/i.test(error.message)) throw error
}

async function mapPool(items, concurrency, fn) {
  let i = 0
  const results = []
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

async function main() {
  if (!existsSync(ENV_PATH)) {
    console.error('Missing .env.staging.local')
    process.exit(1)
  }
  const env = loadEnv(ENV_PATH)
  const sb = createClient(env.STAGING_SUPABASE_URL, env.STAGING_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // App catalogue only
  let restaurants = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('app_catalogue')
      .select('id,name,website,cover_url')
      .range(from, from + 999)
    if (error) {
      // cover_url may not exist before migration
      const retry = await sb.from('app_catalogue').select('id,name,website').range(from, from + 999)
      if (retry.error) throw retry.error
      restaurants.push(...retry.data)
      if (retry.data.length < 1000) break
    } else {
      restaurants.push(...data)
      if (data.length < 1000) break
    }
  }

  // Already has media?
  const { data: existing } = await sb.from('restaurant_media').select('restaurant_id')
  const hasMedia = new Set((existing || []).map((r) => r.restaurant_id))

  restaurants = restaurants.filter((r) => !hasMedia.has(r.id) && !r.cover_url)
  if (Number.isFinite(limit)) restaurants = restaurants.slice(0, limit)

  console.log(`Catalogue targets without cover: ${restaurants.length} (skip already filled)`)
  const candidates = collectCandidates()
  console.log(`Free offline candidates: ${candidates.length}`)

  if (!dryRun) await ensureBucket(sb)

  const stats = {
    matched_offline: 0,
    matched_website: 0,
    uploaded: 0,
    failed: 0,
    skipped: 0,
    bySource: {},
  }

  await mapPool(restaurants, CONCURRENCY, async (restaurant) => {
    try {
      /** @type {{ url: string, source: string }[]} */
      const picks = []
      const offline = bestMatch(restaurant, candidates)
      if (offline) {
        for (const u of offline.urls.slice(0, MAX_PER_RESTAURANT)) {
          picks.push({ url: u, source: offline.source })
        }
        stats.matched_offline++
      }

      if (picks.length < MAX_PER_RESTAURANT && !skipWebsite && restaurant.website) {
        const og = await fetchOgImage(restaurant.website)
        if (og && isUsableImageUrl(og) && !picks.some((p) => p.url === og)) {
          picks.push({ url: og, source: 'official_website' })
          stats.matched_website++
        }
      }

      if (!picks.length) {
        stats.skipped++
        return
      }

      if (dryRun) {
        console.log(`[dry] ${restaurant.name} ← ${picks.map((p) => p.source).join(',')} ${picks[0].url.slice(0, 80)}`)
        stats.uploaded += picks.length
        return
      }

      let sort = 0
      for (const pick of picks.slice(0, MAX_PER_RESTAURANT)) {
        try {
          const raw = await downloadImage(pick.url)
          const jpeg = compressToJpeg(raw)
          const path = `${restaurant.id}/${sort}.jpg`
          const { error: upErr } = await sb.storage.from(BUCKET).upload(path, jpeg, {
            contentType: 'image/jpeg',
            upsert: true,
          })
          if (upErr) throw upErr
          const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path)
          const publicUrl = pub.publicUrl
          const { error: insErr } = await sb.from('restaurant_media').upsert(
            {
              restaurant_id: restaurant.id,
              public_url: publicUrl,
              source: ['reservandonos', 'michelin', 'resy', 'wikidata', 'official_website', 'opentable', 'manual', 'other'].includes(pick.source)
                ? pick.source
                : 'other',
              source_url: pick.url,
              sort_order: sort,
            },
            { onConflict: 'restaurant_id,sort_order' },
          )
          if (insErr) throw insErr
          sort++
          stats.uploaded++
          stats.bySource[pick.source] = (stats.bySource[pick.source] || 0) + 1
        } catch (e) {
          stats.failed++
          console.warn(`  fail ${restaurant.name} (${pick.source}): ${e.message}`)
        }
      }
      if (sort > 0) {
        process.stdout.write('.')
      }
    } catch (e) {
      stats.failed++
      console.warn(`  error ${restaurant.name}: ${e.message}`)
    }
  })

  console.log('\nDone.')
  console.log(JSON.stringify(stats, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
