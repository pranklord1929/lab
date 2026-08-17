// Pousse les menus UberEats (deja structures : sections → plats → prix) vers
// menu_documents + menu_items, pour les records matches par l'entity resolution.
//
// Prerequis : npm run ingest -- --source=ubereats --date=<date> a deja tourne.
// Idempotent : saute les documents qui ont deja des menu_items.
//
// Usage: node scripts/import_ubereats_menus.js [--date=YYYY-MM-DD] [--dry]

import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const date = args.find(a => a.startsWith('--date='))?.split('=')[1] || new Date().toISOString().slice(0, 10)

async function fetchMatchedRecords() {
  const rows = []
  const pageSize = 200
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('source_records')
      .select('source_id, matched_restaurant_id, payload')
      .eq('source', 'ubereats')
      .eq('scrape_date', date)
      .not('matched_restaurant_id', 'is', null)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`Supabase: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows.filter(r => Array.isArray(r.payload?.menu) && r.payload.menu.length > 0)
}

async function upsertMenuDocument(restaurantId, sourceUrl, menu) {
  const rawText = menu
    .map(s => `## ${s.name}\n` + s.items.map(i =>
      `${i.name}${i.price != null ? ` — $${i.price} MXN` : ''}${i.description ? `\n  ${i.description}` : ''}`
    ).join('\n'))
    .join('\n\n')

  const { data, error } = await supabase
    .from('menu_documents')
    .upsert({
      restaurant_id: restaurantId,
      source_url: sourceUrl,
      file_type: 'html',
      raw_text: rawText.slice(0, 200000),
      langue: 'es',
      confidence_score: 0.95,
      extraction_method: 'ubereats_api',
      statut: 'extracted',
      last_checked_at: new Date().toISOString(),
    }, { onConflict: 'restaurant_id,source_url' })
    .select('id')
    .single()
  if (error) throw new Error(`menu_documents: ${error.message}`)
  return data.id
}

async function insertItems(restaurantId, documentId, menu) {
  const { count } = await supabase
    .from('menu_items')
    .select('id', { count: 'exact', head: true })
    .eq('menu_document_id', documentId)
  if (count > 0) return 0 // deja importe

  const rows = []
  for (const section of menu) {
    for (const item of section.items) {
      if (!item.name || item.name.length < 2) continue
      rows.push({
        restaurant_id: restaurantId,
        menu_document_id: documentId,
        nom: item.name.slice(0, 200),
        description: item.description?.slice(0, 1000) || null,
        categorie: section.name?.slice(0, 100) || null,
        prix: Number.isFinite(item.price) && item.price >= 5 && item.price <= 20000 ? item.price : null,
        devise: 'MXN',
      })
    }
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from('menu_items').insert(rows.slice(i, i + 200))
    if (error) throw new Error(`menu_items: ${error.message}`)
  }
  return rows.length
}

async function main() {
  console.log(`Mode: ${dry ? 'dry-run' : 'ecriture Supabase'} | date: ${date}`)
  const records = await fetchMatchedRecords()
  console.log(`Records UberEats matches avec menu: ${records.length}`)

  let docs = 0
  let items = 0
  for (const rec of records) {
    const url = rec.payload.actionUrl || `https://www.ubereats.com/store/${rec.source_id}`
    if (dry) {
      const n = rec.payload.menu.reduce((acc, s) => acc + s.items.length, 0)
      console.log(`  ${rec.payload.name} → ${rec.payload.menu.length} sections, ${n} plats`)
      continue
    }
    try {
      const docId = await upsertMenuDocument(rec.matched_restaurant_id, url, rec.payload.menu)
      const n = await insertItems(rec.matched_restaurant_id, docId, rec.payload.menu)
      docs++
      items += n
    } catch (e) {
      console.log(`  [erreur] ${rec.payload.name}: ${String(e.message).slice(0, 120)}`)
    }
  }

  console.log(`\nTermine. Documents: ${docs} | plats inseres: ${items}`)
}

main().catch(e => { console.error(e); process.exit(1) })
