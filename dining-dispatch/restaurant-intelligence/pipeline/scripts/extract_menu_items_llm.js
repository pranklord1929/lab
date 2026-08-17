// Extraction LLM des plats/prix depuis menu_documents.raw_text vers menu_items.
// Remplace la V1 a regles (extract_menu_items.js) qui rate les menus mal structures.
//
// Le modele (Claude Opus 4.8) recoit le texte brut du menu et renvoie un JSON
// garanti conforme au schema (structured outputs) : nom, description, categorie,
// prix MXN. On ne traite que les documents sans menu_items existants.
//
// Usage:
//   node scripts/extract_menu_items_llm.js --dry --limit=3    → test sans ecrire
//   node scripts/extract_menu_items_llm.js --limit=20         → petit batch
//   node scripts/extract_menu_items_llm.js                    → tous les docs restants

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const anthropic = new Anthropic() // ANTHROPIC_API_KEY lu depuis l'environnement

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const limitArg = args.find(a => a.startsWith('--limit='))
const limit = limitArg ? Number(limitArg.split('=')[1]) : null

const MODEL = 'claude-opus-4-8'
const CONCURRENCY = 3
const MAX_TEXT_CHARS = 25000

const MENU_SCHEMA = {
  type: 'object',
  properties: {
    is_menu: {
      type: 'boolean',
      description: 'true si le texte contient bien un menu de restaurant (plats/boissons), false si c est une page sans contenu menu (mentions legales, page d accueil, etc.)',
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nom: { type: 'string', description: 'Nom du plat ou de la boisson, tel qu ecrit sur le menu' },
          description: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Description du plat si presente, sinon null',
          },
          categorie: {
            anyOf: [{ type: 'string' }, { type: 'null' }],
            description: 'Section du menu (ex: Entradas, Platos fuertes, Postres, Bebidas, Vinos), sinon null',
          },
          prix: {
            anyOf: [{ type: 'number' }, { type: 'null' }],
            description: 'Prix en pesos mexicains (MXN), nombre seul, null si non affiche',
          },
        },
        required: ['nom', 'description', 'categorie', 'prix'],
        additionalProperties: false,
      },
    },
  },
  required: ['is_menu', 'items'],
  additionalProperties: false,
}

const SYSTEM_PROMPT = `Tu extrais des plats et prix depuis le texte brut de menus de restaurants de Mexico City.
Le texte vient de sites web ou de PDF, il peut contenir du bruit (navigation, cookies, mentions legales) : ignore-le.
Regles :
- Un item = un plat, une boisson ou un produit vendu, avec son nom exact tel qu'ecrit.
- Les prix sont en pesos mexicains. "$120", "120", "$1,250.00" → 120, 120, 1250. Ignore les prix manifestement hors menu (annees, adresses, codes postaux).
- Si un plat a plusieurs tailles/prix, cree un item par variante en suffixant le nom (ex: "Margarita (jarra)").
- N'invente rien : si le prix n'est pas affiche, prix = null.
- Ignore les doublons exacts.`

async function fetchDocs() {
  const { data: existing } = await supabase
    .from('menu_items')
    .select('menu_document_id')
    .not('menu_document_id', 'is', null)
  const done = new Set((existing || []).map(r => r.menu_document_id))

  const rows = []
  const pageSize = 500
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('menu_documents')
      .select('id, restaurant_id, raw_text')
      .eq('statut', 'extracted')
      .not('raw_text', 'is', null)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`Supabase: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }

  const remaining = rows.filter(d => !done.has(d.id) && d.raw_text.length > 150)
  return limit ? remaining.slice(0, limit) : remaining
}

async function extractDoc(doc) {
  const text = doc.raw_text.slice(0, MAX_TEXT_CHARS)
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: 'json_schema', schema: MENU_SCHEMA },
      effort: 'low',
    },
    messages: [{ role: 'user', content: `Texte brut du menu :\n\n${text}` }],
  })

  const usage = response.usage
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
    return { items: [], usage, problem: response.stop_reason }
  }
  const block = response.content.find(b => b.type === 'text')
  const parsed = JSON.parse(block.text)
  if (!parsed.is_menu) return { items: [], usage, problem: 'pas_un_menu' }

  const items = (parsed.items || []).filter(it =>
    it.nom && it.nom.length >= 2 && it.nom.length <= 120
    && (it.prix === null || (it.prix >= 5 && it.prix <= 20000))
  )
  return { items, usage }
}

async function insertItems(doc, items) {
  const rows = items.map(it => ({
    restaurant_id: doc.restaurant_id,
    menu_document_id: doc.id,
    nom: it.nom,
    description: it.description,
    categorie: it.categorie,
    prix: it.prix,
    devise: 'MXN',
  }))
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('menu_items').insert(rows.slice(i, i + 200))
    if (error) throw new Error(`insert menu_items: ${error.message}`)
  }
}

async function main() {
  console.log(`Mode: ${dry ? 'dry-run (aucune ecriture)' : 'ecriture Supabase'} | modele: ${MODEL}`)
  const docs = await fetchDocs()
  console.log(`Documents a traiter: ${docs.length}`)

  const totals = { docs_ok: 0, docs_vides: 0, items: 0, erreurs: 0, in_tokens: 0, out_tokens: 0 }
  let done = 0
  const queue = [...docs]

  async function worker() {
    while (queue.length > 0) {
      const doc = queue.shift()
      try {
        const { items, usage, problem } = await extractDoc(doc)
        totals.in_tokens += usage.input_tokens
        totals.out_tokens += usage.output_tokens

        if (items.length === 0) {
          totals.docs_vides++
          if (dry) console.log(`  [vide${problem ? '/' + problem : ''}] doc ${doc.id.slice(0, 8)}`)
        } else {
          totals.docs_ok++
          totals.items += items.length
          if (dry) {
            console.log(`  [ok] doc ${doc.id.slice(0, 8)} → ${items.length} items`)
            items.slice(0, 5).forEach(it => console.log(`     ${String(it.prix ?? '—').padStart(6)} MXN  ${it.nom}${it.categorie ? '  [' + it.categorie + ']' : ''}`))
          } else {
            await insertItems(doc, items)
          }
        }
      } catch (e) {
        totals.erreurs++
        console.log(`  [erreur] doc ${doc.id.slice(0, 8)}: ${String(e.message).slice(0, 120)}`)
      }
      done++
      if (done % 20 === 0) {
        const cost = (totals.in_tokens * 5 + totals.out_tokens * 25) / 1e6
        console.log(`${done}/${docs.length} | docs avec items ${totals.docs_ok} | items ${totals.items} | cout ~$${cost.toFixed(2)}`)
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const cost = (totals.in_tokens * 5 + totals.out_tokens * 25) / 1e6
  console.log('\nTermine.')
  console.log(JSON.stringify(totals, null, 2))
  console.log(`Cout API estime: $${cost.toFixed(2)} (input $5/M, output $25/M)`)
}

main().catch(e => { console.error(e); process.exit(1) })
