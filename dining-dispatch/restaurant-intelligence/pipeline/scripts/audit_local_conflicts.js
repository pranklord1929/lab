// Audits identity-field disagreements in the local SQLite snapshot.
// Writes a derived quarantine table; canonical/raw tables are never modified.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const DB_PATH = resolve('data/local_db/cdmx_local.sqlite')
const db = new DatabaseSync(DB_PATH)

const TRUSTED = new Set(['google_places', 'michelin', 'opentable', 'resy', 'wikidata'])

function clean(value) {
  if (value === null || value === undefined) return null
  const result = String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  return result || null
}

function payload(value) {
  try { return value ? JSON.parse(value) : {} } catch { return {} }
}

function fold(value) {
  return clean(value)?.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() || null
}

function nameNorm(value) {
  return fold(value)?.replace(/\b(restaurante|restaurant|cafe|cafeteria|taqueria|sucursal)\b/g, ' ')
    .replace(/\s+/g, ' ').trim() || null
}

function addressTokens(value) {
  const normalized = fold(value)
  if (!normalized) return new Set()
  const stop = new Set(['calle', 'avenida', 'av', 'colonia', 'col', 'ciudad', 'de', 'del', 'la', 'el',
    'mexico', 'cdmx', 'cuauhtemoc', 'miguel', 'hidalgo', 'benito', 'juarez', 'alcaldia'])
  return new Set(normalized.split(' ').filter(token => token.length > 1 && !stop.has(token) && !/^0\d{4}$/.test(token)))
}

function similarity(a, b, tokenizer = value => new Set((fold(value) || '').split(' ').filter(Boolean))) {
  const left = tokenizer(a)
  const right = tokenizer(b)
  if (!left.size || !right.size) return null
  let intersection = 0
  for (const token of left) if (right.has(token)) intersection++
  return intersection / (left.size + right.size - intersection)
}

function phoneNorm(value) {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

function addressNumbers(value) {
  return new Set((fold(value)?.match(/\b\d{1,4}\b/g) || []).map(number => String(Number(number))))
}

function host(value) {
  if (!value) return null
  try {
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch { return null }
}

function officialHost(value) {
  const result = host(value)
  if (!result) return null
  const excluded = ['opentable.', 'resy.', 'guide.michelin.', 'restaurantguru.', 'facebook.', 'instagram.']
  return excluded.some(domain => result.includes(domain)) ? null : result
}

function num(value) {
  if (value === null || value === undefined || value === '') return null
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function distanceMeters(a, b) {
  const toRad = degrees => degrees * Math.PI / 180
  const earth = 6371000
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * earth * Math.asin(Math.sqrt(h))
}

function canonicalAddress(row) {
  const street = [row.tipo_vialidad, row.nom_vialidad, row.numero_exterior, row.numero_interior]
    .map(clean).filter(Boolean).join(' ')
  return [street, clean(row.colonia), clean(row.alcaldia), clean(row.cp)].filter(Boolean).join(', ') || null
}

function addCandidate(map, field, source, value, confidence = 1) {
  if (value === null || value === undefined || value === '') return
  if (!map[field]) map[field] = []
  map[field].push({ source, value, confidence: num(confidence) ?? 0 })
}

function pairs(values) {
  const result = []
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) result.push([values[i], values[j]])
  }
  return result
}

const restaurants = db.prepare('SELECT * FROM restaurants').all()
const restaurantById = new Map(restaurants.map(row => [row.id, row]))
const candidatesById = new Map()

for (const row of restaurants) {
  const fields = {}
  const canonicalSource = `canonical:${row.source || 'unknown'}`
  addCandidate(fields, 'name', canonicalSource, clean(row.nombre))
  addCandidate(fields, 'address', canonicalSource, canonicalAddress(row))
  addCandidate(fields, 'phone', canonicalSource, clean(row.telefono))
  addCandidate(fields, 'website', canonicalSource, clean(row.sitio_web))
  if (num(row.latitud) !== null && num(row.longitud) !== null) {
    addCandidate(fields, 'coordinates', canonicalSource, {
      latitude: num(row.latitud), longitude: num(row.longitud),
    })
  }
  candidatesById.set(row.id, fields)
}

const seenLatest = new Set()
const sourceRows = db.prepare(`
  SELECT * FROM source_records
  WHERE matched_restaurant_id IS NOT NULL
  ORDER BY scrape_date DESC, scraped_at DESC
`).all()

for (const row of sourceRows) {
  const key = `${row.matched_restaurant_id}:${row.source}`
  if (seenLatest.has(key) || !candidatesById.has(row.matched_restaurant_id)) continue
  seenLatest.add(key)
  const fields = candidatesById.get(row.matched_restaurant_id)
  const p = payload(row.payload)
  const confidence = row.match_confidence ?? 0
  addCandidate(fields, 'name', row.source, clean(row.name) || clean(p.displayName?.text) || clean(p.name), confidence)
  addCandidate(fields, 'address', row.source, clean(row.address) || clean(p.formattedAddress) || clean(p.address), confidence)
  addCandidate(fields, 'phone', row.source, clean(row.phone) || clean(p.internationalPhoneNumber) || clean(p.nationalPhoneNumber) || clean(p.phone), confidence)
  addCandidate(fields, 'website', row.source, clean(row.website) || clean(p.websiteUri) || clean(p.website), confidence)
  const latitude = num(row.latitude) ?? num(p.location?.latitude) ?? num(p.lat)
  const longitude = num(row.longitude) ?? num(p.location?.longitude) ?? num(p.lon)
  if (latitude !== null && longitude !== null) {
    addCandidate(fields, 'coordinates', row.source, { latitude, longitude }, confidence)
  }
}

db.exec(`
  DROP TABLE IF EXISTS restaurant_field_conflicts;
  CREATE TABLE restaurant_field_conflicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id TEXT NOT NULL,
    restaurant_name TEXT NOT NULL,
    field TEXT NOT NULL,
    severity TEXT NOT NULL,
    source_a TEXT NOT NULL,
    value_a TEXT NOT NULL,
    source_b TEXT NOT NULL,
    value_b TEXT NOT NULL,
    similarity REAL,
    distance_meters REAL,
    min_match_confidence REAL,
    evidence TEXT NOT NULL,
    resolution TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
  );
`)

const insert = db.prepare(`
  INSERT INTO restaurant_field_conflicts
    (restaurant_id, restaurant_name, field, severity, source_a, value_a, source_b, value_b,
     similarity, distance_meters, min_match_confidence, evidence, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

const createdAt = new Date().toISOString()
const emitted = new Set()

function emit(restaurant, field, severity, a, b, metrics = {}) {
  const ordered = [a, b].sort((x, y) => x.source.localeCompare(y.source))
  const key = `${restaurant.id}:${field}:${ordered[0].source}:${ordered[1].source}`
  if (emitted.has(key)) return
  emitted.add(key)
  const serialize = value => typeof value === 'string' ? value : JSON.stringify(value)
  insert.run(
    restaurant.id, restaurant.nombre, field, severity,
    ordered[0].source, serialize(ordered[0].value), ordered[1].source, serialize(ordered[1].value),
    metrics.similarity ?? null, metrics.distance ?? null,
    Math.min(a.confidence, b.confidence),
    JSON.stringify({ trustedSources: [a.source, b.source].filter(source => TRUSTED.has(source)), ...metrics }),
    createdAt,
  )
}

db.exec('BEGIN')
try {
  for (const [restaurantId, fields] of candidatesById) {
    const restaurant = restaurantById.get(restaurantId)

    for (const [a, b] of pairs(fields.phone || [])) {
      const left = phoneNorm(a.value), right = phoneNorm(b.value)
      if (left && right && left !== right) {
        emit(restaurant, 'phone', Math.min(a.confidence, b.confidence) >= 0.9 ? 'high' : 'medium', a, b)
      }
    }

    for (const [a, b] of pairs(fields.address || [])) {
      const leftNumbers = addressNumbers(a.value)
      const rightNumbers = addressNumbers(b.value)
      if (!leftNumbers.size || !rightNumbers.size) continue
      const score = similarity(a.value, b.value, addressTokens)
      if (score === null || score >= 0.4) continue
      const trusted = TRUSTED.has(a.source) || TRUSTED.has(b.source)
      const sharedNumber = [...leftNumbers].some(number => rightNumbers.has(number))
      const severity = !sharedNumber && trusted && Math.min(a.confidence, b.confidence) >= 0.9 ? 'high' : 'medium'
      emit(restaurant, 'address', severity, a, b, { similarity: score })
    }

    for (const [a, b] of pairs(fields.name || [])) {
      const left = nameNorm(a.value), right = nameNorm(b.value)
      if (!left || !right || left === right) continue
      const score = similarity(left, right)
      if (score !== null && score < 0.3) {
        const severity = score === 0 && Math.min(a.confidence, b.confidence) >= 0.9 ? 'high' : 'medium'
        emit(restaurant, 'name', severity, a, b, { similarity: score })
      }
    }

    for (const [a, b] of pairs(fields.website || [])) {
      const left = officialHost(a.value), right = officialHost(b.value)
      if (left && right && left !== right && !left.endsWith(`.${right}`) && !right.endsWith(`.${left}`)) {
        emit(restaurant, 'website', 'medium', a, b)
      }
    }

    for (const [a, b] of pairs(fields.coordinates || [])) {
      const distance = distanceMeters(a.value, b.value)
      if (distance > 300) {
        emit(restaurant, 'coordinates', distance > 1000 ? 'high' : 'medium', a, b, { distance: Math.round(distance) })
      }
    }
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

db.exec(`
  CREATE INDEX idx_field_conflicts_restaurant ON restaurant_field_conflicts(restaurant_id);
  CREATE INDEX idx_field_conflicts_review ON restaurant_field_conflicts(resolution, severity, field);
  DROP VIEW IF EXISTS restaurant_conflict_summary;
  CREATE VIEW restaurant_conflict_summary AS
  SELECT
    restaurant_id,
    restaurant_name,
    SUM(severity = 'high') AS high_conflicts,
    SUM(severity = 'medium') AS medium_conflicts,
    COUNT(DISTINCT CASE WHEN severity = 'high' THEN field END) AS high_fields,
    GROUP_CONCAT(DISTINCT CASE WHEN severity = 'high' THEN field END) AS critical_fields,
    COUNT(*) AS total_conflicts
  FROM restaurant_field_conflicts
  WHERE resolution = 'open'
  GROUP BY restaurant_id, restaurant_name;
`)

const summary = db.prepare(`
  SELECT severity, field, COUNT(*) AS count
  FROM restaurant_field_conflicts
  GROUP BY severity, field
  ORDER BY CASE severity WHEN 'high' THEN 1 ELSE 2 END, count DESC
`).all()
const total = db.prepare('SELECT COUNT(*) AS count FROM restaurant_field_conflicts').get().count
const impacted = db.prepare('SELECT COUNT(*) AS count FROM restaurant_conflict_summary').get().count
console.log(`Audit local terminé : ${total} conflits ouverts`)
console.log(`${impacted} restaurants concernés`)
for (const row of summary) console.log(`${row.severity.padEnd(6)} ${row.field.padEnd(12)} ${row.count}`)
console.log(DB_PATH)
db.close()
