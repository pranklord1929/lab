// Entity resolution : pour un record d'une source externe, trouver le restaurant
// canonique correspondant (ou décider qu'il faut en créer un nouveau).
//
// Stratégie en cascade — on s'arrête au premier match haute confiance :
//   1. identity exact     : (source, source_id) déjà mappé   → conf 1.0
//   2. coords + name      : <100m ET name_sim >= 0.80       → conf 0.95
//   3. coords + name fuzz  : <200m ET name_sim >= 0.65       → conf 0.88
//   4. name + alcaldia    : name_sim >= 0.80 + même alcaldía → conf 0.80
//   5. name only strict   : name_sim >= 0.92 sans coords     → conf 0.92
//   6. pas de match       → new_insert
//
// Renvoie : { restaurantId | null, method, confidence }

import { supabase } from './supabase.js'
import { normalizeName, nameSimilarity, distanceMeters } from './normalize.js'

const COORD_BOX_DEG = 0.001  // ~111m de marge — on filtre ensuite avec Haversine

function nameVariants(name) {
  return [
    name,
    ...String(name || '').split(/[\/|,;()]/g),
  ]
    .map(normalizeName)
    .filter(v => v.length >= 3)
    .filter((v, i, arr) => arr.indexOf(v) === i)
}

function nameScore(sourceName, candidateName) {
  const variants = nameVariants(sourceName)
  const candidate = normalizeName(candidateName)
  if (!candidate || variants.length === 0) return 0

  let best = 0
  for (const variant of variants) {
    if (variant === candidate) best = Math.max(best, 1)
    if (variant.length >= 5 && new RegExp(`(^| )${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(candidate)) {
      best = Math.max(best, 0.94)
    }
    if (candidate.length >= 5 && new RegExp(`(^| )${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(variant)) {
      best = Math.max(best, 0.94)
    }
    best = Math.max(best, nameSimilarity(variant, candidate))
  }
  return best
}

async function fetchNameCandidates(name, alcaldia, limit = 100) {
  const tokens = nameVariants(name)
    .flatMap(v => v.split(' '))
    .filter(t => t.length >= 3)
    .filter((t, i, arr) => arr.indexOf(t) === i)
    .slice(0, 6)

  if (tokens.length === 0) return []

  const runQuery = async (mode) => {
    let q = supabase
      .from('restaurants')
      .select('id, nombre, alcaldia, latitud, longitud')
      .limit(limit)

    if (mode === 'and') {
      for (const token of tokens.slice(0, 4)) q = q.ilike('nombre', `%${token}%`)
    } else {
      q = q.or(tokens.map(t => `nombre.ilike.%${t}%`).join(','))
    }
    if (alcaldia) q = q.eq('alcaldia', alcaldia)

    const { data, error } = await q
    if (error) {
      console.warn(`[match] name candidate query failed: ${error.message}`)
      return []
    }
    return data || []
  }

  const strict = tokens.length > 1 ? await runQuery('and') : []
  if (strict.length > 0) return strict

  return runQuery('or')
}

async function fetchShortExactCandidates(name, alcaldia) {
  const norm = normalizeName(name)
  if (norm.length < 2 || norm.length > 2) return []

  const variants = [
    name,
    `Restaurante ${name}`,
    `${name} Restaurante`,
    `Bar ${name}`,
    `${name} Bar`,
  ]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i)

  const rows = []
  for (const variant of variants) {
    let q = supabase
      .from('restaurants')
      .select('id, nombre, alcaldia, latitud, longitud')
      .ilike('nombre', variant)
      .limit(10)
    if (alcaldia) q = q.eq('alcaldia', alcaldia)

    const { data, error } = await q
    if (error) {
      console.warn(`[match] short exact query failed: ${error.message}`)
      continue
    }
    rows.push(...(data || []))
  }

  return rows.filter((row, i, arr) => arr.findIndex(r => r.id === row.id) === i)
}

export async function resolveEntity({ source, sourceId, name, latitude, longitude, alcaldia }) {
  // 1) identity persisté ?
  if (source && sourceId) {
    const { data } = await supabase
      .from('restaurant_identities')
      .select('restaurant_id')
      .eq('source', source).eq('source_id', sourceId)
      .maybeSingle()
    if (data?.restaurant_id) {
      return { restaurantId: data.restaurant_id, method: 'identity_cached', confidence: 1.0 }
    }
  }

  // 2-3) match par coordonnées (le plus fiable quand on a des coords)
  if (latitude != null && longitude != null) {
    const { data: candidates } = await supabase
      .from('restaurants')
      .select('id, nombre, latitud, longitud, alcaldia')
      .gte('latitud', latitude - COORD_BOX_DEG)
      .lte('latitud', latitude + COORD_BOX_DEG)
      .gte('longitud', longitude - COORD_BOX_DEG)
      .lte('longitud', longitude + COORD_BOX_DEG)
      .limit(50)

    if (candidates?.length) {
      const scored = candidates
        .map(c => ({ c, dist: distanceMeters(latitude, longitude, c.latitud, c.longitud) }))
        .sort((a, b) => a.dist - b.dist)

      // 2) <50m ET nom proche
      if (name) {
        for (const { c, dist } of scored) {
          const sim = nameScore(name, c.nombre)
          if (dist > 100) break
          if (sim >= 0.8) {
            return { restaurantId: c.id, method: 'coords_name', confidence: 0.95 }
          }
        }
      }
      if (name) {
        for (const { c, dist } of scored) {
          const sim = nameScore(name, c.nombre)
          if (dist > 200) break
          if (sim >= 0.65) {
            return { restaurantId: c.id, method: 'coords_name_fuzzy', confidence: 0.88 }
          }
        }
      }
    }
  }

  // 4-5) match par nom (fallback quand pas de coords ou pas trouvé)
  if (name) {
    const norm = normalizeName(name)
    const exactShort = await fetchShortExactCandidates(name, alcaldia)
    const exactShortMatch = exactShort.find(c => normalizeName(c.nombre) === norm)
    if (exactShortMatch) {
      return alcaldia
        ? { restaurantId: exactShortMatch.id, method: 'name_alcaldia', confidence: 0.8 }
        : { restaurantId: exactShortMatch.id, method: 'name_only_high_conf', confidence: 1.0 }
    }

    const byName = await fetchNameCandidates(name, alcaldia, 100)
    if (byName?.length) {
      // 4) exact nom normalisé
      const exact = byName.find(c => normalizeName(c.nombre) === norm)
      if (exact) {
        return alcaldia
          ? { restaurantId: exact.id, method: 'name_alcaldia', confidence: 0.8 }
          : { restaurantId: exact.id, method: 'name_only_high_conf', confidence: 1.0 }
      }

      const scored = byName
        .map(c => ({ c, sim: nameScore(name, c.nombre) }))
        .sort((a, b) => b.sim - a.sim)

      // 5) strict name-only fallback, useful for editorial/chilango without coords.
      const best = scored[0]
      const second = scored[1]
      if (best?.sim >= 0.92 && (!second || best.sim - second.sim >= 0.02 || best.sim === 1)) {
        return { restaurantId: best.c.id, method: 'name_only_high_conf', confidence: best.sim }
      }

      // 4) fuzzy with alcaldia context only.
      if (alcaldia && scored[0]?.sim >= 0.8) {
        return { restaurantId: scored[0].c.id, method: 'name_alcaldia', confidence: 0.8 }
      }
    }
  }

  return { restaurantId: null, method: 'new_insert', confidence: null }
}

// Persiste un mapping (source, source_id) ↔ restaurant_id pour les passes futures.
export async function persistIdentity({ restaurantId, source, sourceId, sourceUrl, confidence, method, notes }) {
  if (!restaurantId || !source || !sourceId) return
  await supabase.from('restaurant_identities').upsert({
    restaurant_id: restaurantId,
    source,
    source_id: String(sourceId),
    source_url: sourceUrl || null,
    confidence,
    match_method: method,
    notes: notes || null,
  }, { onConflict: 'source,source_id' })
}
