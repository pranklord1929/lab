// Promotes only top-quality local candidates after a second duplicate pass.
// Default is dry-run. Use --execute; every action is logged for rollback.
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { distanceMeters, nameSimilarity, normalizeName, normalizePhoneMx } from './lib/normalize.js'

const EXECUTE = process.argv.includes('--execute')
const MATCH_ONLY = process.argv.includes('--match-only')
const MULTI_SOURCE = process.argv.includes('--multi-source')
const STATUS = process.argv.find(arg => arg.startsWith('--status='))?.split('=')[1] || 'ready_for_review'
const MIN_SCORE = Number(process.argv.find(arg => arg.startsWith('--min-score='))?.split('=')[1] || 0)
const SOURCE = process.argv.find(arg => arg.startsWith('--source='))?.split('=')[1] || null
const TRIAGE_AUTO = process.argv.includes('--triage-auto')
const VALIDATION_AUTO = process.argv.includes('--validation-auto')
const ALLOW_ADDRESS_ONLY = process.argv.includes('--allow-address-only')
const TRIAGE_CLASS = process.argv.find(arg => arg.startsWith('--triage-class='))?.split('=')[1] || null
if (!['ready_for_review', 'high', 'review'].includes(STATUS)) throw new Error(`Invalid --status=${STATUS}`)
const db = new DatabaseSync(resolve('data/local_db/cdmx_local.sqlite'))
const now = new Date().toISOString()

function json(value) { try { return value ? JSON.parse(value) : {} } catch { return {} } }
function validCoord(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= 19.15 && lat <= 19.65 && lon >= -99.40 && lon <= -98.90
}
function outsideCdmx(address) {
  return /State of Mexico|Estado de M[eé]xico|Edo\.? de M[eé]xico|Edomex|Naucalpan|Tlalnepantla|Cuautitl[aá]n|Chimalhuac[aá]n|Nezahualc[oó]yotl|Ecatepec|Chalco|Atizap[aá]n|Ciudad L[oó]pez Mateos|Ixtapaluca|Los Reyes Ixtacala|Huixquilucan|Texcoco|Tec[aá]mac|Bosque Real/i.test(address || '')
}
function phoneKey(value) { return normalizePhoneMx(value)?.replace(/\D/g, '').slice(-10) || null }
function gridKey(lat, lon) { return `${Math.floor(lat / 0.003)}:${Math.floor(lon / 0.003)}` }
function tokenSimilarity(a, b) {
  const tokens = value => new Set((normalizeName(value) || '').split(/\s+/).filter(token => token.length > 1))
  const left = tokens(a), right = tokens(b)
  if (!left.size || !right.size) return 0
  const common = [...left].filter(token => right.has(token)).length
  return common / (left.size + right.size - common)
}
function compactName(value) { return (normalizeName(value) || '').replace(/\s+/g, '') || null }
function strictCompactName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(restaurante|restaurant|el|la|los|las)\b/g, ' ')
    .replace(/\s+/g, '') || null
}
function ambiguousBranchName(value) {
  return /chuck\s*e\s*cheese|pasteler[ií]as?\s+esperanza|restaurante\s+palacio|cantina\s+palacio|juan\s+bisteces|terraza\s+santa\s+f[eé]/i.test(value || '')
}
function knownBrand(value) {
  const text = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const brands = [
    ['mcdonalds', /mc\s*donald/], ['dominos', /domino'?s/], ['kfc', /\bkfc\b/],
    ['potzollcalli', /potzo.*cal+i/], ['fogo_de_chao', /fogo\s+de\s+chao/],
    ['sanborns', /sanborns/], ['starbucks', /starbucks/], ['little_caesars', /little\s+cea?sars/],
    ['italiannis', /italianni/], ['chilis', /chili'?s/], ['pf_changs', /p\.?f\.?\s*chang/],
    ['texas_ribs', /texas\s+ribs/], ['vips', /\bvips\b/], ['olive_garden', /olive\s+garden/],
    ['cantina_20', /cantina\s+(?:la\s+)?(?:n(?:o|umero)\.?\s*)?20/],
  ]
  return brands.find(([, pattern]) => pattern.test(text))?.[0] || null
}
function siteDomain(value) {
  if (!value) return null
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch { return null }
}
function addressCore(value) {
  const folded = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(calle|avenida|av|calzada|calz|numero|num|no|local|piso|colonia|col)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = folded.split(' ').filter(Boolean)
  const numberIndex = tokens.findIndex(token => /^\d+[a-z]?$/.test(token))
  return numberIndex < 0 ? null : tokens.slice(0, numberIndex + 1).join(' ')
}
function addressFeatures(value) {
  const folded = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
  const numbers = [...new Set(folded.match(/\b\d+[a-z]?\b/g) || [])]
  const stop = new Set(['calle','avenida','av','calzada','calz','numero','num','no','local','piso','colonia','col','ciudad','mexico','cdmx'])
  const tokens = new Set(folded.split(/\s+/).filter(token => token.length > 2 && !/^\d/.test(token) && !stop.has(token)))
  return { numbers,tokens }
}
function setSimilarity(left,right) {
  if (!left.size || !right.size) return 0
  let common = 0
  for (const token of left) if (right.has(token)) common++
  return common / (left.size + right.size - common)
}

const candidates = db.prepare(`
  SELECT c.* FROM restaurant_candidate_pool c
  LEFT JOIN restaurant_candidate_triage t ON t.candidate_id=c.candidate_id
  LEFT JOIN restaurant_candidate_validation v ON v.candidate_id=c.candidate_id
  WHERE c.review_status=? AND c.quality_score>=? AND (?=0 OR c.source_count>=2)
    AND (? IS NULL OR c.best_source=?) AND (?=0 OR t.auto_promote=1) AND (?=0 OR v.auto_promote=1)
    AND (? IS NULL OR t.classification=?)
  ORDER BY c.quality_score DESC, c.best_source, c.name
`).all(STATUS, MIN_SCORE, MULTI_SOURCE ? 1 : 0, SOURCE, SOURCE, TRIAGE_AUTO ? 1 : 0, VALIDATION_AUTO ? 1 : 0,
  TRIAGE_CLASS, TRIAGE_CLASS)
const memberRows = db.prepare(`
  SELECT m.*,sr.name,sr.latitude,sr.longitude,sr.address,sr.phone,sr.website,sr.payload
  FROM restaurant_candidate_members m JOIN source_records sr ON sr.id=m.source_record_id
`).all()
const membersByCandidate = new Map()
for (const row of memberRows) {
  if (!membersByCandidate.has(row.candidate_id)) membersByCandidate.set(row.candidate_id, [])
  membersByCandidate.get(row.candidate_id).push({ ...row, payload: json(row.payload) })
}

const phoneFrequency = new Map()
for (const row of candidates) {
  const key = phoneKey(row.phone)
  if (key) phoneFrequency.set(key, (phoneFrequency.get(key) || 0) + 1)
}

const canonicals = db.prepare('SELECT id,nombre,telefono,sitio_web,latitud,longitud,cp FROM restaurants').all()
const exactNames = new Map(), compactNames = new Map(), strictNames = new Map(), phones = new Map(), grid = new Map()
const addressIndex = new Map()
const addressNumberIndex = new Map()
for (const row of db.prepare('SELECT restaurant_id,name,address FROM restaurant_golden_record WHERE address IS NOT NULL').all()) {
  const core = addressCore(row.address)
  const features = addressFeatures(row.address)
  const indexed = { id:row.restaurant_id,nombre:row.name,address:row.address,features }
  if (!core) continue
  if (!addressIndex.has(core)) addressIndex.set(core, [])
  addressIndex.get(core).push(indexed)
  for (const number of features.numbers) {
    if (!addressNumberIndex.has(number)) addressNumberIndex.set(number, [])
    addressNumberIndex.get(number).push(indexed)
  }
}
function indexCanonical(row) {
  const name = normalizeName(row.nombre)
  if (name) {
    if (!exactNames.has(name)) exactNames.set(name, [])
    exactNames.get(name).push(row)
    const compact = compactName(row.nombre)
    if (!compactNames.has(compact)) compactNames.set(compact, [])
    compactNames.get(compact).push(row)
    const strict = strictCompactName(row.nombre)
    if (!strictNames.has(strict)) strictNames.set(strict, [])
    strictNames.get(strict).push(row)
  }
  const phone = phoneKey(row.telefono)
  if (phone) {
    if (!phones.has(phone)) phones.set(phone, [])
    phones.get(phone).push(row)
  }
  const lat = Number(row.latitud), lon = Number(row.longitud)
  if (validCoord(lat, lon)) {
    const key = gridKey(lat, lon)
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key).push(row)
  }
}
canonicals.forEach(indexCanonical)

function nearby(lat, lon) {
  const x = Math.floor(lat / 0.003), y = Math.floor(lon / 0.003), rows = []
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) rows.push(...(grid.get(`${x + dx}:${y + dy}`) || []))
  return rows
}

function findExisting(candidate) {
  const lat = Number(candidate.latitude), lon = Number(candidate.longitude)
  const normalized = normalizeName(candidate.name)
  const exact = exactNames.get(normalized) || []
  if (exact.length === 1) {
    const row = exact[0]
    const distance = validCoord(lat, lon) && validCoord(Number(row.latitud), Number(row.longitud))
      ? distanceMeters(lat, lon, Number(row.latitud), Number(row.longitud)) : null
    if (validCoord(lat, lon) && distance <= 150 && strictCompactName(candidate.name) === strictCompactName(row.nombre)) {
      return { row, method: 'candidate_exact_name', confidence: 0.97, distance }
    }
  }
  const compact = compactNames.get(compactName(candidate.name)) || []
  if (compact.length === 1) {
    const row = compact[0]
    const distance = validCoord(lat, lon) && validCoord(Number(row.latitud), Number(row.longitud))
      ? distanceMeters(lat, lon, Number(row.latitud), Number(row.longitud)) : null
    if (validCoord(lat, lon) && distance <= 150 && strictCompactName(candidate.name) === strictCompactName(row.nombre)) {
      return { row, method: 'candidate_compact_name', confidence: 0.97, distance }
    }
  }
  if (!validCoord(lat, lon)) {
    const strict = strictNames.get(strictCompactName(candidate.name)) || []
    if (strict.length === 1 && !ambiguousBranchName(candidate.name)) {
      return { row: strict[0], method: 'candidate_strict_name', confidence: 0.97, distance: null }
    }
  }
  const phone = phoneKey(candidate.phone)
  if (phone && (phoneFrequency.get(phone) || 0) < 3 && phones.get(phone)?.length === 1) {
    const row = phones.get(phone)[0]
    const similarity = nameSimilarity(candidate.name, row.nombre)
    const tokenScore = tokenSimilarity(candidate.name, row.nombre)
    if (similarity >= 0.78 && tokenScore >= 0.5) {
      return { row, method: 'candidate_phone_name', confidence: 0.98, similarity, tokenScore }
    }
  }
  const core = addressCore(candidate.address)
  if (core && addressIndex.has(core)) {
    const scored = addressIndex.get(core).map(row => ({
      row, similarity:nameSimilarity(candidate.name,row.nombre), tokenScore:tokenSimilarity(candidate.name,row.nombre),
    })).sort((a,b)=>b.similarity-a.similarity || b.tokenScore-a.tokenScore)
    const best = scored[0], second = scored[1]
    const margin = best ? best.similarity - (second?.similarity ?? 0) : 0
    if (best && best.similarity >= 0.68 && (best.tokenScore >= 0.5 || best.similarity >= 0.82) &&
      (scored.length === 1 || margin >= 0.12)) {
      return { ...best, method:'candidate_address_name', confidence:0.96, distance:null }
    }
  }
  const features = addressFeatures(candidate.address)
  if (features.numbers.length) {
    const possible = new Map()
    for (const number of features.numbers) for (const row of addressNumberIndex.get(number) || []) possible.set(row.id,row)
    const scored = [...possible.values()].map(row => {
      const similarity = nameSimilarity(candidate.name,row.nombre)
      const tokenScore = tokenSimilarity(candidate.name,row.nombre)
      const addressScore = setSimilarity(features.tokens,row.features.tokens)
      return { row,similarity,tokenScore,addressScore,score:similarity*0.55+tokenScore*0.2+addressScore*0.25 }
    }).filter(v => v.addressScore >= 0.55 && v.similarity >= 0.82 && v.tokenScore >= 0.67)
      .sort((a,b)=>b.score-a.score)
    const best = scored[0], second = scored[1]
    if (best && (!second || best.score-second.score >= 0.1)) {
      return { ...best, method:'candidate_fuzzy_address_name', confidence:0.94, distance:null }
    }
  }
  if (validCoord(lat, lon)) {
    const local = nearby(lat, lon).map(row => ({
      row,
      distance: distanceMeters(lat, lon, Number(row.latitud), Number(row.longitud)),
      similarity: nameSimilarity(candidate.name, row.nombre),
      tokenScore: tokenSimilarity(candidate.name, row.nombre),
    }))
    const brand = knownBrand(candidate.name)
    const candidateDomain = siteDomain(candidate.website)
    const brandMatch = brand ? local.filter(v => !/oficina|corporativ/i.test(v.row.nombre || '') && knownBrand(v.row.nombre) === brand &&
      (v.distance <= 80 || (candidateDomain && candidateDomain === siteDomain(v.row.sitio_web) && v.distance <= 250)))
      .sort((a, b) => a.distance - b.distance)[0] : null
    if (brandMatch) return { ...brandMatch, method: 'candidate_brand_coords', confidence: 0.98 }

    const ranked = local.filter(v => v.distance <= 30 &&
      ((v.distance <= 20 && v.similarity >= 0.45 && v.tokenScore >= 0.33) ||
        (v.similarity >= 0.65 && v.tokenScore >= 0.60)))
      .sort((a, b) => b.tokenScore - a.tokenScore || b.similarity - a.similarity || a.distance - b.distance)
    const best = ranked[0]
    if (best) {
      return { ...best, method: 'candidate_coords_name', confidence: 0.96 }
    }
  }
  return null
}

db.exec(`
  CREATE TABLE IF NOT EXISTS restaurant_candidate_promotion_log (
    candidate_id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    restaurant_id TEXT NOT NULL,
    candidate_snapshot TEXT NOT NULL,
    member_snapshot TEXT NOT NULL,
    evidence TEXT NOT NULL,
    promoted_at TEXT NOT NULL
  );
`)
const logged = db.prepare('SELECT 1 FROM restaurant_candidate_promotion_log WHERE candidate_id=?')
const insertRestaurant = db.prepare(`INSERT INTO restaurants
  (id,nombre,telefono,colonia,alcaldia,cp,latitud,longitud,cuisine_type,horaires,categorie,gamme_prix,statut,source,notes,created_at,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
const updateSource = db.prepare(`UPDATE source_records SET matched_restaurant_id=?,match_confidence=?,match_method=?,processed_at=? WHERE id=?`)
const identityExists = db.prepare('SELECT 1 FROM restaurant_identities WHERE restaurant_id=? AND source=? AND source_id=?')
const insertIdentity = db.prepare('INSERT INTO restaurant_identities VALUES (?,?,?,?,?,?,?,?,?,?)')
const insertLog = db.prepare('INSERT INTO restaurant_candidate_promotion_log VALUES (?,?,?,?,?,?,?)')

const stats = { candidates: candidates.length, excluded: 0, reattached: 0, inserted: 0, no_match: 0, already_done: 0 }
const examples = []
if (EXECUTE) db.exec('BEGIN')
try {
  for (const candidate of candidates) {
    if (logged.get(candidate.candidate_id)) { stats.already_done++; continue }
    const lat = candidate.latitude === null ? null : Number(candidate.latitude)
    const lon = candidate.longitude === null ? null : Number(candidate.longitude)
    if (outsideCdmx(`${candidate.name} ${candidate.address || ''}`)) { stats.excluded++; continue }
    const members = membersByCandidate.get(candidate.candidate_id) || []
    const bestMember = members.find(row => row.source === candidate.best_source) || members[0]
    const payload = bestMember?.payload || {}
    const match = findExisting(candidate)
    if (!validCoord(lat, lon) && !match && !(ALLOW_ADDRESS_ONLY && candidate.address)) { stats.excluded++; continue }
    if (!match && MATCH_ONLY) { stats.no_match++; continue }
    let restaurantId, action, evidence
    if (match) {
      restaurantId = match.row.id
      action = 'reattached'
      evidence = { method: match.method, confidence: match.confidence, distance: match.distance ?? null, similarity: match.similarity ?? null, token_similarity: match.tokenScore ?? null }
      stats.reattached++
    } else {
      restaurantId = EXECUTE ? randomUUID() : `planned:${candidate.candidate_id}`
      action = 'inserted'
      evidence = { method: 'candidate_promoted_new', confidence: candidate.quality_score / 100 }
      stats.inserted++
      const repeatedPhone = (phoneFrequency.get(phoneKey(candidate.phone)) || 0) >= 3
      const rawPhoneDigits = String(candidate.phone || '').replace(/\D/g, '')
      const safePhone = !repeatedPhone && rawPhoneDigits.length >= 10 && rawPhoneDigits.length <= 12
        ? `+52${phoneKey(candidate.phone)}` : null
      const geo = payload.geolocation || {}
      const cuisines = payload.cuisines || (payload.category ? [payload.category] : [])
      const categories = payload.categories || []
      const cp = String(candidate.address || '').match(/\b\d{5}\b/)?.[0] || null
      const newRow = {
        id: restaurantId, nombre: candidate.name, telefono: safePhone,
        colonia: geo.colony || null, alcaldia: geo.city || null, cp,
        latitud: lat, longitud: lon,
      }
      const promotedStatus = ['opentable','resy','reservandonos','ubereats','didifood_web'].includes(candidate.best_source)
        ? 'actif' : 'a_verifier'
      if (EXECUTE) insertRestaurant.run(restaurantId, candidate.name, newRow.telefono, newRow.colonia, newRow.alcaldia, cp,
        lat, lon, Array.isArray(cuisines) ? cuisines.join(', ') || null : cuisines,
        payload.schedules ? JSON.stringify(payload.schedules) : payload.schedule || null,
        Array.isArray(categories) ? categories.join(', ') || null : categories,
        candidate.price_level, promotedStatus, candidate.best_source,
        JSON.stringify({ original_address: candidate.address, candidate_id: candidate.candidate_id, source_profile: candidate.website }), now, now)
      indexCanonical({ ...newRow, id: restaurantId })
    }
    if (examples.length < 100 && (action === 'reattached' || examples.length < 10)) {
      examples.push({ name: candidate.name, action, target: match?.row.nombre || null, evidence })
    }
    if (!EXECUTE) continue
    const snapshots = []
    for (const member of members) {
      snapshots.push({ id: member.source_record_id, matched_restaurant_id: null, match_confidence: null, match_method: 'new_insert' })
      updateSource.run(restaurantId, evidence.confidence, evidence.method, now, member.source_record_id)
      if (!identityExists.get(restaurantId, member.source, member.source_id)) {
        insertIdentity.run(randomUUID(), restaurantId, member.source, member.source_id,
          member.payload.profile_url || member.website || null, evidence.confidence, evidence.method,
          'promoted from local candidate pool', now, now)
      }
    }
    insertLog.run(candidate.candidate_id, action, restaurantId, JSON.stringify(candidate), JSON.stringify(snapshots), JSON.stringify(evidence), now)
  }
  if (EXECUTE) db.exec('COMMIT')
} catch (error) {
  if (EXECUTE) db.exec('ROLLBACK')
  throw error
}

console.log(`${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} ${JSON.stringify(stats)}`)
console.table(examples)
if (process.argv.includes('--details')) console.log(JSON.stringify(examples.filter(row => row.action === 'reattached'), null, 2))
db.close()
