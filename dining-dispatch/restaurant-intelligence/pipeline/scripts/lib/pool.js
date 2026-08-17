// La "pool premium" = les ~3000 candidats pour les 500 cibles finales.
// Critère : taille ≥ 11 employés (DENUE estrato) ET alcaldía aisée.
// Tout script d'enrichissement (Google Places, IG, menus, etc.) doit tirer
// dessus pour ne pas brûler du budget API sur les 57k restos de bas niveau.

import { supabase } from './supabase.js'

export const PREMIUM_ALCALDIAS = [
  'Cuauhtémoc',
  'Benito Juárez',
  'Miguel Hidalgo',
  'Coyoacán',
  'Álvaro Obregón',
  'Cuajimalpa de Morelos',
  'Tlalpan',  // partiellement aisé (Pedregal, Tlalpan centro)
]

export const PREMIUM_ESTRATOS = [
  '11 a 30 personas',
  '31 a 50 personas',
  '51 a 100 personas',
  '101 a 250 personas',
  '251 y más personas',
]

// Renvoie tous les restos de la pool (paginé pour éviter le timeout Supabase).
export async function fetchPool({ limit = null, missing = null } = {}) {
  // missing='instagram' → filtre sur ceux sans IG, etc.
  const PAGE = 1000
  let all = []
  let from = 0
  while (true) {
    let q = supabase
      .from('restaurants')
      .select('id, nombre, alcaldia, colonia, sitio_web, instagram, telefono, latitud, longitud, estrato, source, google_place_id, horaires')
      .in('alcaldia', PREMIUM_ALCALDIAS)
      .in('estrato', PREMIUM_ESTRATOS)
      .order('estrato', { ascending: false })
      .range(from, from + PAGE - 1)

    if (missing === 'website')       q = q.or('sitio_web.is.null,sitio_web.eq.')
    if (missing === 'instagram')     q = q.or('instagram.is.null,instagram.eq.')
    if (missing === 'phone')         q = q.or('telefono.is.null,telefono.eq.')
    if (missing === 'hours')         q = q.or('horaires.is.null,horaires.eq.')
    if (missing === 'google_place')  q = q.is('google_place_id', null)

    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < PAGE) break
    from += PAGE
    if (limit && all.length >= limit) { all = all.slice(0, limit); break }
  }
  return all
}

// Stats rapides de la pool — pratique pour les scripts audit.
export async function poolStats() {
  async function countWhere(extra) {
    let q = supabase
      .from('restaurants')
      .select('id', { count: 'exact', head: true })
      .in('alcaldia', PREMIUM_ALCALDIAS)
      .in('estrato', PREMIUM_ESTRATOS)
    if (extra) q = extra(q)
    const { count } = await q
    return count ?? 0
  }

  const out = { total: await countWhere() }
  const fields = ['sitio_web', 'instagram', 'telefono', 'horaires', 'google_place_id']
  for (const f of fields) {
    out[`with_${f}`] = await countWhere(q => q.not(f, 'is', null).neq(f, ''))
  }
  return out
}
