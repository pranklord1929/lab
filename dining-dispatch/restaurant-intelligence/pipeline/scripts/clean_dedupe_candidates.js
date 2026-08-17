// Nettoie la quarantaine de doublons sans toucher aux restaurants.
// - stale_deleted : un des restaurants a déjà été supprimé par un merge
// - duplicate_candidate : même règle + même paire produite par plusieurs audits
//
// Usage:
//   node scripts/clean_dedupe_candidates.js          # dry-run
//   node scripts/clean_dedupe_candidates.js --apply  # marque les lignes résolues

import 'dotenv/config'
import { supabase } from './lib/supabase.js'

const APPLY = process.argv.includes('--apply')

async function fetchAll(table, select, filter) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(select)
    if (filter) query = filter(query)
    const { data, error } = await query.range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function mark(ids, resolution) {
  const now = new Date().toISOString()
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await supabase
      .from('restaurant_duplicate_candidates')
      .update({ resolved_at: now, resolution })
      .in('id', ids.slice(i, i + 200))
    if (error) throw new Error(`${resolution}: ${error.message}`)
  }
}

async function main() {
  const candidates = await fetchAll(
    'restaurant_duplicate_candidates',
    'id, master_id, duplicate_id, rule, confidence, created_at',
    q => q.is('resolved_at', null),
  )

  const referencedIds = [...new Set(candidates.flatMap(row => [row.master_id, row.duplicate_id]).filter(Boolean))]
  const existing = new Set()
  for (let i = 0; i < referencedIds.length; i += 200) {
    const { data, error } = await supabase
      .from('restaurants').select('id').in('id', referencedIds.slice(i, i + 200))
    if (error) throw new Error(error.message)
    for (const row of data || []) existing.add(row.id)
  }

  const stale = []
  const selfReferences = []
  const duplicates = []
  const keepers = new Map()

  for (const row of candidates) {
    if (!row.master_id || !row.duplicate_id ||
        !existing.has(row.master_id) || !existing.has(row.duplicate_id)) {
      stale.push(row.id)
      continue
    }
    if (row.master_id === row.duplicate_id) {
      selfReferences.push(row.id)
      continue
    }

    const pair = [row.master_id, row.duplicate_id].sort().join(':')
    const key = `${row.rule}:${pair}`
    const previous = keepers.get(key)
    if (!previous) {
      keepers.set(key, row)
      continue
    }

    // Garde la ligne à la confiance la plus forte, puis la plus ancienne.
    const rowConfidence = Number(row.confidence || 0)
    const prevConfidence = Number(previous.confidence || 0)
    const rowWins = rowConfidence > prevConfidence ||
      (rowConfidence === prevConfidence && String(row.created_at) < String(previous.created_at))
    if (rowWins) {
      duplicates.push(previous.id)
      keepers.set(key, row)
    } else {
      duplicates.push(row.id)
    }
  }

  const byRule = {}
  for (const row of keepers.values()) byRule[row.rule] = (byRule[row.rule] || 0) + 1

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    unresolved_before: candidates.length,
    stale_deleted: stale.length,
    self_references: selfReferences.length,
    duplicate_candidates: duplicates.length,
    actionable_unique: keepers.size,
    by_rule: byRule,
  }, null, 2))

  if (!APPLY) return

  await mark(stale, 'stale_deleted')
  await mark(selfReferences, 'superseded_by_merge')
  await mark(duplicates, 'duplicate_candidate')

  await supabase.from('pipeline_events').insert({
    agent_name: 'codex-dedupe-cleaner',
    terminal: 'T4',
    status: 'done',
    task: 'Clean duplicate-candidate quarantine',
    pct: 100,
    records: stale.length + selfReferences.length + duplicates.length,
    notes: `stale=${stale.length}; self_references=${selfReferences.length}; duplicate_candidates=${duplicates.length}; actionable_unique=${keepers.size}`,
  })

  console.log('Quarantaine nettoyée.')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
