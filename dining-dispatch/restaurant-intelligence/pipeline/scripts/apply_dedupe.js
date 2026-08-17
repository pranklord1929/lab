// Cluster and apply validated duplicate merges.
//
// Default mode is dry-run:
//   npm run apply-dedupe -- --dry
//
// Apply mode:
//   npm run apply-dedupe -- --apply
//
// This script now supports name_address clustering by normalized address.

import 'dotenv/config'
import { readFile } from 'fs/promises'
import { supabase } from './lib/supabase.js'
import { normalizeName } from './lib/normalize.js'

const args = new Set(process.argv.slice(2))
const DRY = !args.has('--apply')
const PLAN_FILE = 'data/exports/dedupe_plan.json'
const RULES = (process.argv.find(arg => arg.startsWith('--rules='))?.split('=')[1] || 'name_address')
  .split(',').map(value => value.trim()).filter(Boolean)

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function cleanText(value) {
  if (value == null) return null
  const s = String(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s || null
}

function normalizePostalCode(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return null
  return digits.padStart(5, '0')
}

function normalizedAddressKey(row) {
  const cp = normalizePostalCode(row.cp)
  const streetType = cleanText(row.tipo_vialidad)
  const street = cleanText(row.nom_vialidad)
  const number = cleanText(row.numero_exterior)
  if (!cp || !streetType || !street || !number) return null
  if (/^(ninguno|sin numero|s n|sn|0)$/.test(number)) return null
  return [cp, streetType, street, number].join('|')
}

const GENERIC_NAMES = new Set([
  'barbacoa', 'bodega mariscos', 'cocina economica', 'comida corrida',
  'jugos y licuados', 'mexicanos', 'puesto mariscos', 'tacos guisado',
  'desayunos', 'venta comida', 'venta barbacoa', 'fuente sodas', 'carnitas',
  'gelatinas', 'marisqueria', 'mariscos preparados', 'bodega alimentos',
  'taqueria', 'venta desayunos', 'cafe bar',
])

function isDistinctiveName(value) {
  const name = normalizeName(value)
  if (!name || name.includes('sin nombre') || GENERIC_NAMES.has(name)) return false
  return name.length >= 8 || name.split(/\s+/).length >= 2
}

function distanceMeters(a, b) {
  if ([a.latitud, a.longitud, b.latitud, b.longitud].some(value => value == null)) return null
  const toRad = degrees => Number(degrees) * Math.PI / 180
  const lat1 = toRad(a.latitud)
  const lat2 = toRad(b.latitud)
  const dLat = lat2 - lat1
  const dLon = toRad(b.longitud) - toRad(a.longitud)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function safePair(candidate, master, duplicate) {
  const masterAddress = normalizedAddressKey(master)
  const duplicateAddress = normalizedAddressKey(duplicate)
  const masterName = normalizeName(master.nombre)
  const duplicateName = normalizeName(duplicate.nombre)
  if (masterName !== duplicateName || !isDistinctiveName(master.nombre)) return false

  const sameAddress = Boolean(masterAddress && masterAddress === duplicateAddress)
  const samePlaceId = master.google_place_id && master.google_place_id === duplicate.google_place_id
  const masterPhone = String(master.telefono || '').replace(/\D/g, '')
  const duplicatePhone = String(duplicate.telefono || '').replace(/\D/g, '')
  const samePhone = masterPhone.length >= 8 && masterPhone === duplicatePhone
  const distance = distanceMeters(master, duplicate)

  if (samePlaceId) return true
  if (candidate.rule === 'name_address') {
    return sameAddress && Boolean(samePhone || (distance != null && distance < 0.2))
  }
  if (candidate.rule === 'name_phone') {
    return samePhone && Boolean(sameAddress || (distance != null && distance <= 25))
  }
  if (candidate.rule === 'name_coords') {
    return distance != null && (distance <= 10 || (distance <= 25 && (sameAddress || samePhone)))
  }
  return false
}

function richnessScore(row) {
  const fields = [
    'denue_id', 'nombre', 'razon_social', 'codigo_scian', 'actividad', 'estrato',
    'telefono', 'correo_electronico', 'sitio_web', 'instagram', 'facebook',
    'tipo_vialidad', 'nom_vialidad', 'numero_exterior', 'numero_interior',
    'colonia', 'alcaldia', 'cp', 'latitud', 'longitud', 'osm_id', 'cuisine_type',
    'horaires', 'google_place_id', 'verified_open', 'verified_at', 'categorie',
    'gamme_prix', 'statut', 'prospect_statut', 'contact_nom', 'contact_poste',
    'derniere_contact', 'notes',
  ]
  return fields.reduce((score, key) => {
    const value = row[key]
    if (value == null) return score
    if (typeof value === 'string' && value.trim() === '') return score
    return score + 1
  }, 0)
}

function chooseMaster(rows) {
  return [...rows].sort((a, b) => {
    if (a._richness !== b._richness) return b._richness - a._richness
    if ((a.created_at || '') !== (b.created_at || '')) return (a.created_at || '') < (b.created_at || '') ? -1 : 1
    return String(a.id).localeCompare(String(b.id))
  })[0]
}

const MERGE_FIELDS = [
  'razon_social', 'codigo_scian', 'actividad', 'estrato', 'telefono',
  'correo_electronico', 'sitio_web', 'instagram', 'facebook', 'tipo_vialidad',
  'nom_vialidad', 'numero_exterior', 'numero_interior', 'colonia', 'alcaldia',
  'cp', 'latitud', 'longitud', 'osm_id', 'cuisine_type', 'horaires',
  'google_place_id', 'verified_open', 'verified_at', 'categorie', 'gamme_prix',
  'statut', 'prospect_statut', 'contact_nom', 'contact_poste',
  'derniere_contact', 'notes',
]

function isEmpty(value) {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

function complementaryPatch(master, duplicates) {
  const patch = {}
  const donors = [...duplicates].sort((a, b) => b._richness - a._richness)
  for (const field of MERGE_FIELDS) {
    if (!isEmpty(master[field])) continue
    const donor = donors.find(row => !isEmpty(row[field]))
    if (donor) patch[field] = donor[field]
  }
  return patch
}

function pairLabel(row) {
  return `${row.payload?.master?.nombre || row.master_id} <- ${row.payload?.duplicate?.nombre || row.duplicate_id}`
}

function chunk(items, size = 100) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

async function fetchAll(table, select, filters = [], pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from(table).select(select)
    for (const filter of filters) query = filter(query)
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

function keyOf(value) {
  return value == null ? '__null__' : String(value)
}

function pickKeeper(rows) {
  return [...rows].sort((a, b) => {
    const aMaster = a.restaurant_role === 'master' ? 0 : 1
    const bMaster = b.restaurant_role === 'master' ? 0 : 1
    if (aMaster !== bMaster) return aMaster - bMaster
    const aCreated = a.created_at || ''
    const bCreated = b.created_at || ''
    if (aCreated !== bCreated) return aCreated < bCreated ? -1 : 1
    return String(a.id).localeCompare(String(b.id))
  })[0]
}

async function deleteRows(table, ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  let removed = 0
  for (const slice of chunk(uniqueIds, 100)) {
    const { error } = await supabase.from(table).delete().in('id', slice)
    if (error) throw new Error(`${table} delete: ${error.message}`)
    removed += slice.length
  }
  return removed
}

async function updateRows(table, ids, patch) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  let updated = 0
  for (const slice of chunk(uniqueIds, 100)) {
    const { error } = await supabase.from(table).update(patch).in('id', slice)
    if (error) throw new Error(`${table} update: ${error.message}`)
    updated += slice.length
  }
  return updated
}

async function markCandidatesResolved(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  let updated = 0
  for (const slice of chunk(uniqueIds, 100)) {
    const { error } = await supabase
      .from('restaurant_duplicate_candidates')
      .update({ resolved_at: new Date().toISOString(), resolution: 'merged' })
      .in('id', slice)
    if (error) throw new Error(`restaurant_duplicate_candidates update: ${error.message}`)
    updated += slice.length
  }
  return updated
}

async function remapCandidateReferences(masterId, dupIds) {
  for (const slice of chunk(dupIds, 100)) {
    const { error: masterError } = await supabase
      .from('restaurant_duplicate_candidates')
      .update({ master_id: masterId })
      .in('master_id', slice)
    if (masterError) throw new Error(`candidate master remap: ${masterError.message}`)

    const { error: duplicateError } = await supabase
      .from('restaurant_duplicate_candidates')
      .update({ duplicate_id: masterId })
      .in('duplicate_id', slice)
    if (duplicateError) throw new Error(`candidate duplicate remap: ${duplicateError.message}`)
  }
}

function buildConflictRows(rows, keyField) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyOf(row[keyField])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.values()].filter(group => group.length > 1)
}

async function resolveChildConflicts(cluster, masterId, dupIds, childRows, keyField, table) {
  const rows = childRows.filter(row => row.restaurant_id === masterId || dupIds.includes(row.restaurant_id))
  const groups = buildConflictRows(rows, keyField)
  const deleteIds = []

  for (const group of groups) {
    const keeper = pickKeeper(group.map(row => ({ ...row, restaurant_role: row.restaurant_id === masterId ? 'master' : 'dup' })))
    for (const row of group) {
      if (row.id !== keeper.id) deleteIds.push(row.id)
    }
  }

  if (deleteIds.length > 0) {
    await deleteRows(table, deleteIds)
  }
  return { conflict_groups: groups.length, deleted: deleteIds.length }
}

async function applyCluster(cluster, index, total) {
  const masterId = cluster.master.id
  const dupIds = cluster.duplicates.map(r => r.id)
  const clusterIds = [masterId, ...dupIds]

  const [links, docs, items, identities, sources] = await Promise.all([
    fetchAll('restaurant_links', 'id, restaurant_id, normalized_url, created_at', [q => q.in('restaurant_id', clusterIds)]),
    fetchAll('menu_documents', 'id, restaurant_id, source_url, created_at', [q => q.in('restaurant_id', clusterIds)]),
    fetchAll('menu_items', 'id, restaurant_id, menu_document_id', [q => q.in('restaurant_id', clusterIds)]),
    fetchAll('restaurant_identities', 'id, restaurant_id, source, source_id, created_at', [q => q.in('restaurant_id', clusterIds)]),
    fetchAll('source_records', 'id, matched_restaurant_id, source, source_id', [q => q.in('matched_restaurant_id', clusterIds)]),
  ])

  const linkConflicts = await resolveChildConflicts(cluster, masterId, dupIds, links, 'normalized_url', 'restaurant_links')
  const docConflicts = await resolveChildConflicts(cluster, masterId, dupIds, docs, 'source_url', 'menu_documents')
  const identityRows = identities.map(row => ({ ...row, identity_key: `${row.source}:${row.source_id}` }))
  const identityConflicts = await resolveChildConflicts(cluster, masterId, dupIds, identityRows, 'identity_key', 'restaurant_identities')

  const masterPatch = complementaryPatch(cluster.master, cluster.duplicates)
  if (Object.keys(masterPatch).length > 0) {
    const { error } = await supabase.from('restaurants').update(masterPatch).eq('id', masterId)
    if (error) throw new Error(`restaurants enrich master: ${error.message}`)
  }

  await Promise.all([
    updateRows('restaurant_links', links.map(r => r.id), { restaurant_id: masterId }),
    updateRows('menu_documents', docs.map(r => r.id), { restaurant_id: masterId }),
    updateRows('menu_items', items.map(r => r.id), { restaurant_id: masterId }),
    updateRows('restaurant_identities', identities.map(r => r.id), { restaurant_id: masterId }),
    updateRows('source_records', sources.map(r => r.id), { matched_restaurant_id: masterId, processed_at: new Date().toISOString() }),
  ])

  const mergedIds = new Set(clusterIds)
  const candidateRows = cluster.pairs.filter(pair => mergedIds.has(pair.master_id) && mergedIds.has(pair.duplicate_id))
  await markCandidatesResolved(candidateRows.map(r => r.id))
  await remapCandidateReferences(masterId, dupIds)

  await deleteRows('restaurants', dupIds)

  await logEvent(
    'working',
    dupIds.length,
    `cluster ${index + 1}/${total} applied master=${cluster.master.nombre} dups=${cluster.duplicates.map(r => r.nombre).join(' | ')}`,
  )

  return {
    dup_count: dupIds.length,
    link_conflicts: linkConflicts.deleted,
    doc_conflicts: docConflicts.deleted,
    identity_conflicts: identityConflicts.deleted,
    candidates: candidateRows.length,
  }
}

async function logEvent(status, records, notes, blocker = null) {
  const { error } = await supabase.from('pipeline_events').insert({
    agent_name: 'codex-dedupe',
    terminal: 'T4',
    status,
    task: `cluster ${RULES.join('+')} dedupe`,
    blocker,
    pct: status === 'done' ? 100 : 0,
    records,
    notes,
  })
  if (error) console.warn(`[pipeline_events] ${error.message}`)
}

async function pageAll(label, buildQuery, pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1
    const { data, error } = await buildQuery().range(from, to)
    if (error) throw new Error(`${label}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

async function loadBaseCandidates() {
  const rows = await pageAll('restaurant_duplicate_candidates', () =>
    supabase
      .from('restaurant_duplicate_candidates')
      .select('id, master_id, duplicate_id, rule, confidence, resolved_at, resolution, payload, created_at')
      .in('rule', RULES)
      .is('resolved_at', null)
      .order('confidence', { ascending: false })
      .order('created_at', { ascending: true })
  )
  const minimumConfidence = { name_address: 0.99, name_phone: 0.98, name_coords: 0.95 }
  return rows.filter(r => Number(r.confidence) >= (minimumConfidence[r.rule] ?? 1))
}

async function loadRestaurantsByIds(ids) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  const rows = []
  for (let i = 0; i < uniqueIds.length; i += 200) {
    const slice = uniqueIds.slice(i, i + 200)
    const { data, error } = await supabase
      .from('restaurants')
      .select('id, denue_id, nombre, razon_social, codigo_scian, actividad, estrato, telefono, correo_electronico, sitio_web, instagram, facebook, tipo_vialidad, nom_vialidad, numero_exterior, numero_interior, colonia, alcaldia, cp, latitud, longitud, osm_id, cuisine_type, horaires, google_place_id, verified_open, verified_at, categorie, gamme_prix, statut, prospect_statut, contact_nom, contact_poste, derniere_contact, notes, created_at')
      .in('id', slice)
    if (error) throw new Error(`restaurants: ${error.message}`)
    rows.push(...(data || []))
  }
  return rows
}

function buildClusters(candidates, restaurants) {
  const byId = new Map(restaurants.map(r => [r.id, { ...r, _richness: richnessScore(r) }]))
  const adjacency = new Map()
  const pairRows = new Map()
  const seenPairs = new Set()

  for (const candidate of candidates) {
    const master = byId.get(candidate.master_id)
    const duplicate = byId.get(candidate.duplicate_id)
    if (!master || !duplicate) continue
    if (!safePair(candidate, master, duplicate)) continue
    const pairKey = [master.id, duplicate.id].sort().join(':')
    if (seenPairs.has(pairKey)) continue
    seenPairs.add(pairKey)
    if (!adjacency.has(master.id)) adjacency.set(master.id, new Set())
    if (!adjacency.has(duplicate.id)) adjacency.set(duplicate.id, new Set())
    adjacency.get(master.id).add(duplicate.id)
    adjacency.get(duplicate.id).add(master.id)
    pairRows.set(pairKey, { ...candidate, master, duplicate })
  }

  const visited = new Set()
  const clusters = []
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue
    const stack = [start]
    const ids = []
    visited.add(start)
    while (stack.length) {
      const id = stack.pop()
      ids.push(id)
      for (const next of adjacency.get(id) || []) {
        if (!visited.has(next)) {
          visited.add(next)
          stack.push(next)
        }
      }
    }
    const rows = ids.map(id => byId.get(id))
    const idSet = new Set(ids)
    const pairs = [...pairRows.values()].filter(pair =>
      idSet.has(pair.master_id) && idSet.has(pair.duplicate_id))
    clusters.push({
      address_key: normalizedAddressKey(rows[0]) || `pair:${ids.slice().sort().join(':')}`,
      rows,
      pairs,
    })
  }

  return clusters
    .map(cluster => {
      const rows = cluster.rows
      const master = chooseMaster(rows)
      const duplicates = rows.filter(r => r.id !== master.id)
      return {
        ...cluster,
        master,
        duplicates,
        suspects: [],
        merge_count: duplicates.length,
      }
    })
    .filter(cluster => cluster.merge_count > 0)
    .sort((a, b) => b.rows.length - a.rows.length || a.address_key.localeCompare(b.address_key))
}

function buildMergeSql(cluster) {
  const master = sqlLiteral(cluster.master.id)
  const dupIds = cluster.duplicates.map(r => sqlLiteral(r.id))
  const dupList = dupIds.join(', ')
  return [
    'BEGIN;',
    `DELETE FROM restaurant_links rl USING restaurant_links rl2 WHERE rl.restaurant_id IN (${dupList}) AND rl2.restaurant_id = ${master} AND rl.normalized_url = rl2.normalized_url;`,
    `DELETE FROM menu_documents md USING menu_documents md2 WHERE md.restaurant_id IN (${dupList}) AND md2.restaurant_id = ${master} AND md.source_url = md2.source_url;`,
    `UPDATE source_records SET matched_restaurant_id = ${master} WHERE matched_restaurant_id IN (${dupList});`,
    `UPDATE restaurant_identities SET restaurant_id = ${master} WHERE restaurant_id IN (${dupList});`,
    `UPDATE menu_documents SET restaurant_id = ${master} WHERE restaurant_id IN (${dupList});`,
    `UPDATE menu_items SET restaurant_id = ${master} WHERE restaurant_id IN (${dupList});`,
    `UPDATE restaurant_links SET restaurant_id = ${master} WHERE restaurant_id IN (${dupList});`,
    `UPDATE restaurant_duplicate_candidates SET resolved_at = now(), resolution = 'merged' WHERE (master_id IN (${dupList}) OR duplicate_id IN (${dupList})) AND resolved_at IS NULL;`,
    `DELETE FROM restaurants WHERE id IN (${dupList});`,
    'COMMIT;',
  ].join('\n')
}

async function main() {
  const baseCandidates = await loadBaseCandidates()
  const restaurantIds = baseCandidates.flatMap(r => [r.master_id, r.duplicate_id])
  const restaurants = await loadRestaurantsByIds(restaurantIds)
  const clusters = buildClusters(baseCandidates, restaurants)

  const clusterSamples3 = clusters.filter(c => c.rows.length >= 3).slice(0, 10)
  const clusterSamples2 = clusters.filter(c => c.rows.length === 2).slice(0, 30)
  const keptDistinct = clusters.reduce((sum, c) => sum + c.suspects.length, 0)
  const totalDuplicates = clusters.reduce((sum, c) => sum + c.merge_count, 0)
  const totalRawPairs = baseCandidates.length

  console.log(`Raw name_address pairs: ${totalRawPairs}`)
  console.log(`Rules: ${RULES.join(', ')}`)
  console.log(`Clusters built: ${clusters.length}`)
  console.log(`Duplicates to eliminate: ${totalDuplicates}`)
  console.log(`Potential kept_distinct suspects: ${keptDistinct}`)
  console.log('\nClusters >= 3 rows (sample 10):')
  for (const c of clusterSamples3) {
    console.log(`- ${c.address_key} | rows=${c.rows.length} | master=${c.master.nombre} | dups=${c.duplicates.map(r => r.nombre).join(' ; ')}`)
  }
  console.log('\n2-row clusters (sample 30):')
  for (const c of clusterSamples2) {
    console.log(`- ${c.address_key} | master=${c.master.nombre} | dup=${c.duplicates[0]?.nombre || ''} | norm_master=${normalizeName(c.master.nombre)} | norm_dup=${normalizeName(c.duplicates[0]?.nombre || '')}`)
  }

  const planPreview = clusters.slice(0, 10).map(c => ({
    address_key: c.address_key,
    master: c.master.nombre,
    duplicates: c.duplicates.map(r => r.nombre),
    merge_count: c.merge_count,
  }))
  console.log('\nPlan preview:')
  console.log(JSON.stringify(planPreview, null, 2))

  if (DRY) {
    console.log('Dry-run only. Nothing was merged.')
    await logEvent(
      'done',
      totalDuplicates,
      `dry-run clusters=${clusters.length}; raw_pairs=${totalRawPairs}; kept_distinct=${keptDistinct}; top10=${planPreview.map(x => `${x.master}<=${x.duplicates.join('|')}`).join(' | ')}`,
    )
    return
  }

  let mergedDupCount = 0
  await logEvent('working', 0, `apply start clusters=${clusters.length}; raw_pairs=${totalRawPairs}; kept_distinct=${keptDistinct}`)
  for (const [index, cluster] of clusters.entries()) {
    console.log(`Applying cluster ${index + 1}/${clusters.length}: ${cluster.address_key}`)
    const result = await applyCluster(cluster, index, clusters.length)
    mergedDupCount += result.dup_count
  }

  await logEvent('done', mergedDupCount, `merged clusters=${clusters.length}; raw_pairs=${totalRawPairs}; kept_distinct=${keptDistinct}`)
  console.log('Done.')
}

main().catch(async err => {
  console.error(err)
  await logEvent('blocked', 0, 'apply_dedupe failed', err.message)
  process.exit(1)
})
