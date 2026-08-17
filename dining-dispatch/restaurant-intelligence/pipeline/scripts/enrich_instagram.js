// Enrichissement Instagram pour les restaurants sans site web fonctionnel.
// Genere des handles candidats depuis le nom du restaurant et les teste sur Instagram.
// Instagram renvoie 200 pour un profil existant, 404 pour inexistant.
// Produit : data/mvp_instagram_candidates.json
// Lancer avec --write pour appliquer les matchs >= seuil de confiance.

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
const MIN_CONFIDENCE = 0.80
const DELAY = 800   // ms entre requetes pour eviter le rate-limit Instagram
const OUTPUT = resolve('data/mvp_instagram_candidates.json')

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

// ─── Normalisation nom → handles candidats ────────────────────────────────────

function normalizeToken(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // accents
    .replace(/[^a-z0-9]/g, '')                          // tout sauf alphanumerique
}

function generateHandles(name) {
  const raw = String(name).trim()

  // Nettoyer les prefixes generiques
  const cleaned = raw
    .replace(/^(RESTAURANTE?|CAFETERIA|CAFE|BAR|TAQUERIA|PIZZERIA|COCINA|REST\.?)\s+/i, '')
    .trim()

  const base = normalizeToken(cleaned)
  const full = normalizeToken(raw)

  const suffixes = ['', 'mx', 'cdmx', 'roma', 'condesa', 'oficial', 'restaurant', 'menu']

  const handles = new Set()

  // Variations sur le nom nettoye
  for (const s of suffixes) {
    handles.add(base + s)
  }

  // Variation sur le nom complet (sans prefixe type RESTAURANTE)
  handles.add(full)

  // Si le nom a plusieurs mots : premiere lettre de chaque mot
  const words = cleaned.split(/\s+/).map(normalizeToken).filter(Boolean)
  if (words.length >= 2 && words.length <= 4) {
    // Concatenation des mots principaux
    handles.add(words.join(''))
    handles.add(words.join('.'))
    handles.add(words.join('_'))
    // Premiers mots seulement
    if (words.length >= 3) handles.add(words.slice(0, 2).join(''))
  }

  // Filtres : Instagram n'accepte pas les handles vides ou > 30 chars
  return [...handles].filter(h => h.length >= 3 && h.length <= 30)
}

// ─── Test Instagram ────────────────────────────────────────────────────────────

async function testInstagram(handle) {
  const url = `https://www.instagram.com/${handle}/`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'es-MX,es;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
      },
      redirect: 'follow',
      signal: controller.signal,
    })

    // 200 = profil existe | 404 = inexistant | 302 vers login = existe mais prive
    const exists = res.status === 200 || (res.status === 302 && res.headers.get('location')?.includes('login'))
    return { exists, status: res.status, handle, url }
  } catch (e) {
    return { exists: false, status: null, handle, url, error: e.message }
  } finally {
    clearTimeout(timer)
  }
}

// Score de confiance : handle proche du nom = plus de confiance
function handleConfidence(handle, restaurantName) {
  const normName = normalizeToken(restaurantName)
  const normCleaned = normalizeToken(
    restaurantName.replace(/^(RESTAURANTE?|CAFETERIA|CAFE|BAR|TAQUERIA|PIZZERIA|COCINA|REST\.?)\s+/i, '')
  )

  // Correspondance exacte = confiance maximale
  if (handle === normName || handle === normCleaned) return 0.95
  // Handle contient le nom nettoye completement
  if (handle.includes(normCleaned) && normCleaned.length >= 4) return 0.88
  // Nom contient le handle completement
  if (normCleaned.includes(handle) && handle.length >= 5) return 0.82
  // Overlap partiel
  const overlap = [...handle].filter(c => normCleaned.includes(c)).length
  return Math.min(0.50 + (overlap / normCleaned.length) * 0.3, 0.78)
}

// ─── Verifier les osm_id existants pour Instagram dans Supabase ───────────────

async function getOsmInstagramFromDB(restaurantId) {
  // Certains restaurants ont deja un osm_id — verifier si OSM a un contact:instagram
  const { data } = await supabase
    .from('restaurants')
    .select('instagram')
    .eq('id', restaurantId)
    .single()
  return data?.instagram || null
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const retryData = JSON.parse(await readFile(resolve('data/mvp_retry_aggressive.json'), 'utf8'))
  const dead = retryData.filter(r => r.status === 'dead')

  console.log(`Enrichissement Instagram : ${dead.length} restaurants sans site`)
  console.log(`Confiance minimum pour ecriture : ${MIN_CONFIDENCE}`)
  console.log(`Delai entre requetes : ${DELAY}ms`)
  console.log('')

  const results = []
  let found = 0
  let alreadyHas = 0

  for (let i = 0; i < dead.length; i++) {
    const entry = dead[i]

    // Verifier si instagram deja en base (enrichi par OSM ou crawl)
    const existing = await getOsmInstagramFromDB(entry.restaurantId)
    if (existing) {
      console.log(`[${i + 1}/${dead.length}] ${entry.restaurantName.slice(0, 40)} → deja en base: ${existing}`)
      alreadyHas++
      continue
    }

    const handles = generateHandles(entry.restaurantName)
    process.stdout.write(`[${i + 1}/${dead.length}] ${entry.restaurantName.slice(0, 40).padEnd(40)} `)

    let match = null

    for (const handle of handles) {
      await new Promise(r => setTimeout(r, DELAY))
      const result = await testInstagram(handle)

      if (result.exists) {
        const confidence = handleConfidence(handle, entry.restaurantName)
        if (!match || confidence > match.confidence) {
          match = { handle, confidence, url: result.url, status: result.status }
        }
        // Si confiance tres haute, pas besoin de tester les autres
        if (confidence >= 0.93) break
      }
    }

    if (match) {
      console.log(`MATCH @${match.handle} (confiance: ${match.confidence.toFixed(2)})`)
      found++
      results.push({
        restaurantId: entry.restaurantId,
        restaurantName: entry.restaurantName,
        instagramHandle: match.handle,
        instagramUrl: `https://www.instagram.com/${match.handle}/`,
        confidence: match.confidence,
        originalDeadUrl: entry.originalUrl,
        status: 'found',
      })
    } else {
      console.log(`non trouve`)
      results.push({
        restaurantId: entry.restaurantId,
        restaurantName: entry.restaurantName,
        confidence: 0,
        originalDeadUrl: entry.originalUrl,
        status: 'not_found',
      })
    }
  }

  await writeFile(OUTPUT, JSON.stringify(results, null, 2))

  const safe = results.filter(r => r.confidence >= MIN_CONFIDENCE)
  console.log(`\nTermine.`)
  console.log(`Deja en base : ${alreadyHas}`)
  console.log(`Instagram trouves : ${found} / ${dead.length - alreadyHas}`)
  console.log(`Ecriture sure (>= ${MIN_CONFIDENCE}) : ${safe.length}`)
  console.log(`Export : ${OUTPUT}`)

  if (!write) {
    console.log(`\nRelancer avec --write pour appliquer les ${safe.length} matchs surs.`)
    return
  }

  console.log(`\nApplication de ${safe.length} profils Instagram...`)
  let applied = 0
  for (const r of safe) {
    const { error } = await supabase
      .from('restaurants')
      .update({ instagram: r.instagramUrl })
      .eq('id', r.restaurantId)

    if (error) {
      console.error(`  ERREUR ${r.restaurantName}: ${error.message}`)
    } else {
      console.log(`  OK: ${r.restaurantName} → @${r.instagramHandle}`)
      applied++
    }
  }
  console.log(`\nApplique: ${applied}`)
}

main().catch(e => { console.error(e.message); process.exit(1) })
