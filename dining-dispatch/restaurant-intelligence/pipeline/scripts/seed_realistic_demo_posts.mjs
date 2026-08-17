#!/usr/bin/env node
/**
 * Replace bateau seed conversations with more realistic community posts
 * grounded in free review/editorial text already on disk:
 *   - Michelin guide blurbs (editorial)
 *   - OpenTable top reviews (diner quotes)
 *
 * Safety:
 *   - STAGING_* only (.env.staging.local)
 *   - only deletes/writes dispatches by known seed author usernames
 *   - never touches real accounts (jules, etc.)
 *   - dry-run by default; --apply to write
 *   - attaches restaurant Storage covers when available (not Google)
 *
 * Usage:
 *   node scripts/seed_realistic_demo_posts.mjs
 *   node scripts/seed_realistic_demo_posts.mjs --apply
 *   node scripts/seed_realistic_demo_posts.mjs --apply --limit 40
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import { join, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { DatabaseSync } from 'node:sqlite'

const ENV_PATH = resolve('.env.staging.local')
const apply = process.argv.includes('--apply')
const limitArg = process.argv.find((a, i, arr) => arr[i - 1] === '--limit')
const limit = limitArg ? Number(limitArg) : Infinity

const SEED_USERNAMES = [
  'amelia_ruiz',
  'camila_v',
  'ines_mora',
  'lucia_cdmx',
  'mateo_g',
  'noah_p',
  'rafa_ortiz',
  'santi_bl',
  'tomas_rey',
  'vale_mx',
]

function loadEnv(path) {
  const env = {}
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trimStart().startsWith('#')) continue
    const i = line.indexOf('=')
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return env
}

function deterministicUUID(seed) {
  const bytes = crypto.createHash('sha256').update(seed).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
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
  'restaurante', 'restaurant', 'cafe', 'bar', 'the', 'de', 'la', 'el', 'los', 'las',
  'del', 'and', 'cdmx', 'mexico', 'suc', 'sucursal', 'mx',
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

function titleFromBody(body) {
  const collapsed = body
    .trim()
    .replace(/\s+/g, ' ')
  if (collapsed.length <= 120) return collapsed
  return collapsed.slice(0, 119) + '…'
}

function clampBody(text, max = 900) {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  return t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'
}

function loadRawLatest(dir) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.includes('checkpoint')).sort()
    if (!files.length) return []
    return JSON.parse(fs.readFileSync(join(dir, files[files.length - 1]), 'utf8'))
  } catch {
    return []
  }
}

/** @returns {Map<string, {name:string, sources: object[]}>} keyed by normalized name */
function buildReviewIndex() {
  const byName = new Map()

  const add = (name, entry) => {
    if (!name) return
    const key = norm(name)
    if (!key) return
    const cur = byName.get(key) || { name, sources: [] }
    cur.sources.push(entry)
    byName.set(key, cur)
    // also first significant token key for short brands
    const toks = [...tokens(name)]
    if (toks.length === 1) {
      const k2 = toks[0]
      if (!byName.has(k2)) byName.set(k2, cur)
    }
  }

  for (const r of loadRawLatest('data/raw/michelin')) {
    const review = r.payload?.review || r.payload?.raw?.review
    if (!review || String(review).length < 40) continue
    add(r.name || r.payload?.name, {
      source: 'michelin',
      text: String(review).trim(),
      cuisine: r.payload?.cuisine || null,
      distinction: r.payload?.distinction || null,
      stars: r.payload?.michelinStars ?? null,
      chef: r.payload?.chef || null,
    })
  }

  for (const r of loadRawLatest('data/raw/opentable')) {
    const tr = r.payload?.topReview
    const text = typeof tr === 'string' ? tr : tr?.text
    if (!text || String(text).length < 20) continue
    add(r.name, {
      source: 'opentable',
      text: String(text).trim(),
      rating: tr?.rating?.overall ?? r.payload?.rating ?? null,
      dined: tr?.dinedDateTime || null,
    })
  }

  // Resy short blurbs if any in local sqlite
  try {
    const local = new DatabaseSync('data/local_db/cdmx_local.sqlite', { readonly: true })
    for (const row of local.prepare("SELECT payload FROM source_records WHERE source = 'resy'").all()) {
      try {
        const p = JSON.parse(row.payload)
        const name = p.name
        const bits = []
        if (p.raw?.description) bits.push(String(p.raw.description))
        if (Array.isArray(p.collections)) bits.push(p.collections.map((c) => c.name || c).filter(Boolean).join(', '))
        if (bits.join(' ').length > 30) {
          add(name, { source: 'resy', text: bits.join(' · ').slice(0, 600), cuisine: p.cuisine || p.cuisines?.[0] })
        }
      } catch { /* */ }
    }
  } catch { /* optional */ }

  return byName
}

function findSources(restaurantName, index) {
  const key = norm(restaurantName)
  if (index.has(key)) return index.get(key).sources
  // fuzzy + substring (e.g. "Porfirio's" ↔ "Porfirio's - Polanco", "Máximo" ↔ "Maximo")
  let best = null
  let bestScore = 0
  for (const [, v] of index) {
    const cand = v.name || ''
    let score = jaccard(restaurantName, cand)
    const a = norm(restaurantName)
    const b = norm(cand)
    if (a && b && (a === b || a.includes(b) || b.includes(a))) {
      score = Math.max(score, 0.85)
    }
    // accent-insensitive exact after stripping branch suffixes
    const strip = (s) => norm(s).replace(/\s*-\s*.+$/, '').replace(/\s+(polanco|roma|condesa|juarez|centro|coyoacan|satelite|napoles).*$/, '')
    if (strip(restaurantName) && strip(restaurantName) === strip(cand)) {
      score = Math.max(score, 0.9)
    }
    if (score > bestScore) {
      bestScore = score
      best = v
    }
  }
  if (best && bestScore >= 0.68) return best.sources
  return []
}

/** Turn source material into English community field notes (specific, not bateau). */
function craftFromSources(restaurant, sources) {
  const name = restaurant.name
  const area = restaurant.colonia || restaurant.alcaldia
  const posts = []

  const michelin = sources.find((s) => s.source === 'michelin')
  const opentable = sources.filter((s) => s.source === 'opentable')
  const resy = sources.find((s) => s.source === 'resy')

  if (michelin) {
    const snippet = michelin.text
      .replace(/\s+/g, ' ')
      .slice(0, 520)
    // Community voice: cite the concrete detail, don't paste the whole guide.
    posts.push({
      role: 'root',
      body: clampBody(
        `Recent read on ${name}${area ? ` (${area})` : ''}: ${snippet}` +
          (snippet.endsWith('.') ? '' : '.') +
          (michelin.chef ? ` Chef: ${michelin.chef}.` : '') +
          ' Worth going for the room and the cooking, not just the badge.',
      ),
    })
    posts.push({
      role: 'reply',
      body: clampBody(
        michelin.stars
          ? `Agreed on the cooking. The Michelin mark is real, but the useful part is how tightly they run service on a busy night — less pageantry than people expect.`
          : `The useful takeaway for me is the booking friction and the room. If you go, leave slack in the evening — it is not a quick in-and-out.`,
      ),
    })
  }

  for (const ot of opentable.slice(0, 2)) {
    const quote = ot.text.replace(/\s+/g, ' ').trim()
    // Keep the diner's dish-level specificity (often Spanish) — that is what feels real.
    posts.push({
      role: posts.some((p) => p.role === 'root') ? 'reply' : 'root',
      body: clampBody(
        posts.some((p) => p.role === 'root')
          ? `Same table energy here: “${quote}” — that is the kind of detail I want on this thread.`
          : `At ${name} recently: ${quote}`,
      ),
    })
  }

  if (!posts.length && resy) {
    posts.push({
      role: 'root',
      body: clampBody(
        `${name}${area ? ` in ${area}` : ''}: ${resy.text}. Curious if anyone has a current order shortlist that matches that description.`,
      ),
    })
  }

  // Ensure at least one root
  if (!posts.some((p) => p.role === 'root') && posts.length) {
    posts[0].role = 'root'
  }

  return posts.slice(0, 4)
}

function craftFallback(restaurant, index) {
  const name = restaurant.name
  const area = restaurant.colonia || restaurant.alcaldia || 'CDMX'
  const cuisine = restaurant.cuisine_key || restaurant.michelin_cuisine || restaurant.opentable_cuisine
  const rating = restaurant.rating
  const stars = restaurant.michelin_stars
  const bib = restaurant.bib_gourmand
  const i = hash(`${restaurant.id}:fallback`) % 8

  const roots = [
    `Went to ${name} in ${area} last week. Looking for a current shortlist: what is actually worth ordering on a first visit, and what would you skip?`,
    `${name} (${area})${cuisine ? ` — ${String(cuisine).replace(/_/g, ' ')}` : ''}. Room was busier than expected. Anyone have a recent read on whether lunch is calmer than dinner?`,
    `Practical thread for ${name}: reservation difficulty right now, and whether a walk-in at the bar is realistic on a weekday.`,
    `Just left ${name}. Food was solid${rating ? ` (the room matches the ${Number(rating).toFixed(1)} vibe people talk about)` : ''}, but I want a second opinion on portion size if you are two people sharing.`,
    `For ${name} in ${area}: is the move to share several plates or go à la carte? Building a useful first-timer order.`,
    `${name}${stars ? ` (Michelin ${stars}★)` : bib ? ' (Bib Gourmand)' : ''}. Badge aside — what plate made you want to come back?`,
    `Quiet question about ${name}: how loud is the room for a real conversation, and is there a better night of the week?`,
    `Value check on ${name} (${area}). Rough spend per person with a drink, and whether anything felt overpriced once it arrived.`,
  ]

  const replies = [
    `I would go early if you care about the room. Once it fills, service stays friendly but you lose the calm version of the place.`,
    `Shared plates worked better for us than individual mains. Ask them what is actually coming out strong that day rather than chasing the menu photos.`,
    `Walk-in at the bar was fine on a Tuesday; Friday was a different story. Book if it is your only night in the city.`,
    `Portion-wise it is generous if you share. Two people can do three plates + something sweet without feeling reckless.`,
    `Noise is medium-high after 8. Fine for friends, less ideal if you need a soft conversation.`,
    `I would skip the most Instagrammed plate and double down on whatever the kitchen is proud of that week — ask.`,
  ]

  return [
    { role: 'root', body: clampBody(roots[i]) },
    { role: 'reply', body: clampBody(replies[i % replies.length]) },
    ...(i % 3 === 0
      ? [{ role: 'reply', body: clampBody(replies[(i + 2) % replies.length]) }]
      : []),
  ]
}

function hash(s) {
  return crypto.createHash('sha1').update(s).digest().readUInt32BE(0)
}

function isoAt(restaurantIndex, slot) {
  // Spread over ~18 days so New/Hot look alive
  const minutesAgo = ((restaurantIndex * 23 + slot * 11) % (18 * 24 * 60)) + slot * 37
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

function dayAt(restaurantIndex) {
  const daysAgo = (restaurantIndex * 3) % 21
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

async function upsertBatches(sb, table, rows, options, batchSize = 200) {
  let written = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await sb.from(table).upsert(batch, options)
    if (error) throw new Error(`${table}: ${error.message}`)
    written += batch.length
    process.stdout.write(`\r${table}: ${written}/${rows.length}`)
  }
  process.stdout.write('\n')
}

async function main() {
  if (!fs.existsSync(ENV_PATH)) throw new Error('Missing .env.staging.local')
  const env = loadEnv(ENV_PATH)
  const sb = createClient(env.STAGING_SUPABASE_URL, env.STAGING_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  const index = buildReviewIndex()
  console.log(`Review index entries: ${index.size}`)

  let restaurants = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('app_catalogue')
      .select('id,name,colonia,alcaldia,cuisine_key,michelin_cuisine,opentable_cuisine,rating,michelin_stars,bib_gourmand,cover_url')
      .order('name')
      .range(from, from + 999)
    if (error) throw error
    restaurants.push(...data)
    if (data.length < 1000) break
  }
  if (Number.isFinite(limit)) restaurants = restaurants.slice(0, limit)
  console.log(`App catalogue targets: ${restaurants.length}`)

  const { data: seedProfiles, error: pErr } = await sb
    .from('profiles')
    .select('id,username')
    .in('username', SEED_USERNAMES)
  if (pErr) throw pErr
  if ((seedProfiles || []).length < 5) {
    throw new Error(`Expected seed profiles, found ${(seedProfiles || []).length}. Run the older nested seed once or create demo authors.`)
  }
  const authors = seedProfiles
  const seedIds = authors.map((a) => a.id)

  // Stats: how many restaurants match real source text
  let withSource = 0
  const planned = []
  for (const [ri, restaurant] of restaurants.entries()) {
    const sources = findSources(restaurant.name, index)
    const pieces = sources.length ? craftFromSources(restaurant, sources) : craftFallback(restaurant)
    if (sources.length) withSource++
    if (!pieces.some((p) => p.role === 'root')) {
      pieces.unshift({ role: 'root', body: craftFallback(restaurant)[0].body })
    }
    planned.push({ restaurant, pieces, sources: sources.map((s) => s.source), ri })
  }
  console.log(`Restaurants with Michelin/OT/Resy match: ${withSource}/${restaurants.length}`)
  console.log(`Sample grounded:`, planned.filter((p) => p.sources.length).slice(0, 3).map((p) => ({
    name: p.restaurant.name,
    sources: p.sources,
    body: p.pieces[0].body.slice(0, 120),
  })))

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to replace seed conversations + attach covers.')
    return
  }

  // 1) Delete existing seed-authored dispatches (cascade media/reactions)
  console.log('Deleting previous seed dispatches…')
  // PostgREST delete with in() can hit URL limits — batch
  for (let i = 0; i < seedIds.length; i++) {
    const { error, count } = await sb
      .from('dispatches')
      .delete({ count: 'exact' })
      .eq('author_id', seedIds[i])
    if (error) throw error
    console.log(`  deleted for ${authors[i].username}: ${count}`)
  }

  // 2) Build new rows
  const roots = []
  const replies = []
  const media = []
  const reactions = []

  for (const { restaurant, pieces, ri } of planned) {
    const rootPieces = pieces.filter((p) => p.role === 'root')
    const replyPieces = pieces.filter((p) => p.role === 'reply')
    // Force exactly one root per restaurant for cleaner feed density; extra roots become replies if needed
    const rootBody = rootPieces[0]?.body || craftFallback(restaurant)[0].body
    const rootId = deterministicUUID(`realistic-demo-v2:${restaurant.id}:root`)
    const authorRoot = authors[(ri * 3) % authors.length]
    const createdRoot = isoAt(ri, 0)

    const rootRow = {
      id: rootId,
      author_id: authorRoot.id,
      restaurant_id: restaurant.id,
      restaurant_name: restaurant.name,
      restaurant_area: restaurant.colonia || restaurant.alcaldia || null,
      title: titleFromBody(rootBody),
      body: rootBody.length >= 20 ? rootBody : `${rootBody} Worth a look if you are nearby.`,
      visited_on: dayAt(ri),
      kind: 'field_note',
      parent_id: null,
      root_id: rootId,
      depth: 0,
      created_at: createdRoot,
      updated_at: createdRoot,
    }
    roots.push(rootRow)

    if (restaurant.cover_url) {
      media.push({
        dispatch_id: rootId,
        public_url: restaurant.cover_url,
        sort_order: 0,
      })
    }

    const allReplies = [...replyPieces, ...rootPieces.slice(1).map((p) => ({ ...p, role: 'reply' }))].slice(0, 2)
    // Flat replies under the root (depth 1) — easier to read in the app.
    allReplies.forEach((piece, slot) => {
      const id = deterministicUUID(`realistic-demo-v2:${restaurant.id}:r${slot}`)
      const author = authors[(ri * 3 + slot + 1) % authors.length]
      const created = isoAt(ri, slot + 1)
      const body = piece.body.length >= 2 ? piece.body : 'Same.'
      replies.push({
        id,
        author_id: author.id,
        restaurant_id: restaurant.id,
        restaurant_name: restaurant.name,
        restaurant_area: restaurant.colonia || restaurant.alcaldia || null,
        title: null,
        body,
        visited_on: dayAt(ri),
        kind: 'field_note',
        parent_id: rootId,
        root_id: rootId,
        depth: 1,
        created_at: created,
        updated_at: created,
      })
    })

    // a few helpful votes
    const voteN = (ri + rootBody.length) % 4
    for (let v = 0; v < voteN; v++) {
      const voter = authors[(ri + v + 2) % authors.length]
      if (voter.id === authorRoot.id) continue
      reactions.push({
        dispatch_id: rootId,
        user_id: voter.id,
        type: 'helpful',
        created_at: new Date(new Date(createdRoot).getTime() + (v + 1) * 120_000).toISOString(),
      })
    }
  }

  console.log(`Inserting ${roots.length} roots, ${replies.length} replies, ${media.length} media, ${reactions.length} reactions…`)
  await upsertBatches(sb, 'dispatches', roots, { onConflict: 'id' })
  await upsertBatches(sb, 'dispatches', replies, { onConflict: 'id' })

  if (media.length) {
    for (let i = 0; i < media.length; i += 200) {
      const batch = media.slice(i, i + 200)
      const { error } = await sb.from('dispatch_media').insert(batch)
      if (error) throw new Error(`dispatch_media: ${error.message}`)
      process.stdout.write(`\rdispatch_media: ${Math.min(i + 200, media.length)}/${media.length}`)
    }
    process.stdout.write('\n')
  }

  if (reactions.length) {
    await upsertBatches(sb, 'reactions', reactions, {
      onConflict: 'dispatch_id,user_id,type',
      ignoreDuplicates: true,
    })
  }

  const { count: total } = await sb.from('dispatches').select('*', { count: 'exact', head: true })
  const { count: withMedia } = await sb.from('dispatch_media').select('*', { count: 'exact', head: true }).not('public_url', 'is', null)
  console.log(JSON.stringify({
    restaurants: restaurants.length,
    groundedInReviews: withSource,
    roots: roots.length,
    replies: replies.length,
    mediaAttached: media.length,
    totalDispatchesNow: total,
    dispatchMediaWithUrl: withMedia,
  }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
