// Extract menu_items from menu_documents via rule-based parser.
//
// Stratégie : on cherche des paires (nom item, prix MXN) dans le raw_text.
// Les sites de restos CDMX exposent les prix dans des formats standards :
//   "$120.00", "$120", "120 MXN", "MXN 120", "120 pesos", "$1,250"
// Et l'item est ce qui précède (séquence de mots avant le prix).
//
// Pour éviter le bruit (mots vides, fragments de phrase), on garde
// seulement les paires où le nom fait 3-80 chars et le prix ∈ [10, 5000].
//
// Usage :
//   node scripts/extract_menu_items.js --dry              # smoke test 3 docs
//   node scripts/extract_menu_items.js --dry --limit=10   # 10 docs
//   node scripts/extract_menu_items.js                    # full batch + push DB

import { supabase } from './lib/supabase.js'

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, v] = a.slice(2).split('=')
    return [k, v ?? true]
  })
)
const DRY = !!args.dry
const LIMIT = args.limit ? parseInt(args.limit, 10) : null
const FORCE = !!args.force

// ─── PARSER ──────────────────────────────────────────────────────────────────

// Regex prix : capture la valeur numérique
const PRICE_RE = /(?:MXN\s*\$?\s*|\$\s*|MX\$?\s*)?(\d{2,4}(?:[.,]\d{2})?)\s*(?:MXN|pesos|mxn|MX\$)?/

// Normalisation : enlève HTML entities + collapse whitespace + trim
function cleanText(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;?/g, ' ')         // entities numériques avec ou sans ;
    .replace(/&[a-z]+;?/g, ' ')       // entities nommées
    .replace(/<[^>]+>/g, ' ')
    .replace(/[…]/g, ' ')        // ellipsis unicode
    .replace(/\s+/g, ' ')
    .trim()
}

// Détecte un nom-titre plausible (CapitalCase, pas de parenthèses,
// pas de digit, 1-6 mots). Sert à privilégier les titres sur les
// fragments de description.
function looksLikeTitle(s) {
  if (!s) return false
  const t = s.trim()
  if (t.length < 3 || t.length > 60) return false
  if (/[()\[\]{}]/.test(t)) return false
  if (/\d/.test(t)) return false
  const words = t.split(/\s+/)
  if (words.length < 1 || words.length > 6) return false
  // au moins 60% des mots commencent par majuscule
  const cap = words.filter(w => /^[A-ZÁÉÍÓÚÑ]/.test(w)).length
  return (cap / words.length) >= 0.5
}

// Mots vides ou fragments à exclure du début de nom
const NOISY_PREFIX = /^(con|sin|de|del|la|el|los|las|y|o|en|para|al|por|incluye|aplica|válido|menú|menu|carta|nuevo|new|sólo|solo|gratis|promoción|reserva|consulta|tap|click|escoge|ver|ver mas|nuestro|nuestra|nuestros|nuestras|tu|su|the|a|an|of|in|with|for|automated|page|speed|optimizations|fast|site|performance)\s+/i

// Mots qui invalident un "nom" potentiel
const INVALIDATING = /\b(vigencia|válido|aplica|consulta|reserva|promoción|reservation|cookie|política|terms|automated|optimizations|performance|website|whatsapp|teléfono|email|telephone|copyright|©)\b/i

function isLikelyItemName(name) {
  if (!name) return false
  const n = name.trim()
  if (n.length < 3 || n.length > 90) return false
  if (/^\d/.test(n)) return false                       // commence par un chiffre
  if (INVALIDATING.test(n)) return false
  // doit contenir au moins une lettre alpha
  if (!/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(n)) return false
  // ratio de digits trop élevé = probable junk
  const digits = (n.match(/\d/g) || []).length
  if (digits / n.length > 0.4) return false
  // pas que des mots-vides
  if (NOISY_PREFIX.test(n) && n.split(/\s+/).length < 3) return false
  return true
}

function isPlausiblePrice(p) {
  const n = parseFloat(String(p).replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'))
  if (!Number.isFinite(n)) return null
  if (n < 10 || n > 5000) return null
  return Math.round(n * 100) / 100
}

// Le coeur : on scanne le texte, on trouve chaque prix, on récupère
// le segment qui précède jusqu'au prix précédent / début / saut de
// catégorie. Heuristique : item = derniers 1-8 mots avant le prix.
function extractItemsFromText(text) {
  const clean = cleanText(text)
  if (clean.length < 50) return []

  // Trouve toutes les positions de prix dans le texte
  const priceRe = /\$\s*(\d{2,4}(?:[.,]\d{2})?)(?!\d)|\b(\d{2,4}(?:[.,]\d{2})?)\s*(?:MXN|pesos|mxn)\b/gi
  const matches = []
  let m
  while ((m = priceRe.exec(clean))) {
    const raw = m[1] || m[2]
    const price = isPlausiblePrice(raw)
    if (price) matches.push({ index: m.index, length: m[0].length, price })
  }
  if (!matches.length) return []

  // Pour chaque prix, le nom = mots à gauche jusqu'au prix précédent
  // (ou début du doc), tronqué aux derniers 8 mots significatifs.
  const items = []
  let lastEnd = 0
  for (const pm of matches) {
    const between = clean.slice(lastEnd, pm.index).trim()
    lastEnd = pm.index + pm.length

    if (!between) continue
    // Découpe par séparateurs forts
    const segments = between.split(/(?:\s•\s|\s\-\s|\s—\s|\.\s+(?=[A-ZÁÉÍÓÚÑ])|\s\+\s*$|(?<=\))\s+(?=[A-ZÁÉÍÓÚÑ]))/)
    const tail = segments[segments.length - 1].trim()

    // V2 — heuristique titre :
    // 1) chercher dans `tail` une sous-séquence consécutive de 1-6 mots
    //    qui ressemble à un titre (CapitalCase, pas de digit/paren)
    // 2) sinon retomber sur les 6 derniers mots, nettoyés
    const words = tail.split(/\s+/)
    let name = null

    // Scan glissant : on prend la sous-séquence titrée la plus longue
    // à droite (privilégie le titre le plus proche du prix)
    for (let len = Math.min(6, words.length); len >= 1; len--) {
      for (let start = words.length - len; start >= 0; start--) {
        const cand = words.slice(start, start + len).join(' ')
          .replace(/\s*\(?\d+\s*(?:ml|gr|g|oz|cl|kg)\)?$/i, '')
          .replace(/[.,;:]+$/, '')
          .trim()
        if (looksLikeTitle(cand)) { name = cand; break }
      }
      if (name) break
    }

    // Fallback : 6 derniers mots
    if (!name) {
      name = words.slice(-6).join(' ').trim()
      while (NOISY_PREFIX.test(name) && name.split(/\s+/).length > 2) {
        name = name.replace(NOISY_PREFIX, '').trim()
      }
      name = name.replace(/\s*\(?\d+\s*(?:ml|gr|g|oz|cl|kg)\)?$/i, '').trim()
      name = name.replace(/[.,;:()&]+$/, '').trim()
    }

    if (!isLikelyItemName(name)) continue

    items.push({
      nom: name,
      prix: pm.price,
      devise: 'MXN',
      // description / categorie : laissés null en V1 (rule-based limité)
      description: null,
      categorie: null,
    })
  }

  // Déduplication par (nom normalisé + prix)
  const seen = new Map()
  for (const it of items) {
    const key = it.nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '::' + it.prix
    if (!seen.has(key)) seen.set(key, it)
  }
  return [...seen.values()]
}

// ─── EXTRACTION + WRITE ──────────────────────────────────────────────────────

async function fetchDocs() {
  let q = supabase
    .from('menu_documents')
    .select('id, restaurant_id, raw_text')
    .not('raw_text', 'is', null)
  if (!FORCE) {
    // exclu les docs déjà extraits
    const { data: existing } = await supabase
      .from('menu_items').select('menu_document_id').not('menu_document_id', 'is', null)
    const seen = new Set((existing || []).map(r => r.menu_document_id))
    const { data: all } = await q
    const remaining = (all || []).filter(d => !seen.has(d.id) && d.raw_text && d.raw_text.length > 100)
    return LIMIT ? remaining.slice(0, LIMIT) : remaining
  }
  const { data } = await q
  return (LIMIT ? (data || []).slice(0, LIMIT) : (data || [])).filter(d => d.raw_text && d.raw_text.length > 100)
}

async function main() {
  const docs = await fetchDocs()
  console.log(`Mode: ${DRY ? 'DRY-RUN (no write)' : 'WRITE Supabase'}`)
  console.log(`${docs.length} menu_documents à traiter${LIMIT ? ` (limit=${LIMIT})` : ''}`)

  const allItems = []
  const stats = { docs: 0, items: 0, empty: 0, items_per_doc: [] }

  for (const doc of docs) {
    stats.docs++
    const items = extractItemsFromText(doc.raw_text)
    if (!items.length) { stats.empty++; continue }

    stats.items += items.length
    stats.items_per_doc.push(items.length)

    for (const it of items) {
      allItems.push({
        restaurant_id: doc.restaurant_id,
        menu_document_id: doc.id,
        nom: it.nom,
        description: it.description,
        prix: it.prix,
        devise: it.devise,
        categorie: it.categorie,
      })
    }

    if (DRY && stats.docs <= 3) {
      console.log(`\n── doc ${doc.id.slice(0, 8)}… (${items.length} items) ──`)
      items.slice(0, 12).forEach(it => console.log(`  ${it.prix.toString().padStart(7)} MXN  ${it.nom}`))
      if (items.length > 12) console.log(`  … +${items.length - 12} autres`)
    }
  }

  // Stats
  const ipd = stats.items_per_doc.sort((a, b) => a - b)
  const median = ipd.length ? ipd[Math.floor(ipd.length / 2)] : 0
  console.log(`\n=== STATS ===`)
  console.log(`docs processed: ${stats.docs}`)
  console.log(`docs avec items: ${stats.docs - stats.empty}`)
  console.log(`docs vides: ${stats.empty}`)
  console.log(`items total: ${stats.items}`)
  console.log(`items median/doc: ${median}`)
  console.log(`items min/max/doc: ${ipd[0] || 0} / ${ipd[ipd.length - 1] || 0}`)

  // Distribution des prix
  if (allItems.length) {
    const prices = allItems.map(i => i.prix).sort((a, b) => a - b)
    const pctile = p => prices[Math.floor(prices.length * p)]
    console.log(`prix p10/p50/p90: ${pctile(0.1)} / ${pctile(0.5)} / ${pctile(0.9)} MXN`)
  }

  if (DRY) {
    console.log(`\n(dry) ${allItems.length} items prêts à insérer. Pas d'écriture.`)
    return
  }

  // Write par batches de 500
  console.log(`\nÉcriture de ${allItems.length} menu_items dans Supabase…`)
  for (let i = 0; i < allItems.length; i += 500) {
    const batch = allItems.slice(i, i + 500)
    const { error } = await supabase.from('menu_items').insert(batch)
    if (error) { console.error(`batch ${i} error:`, error); process.exit(1) }
    process.stdout.write(`  ${Math.min(i + 500, allItems.length)}/${allItems.length}\r`)
  }
  console.log(`\nFini.`)
}

main().catch(e => { console.error(e); process.exit(1) })
