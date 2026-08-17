// Builds one consolidated, traceable restaurant row inside the local SQLite DB.
// Raw tables stay untouched. Re-run after each `npm run export:local`.
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const DB_PATH = resolve('data/local_db/cdmx_local.sqlite')
const db = new DatabaseSync(DB_PATH)

function text(value) {
  if (value === null || value === undefined) return null
  const clean = String(value).trim()
  return clean || null
}

function json(value) {
  if (!value) return {}
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch { return {} }
}

function number(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function first(...candidates) {
  for (const [value, source] of candidates) {
    if (value !== null && value !== undefined && value !== '') return { value, source }
  }
  return { value: null, source: null }
}

function canonicalAddress(r) {
  const street = [r.tipo_vialidad, r.nom_vialidad, r.numero_exterior, r.numero_interior]
    .map(text).filter(Boolean).join(' ')
  return [street, text(r.colonia), text(r.alcaldia), text(r.cp)].filter(Boolean).join(', ') || null
}

function imageArray(value) {
  if (!value) return null
  if (Array.isArray(value)) return value.length ? value : null
  return [value]
}

function candidate(source, value) {
  return [text(value), source]
}

const sourceMaps = new Map()
const sourceNames = new Map()
const freshestAt = new Map()
const sourceRows = db.prepare(`
  SELECT * FROM source_records
  WHERE matched_restaurant_id IS NOT NULL
  ORDER BY scrape_date DESC, scraped_at DESC
`).all()

for (const row of sourceRows) {
  const restaurantId = row.matched_restaurant_id
  if (!sourceMaps.has(restaurantId)) sourceMaps.set(restaurantId, new Map())
  const bySource = sourceMaps.get(restaurantId)
  if (!bySource.has(row.source)) bySource.set(row.source, { ...row, payload: json(row.payload) })
  if (!sourceNames.has(restaurantId)) sourceNames.set(restaurantId, new Set())
  sourceNames.get(restaurantId).add(row.source)
  if (!freshestAt.has(restaurantId) || row.scraped_at > freshestAt.get(restaurantId)) {
    freshestAt.set(restaurantId, row.scraped_at)
  }
}

const linksByRestaurant = new Map()
const linkRows = db.prepare(`
  SELECT * FROM restaurant_links
  WHERE status = 'valid'
  ORDER BY (status = 'valid') DESC, confidence_score DESC, checked_at DESC
`).all()
for (const row of linkRows) {
  if (!linksByRestaurant.has(row.restaurant_id)) linksByRestaurant.set(row.restaurant_id, [])
  linksByRestaurant.get(row.restaurant_id).push(row)
}

function bestLink(links, predicate) {
  const found = links.find(predicate)
  return found ? text(found.final_url) || text(found.url) : null
}

db.exec(`
  DROP TABLE IF EXISTS restaurant_golden_record;
  CREATE TABLE restaurant_golden_record (
    restaurant_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    website TEXT,
    instagram TEXT,
    facebook TEXT,
    opening_hours TEXT,
    cuisine TEXT,
    latitude REAL,
    longitude REAL,
    rating REAL,
    review_count INTEGER,
    price_level TEXT,
    photos TEXT,
    photo_count INTEGER NOT NULL,
    description TEXT,
    michelin_distinction TEXT,
    michelin_stars INTEGER NOT NULL,
    bib_gourmand INTEGER NOT NULL,
    distinctions TEXT NOT NULL,
    prestige_score REAL NOT NULL,
    google_place_id TEXT,
    verified_open INTEGER,
    statut TEXT,
    categorie TEXT,
    alcaldia TEXT,
    colonia TEXT,
    cp TEXT,
    source_count INTEGER NOT NULL,
    source_names TEXT NOT NULL,
    freshest_source_at TEXT,
    richness_score INTEGER NOT NULL,
    field_provenance TEXT NOT NULL,
    canonical_updated_at TEXT,
    generated_at TEXT NOT NULL
  );
`)

const insert = db.prepare(`
  INSERT INTO restaurant_golden_record VALUES (
    ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
  )
`)

const restaurants = db.prepare('SELECT * FROM restaurants').all()
const generatedAt = new Date().toISOString()

db.exec('BEGIN')
try {
  for (const r of restaurants) {
    const sources = sourceMaps.get(r.id) || new Map()
    const get = name => sources.get(name) || { payload: {} }
    const google = get('google_places')
    const michelin = get('michelin')
    const opentable = get('opentable')
    const resy = get('resy')
    const reservandonos = get('reservandonos')
    const foursquare = get('foursquare')
    const didifood = get('didifood_web')
    const guru = get('restaurantguru')
    const wikidata = get('wikidata')
    const mexicoGastro = get('mexico_gastronomico')
    const worlds50best = get('worlds50best')
    const laListe = get('laliste')
    const starWineList = get('star_wine_list')
    const tesoros = get('tesoros_mexico')
    const links = linksByRestaurant.get(r.id) || []

    const verifiedWebsite = bestLink(links, link => link.link_type === 'official_site')
    const verifiedInstagram = bestLink(links, link => link.provider === 'instagram')
    const verifiedFacebook = bestLink(links, link => link.provider === 'facebook')

    const name = first(
      candidate('google_places', google.name),
      candidate('google_places', google.payload?.displayName?.text),
      candidate('michelin', michelin.name),
      candidate('opentable', opentable.name),
      candidate('resy', resy.name),
      candidate('reservandonos', reservandonos.name),
      candidate('foursquare', foursquare.name),
      candidate(r.source, r.nombre),
    )
    const address = first(
      candidate('google_places', google.address),
      candidate('google_places', google.payload?.formattedAddress),
      candidate('michelin', michelin.address),
      candidate('opentable', opentable.address),
      candidate('resy', resy.address),
      candidate('reservandonos', reservandonos.address),
      candidate('foursquare', foursquare.address),
      candidate('didifood_web', didifood.address),
      candidate(r.source, canonicalAddress(r)),
    )
    const phone = first(
      candidate('google_places', google.payload?.internationalPhoneNumber),
      candidate('google_places', google.payload?.nationalPhoneNumber),
      candidate('opentable', opentable.phone),
      candidate('resy', resy.phone),
      candidate('michelin', michelin.phone),
      candidate('reservandonos', reservandonos.phone),
      candidate('foursquare', foursquare.phone),
      candidate(r.source, r.telefono),
    )
    const website = first(
      candidate('restaurant_links', verifiedWebsite),
      candidate('google_places', google.payload?.websiteUri),
      candidate('michelin', michelin.website),
      candidate('foursquare', foursquare.website),
      candidate('wikidata', wikidata.website),
      candidate(r.source, r.sitio_web),
    )
    const instagram = first(
      candidate('restaurant_links', verifiedInstagram),
      candidate(r.source, r.instagram),
      candidate('mexico_gastronomico', mexicoGastro.payload?.instagram?.[0]),
      candidate('restaurantguru', guru.payload?.instagram),
    )
    const facebook = first(
      candidate('restaurant_links', verifiedFacebook),
      candidate(r.source, r.facebook),
    )
    const hours = first(
      [google.payload?.regularOpeningHours?.weekdayDescriptions || null, 'google_places'],
      candidate(r.source, r.horaires),
      [michelin.payload?.hoursOfOperation || null, 'michelin'],
      [reservandonos.payload?.schedules || reservandonos.payload?.schedule || null, 'reservandonos'],
      [guru.payload?.hours || null, 'restaurantguru'],
    )
    const cuisine = first(
      candidate('google_places', google.payload?.primaryType),
      candidate(r.source, r.cuisine_type),
      candidate('michelin', michelin.payload?.cuisine),
      candidate('opentable', opentable.payload?.cuisine),
      candidate('resy', resy.payload?.cuisine),
      [reservandonos.payload?.cuisines?.join(', ') || null, 'reservandonos'],
      candidate('didifood_web', didifood.payload?.category),
      candidate('restaurantguru', guru.payload?.cuisine),
    )
    const latitude = first(
      [number(google.latitude), 'google_places'],
      [number(google.payload?.location?.latitude), 'google_places'],
      [number(michelin.latitude), 'michelin'],
      [number(opentable.latitude), 'opentable'],
      [number(resy.latitude), 'resy'],
      [number(reservandonos.latitude), 'reservandonos'],
      [number(foursquare.latitude), 'foursquare'],
      [number(r.latitud), r.source],
    )
    const longitude = first(
      [number(google.longitude), 'google_places'],
      [number(google.payload?.location?.longitude), 'google_places'],
      [number(michelin.longitude), 'michelin'],
      [number(opentable.longitude), 'opentable'],
      [number(resy.longitude), 'resy'],
      [number(reservandonos.longitude), 'reservandonos'],
      [number(foursquare.longitude), 'foursquare'],
      [number(r.longitud), r.source],
    )
    const rating = first(
      [number(google.payload?.rating), 'google_places'],
      [number(opentable.payload?.rating), 'opentable'],
      [number(guru.payload?.rating), 'restaurantguru'],
      [number(resy.payload?.rating?.average ?? resy.payload?.rating), 'resy'],
      [number(reservandonos.payload?.rating), 'reservandonos'],
      [number(didifood.payload?.rating), 'didifood_web'],
    )
    const reviewCount = first(
      [number(google.payload?.userRatingCount), 'google_places'],
      [number(opentable.payload?.reviewCount), 'opentable'],
      [number(guru.payload?.reviewCount), 'restaurantguru'],
      [number(resy.payload?.rating?.count), 'resy'],
      [number(reservandonos.payload?.review_count), 'reservandonos'],
    )
    const price = first(
      candidate('google_places', google.payload?.priceLevel),
      candidate('opentable', opentable.payload?.priceBandId),
      candidate('resy', resy.payload?.priceRangeId),
      candidate('reservandonos', reservandonos.payload?.price_range),
      candidate(r.source, r.gamme_prix),
    )
    const photos = first(
      [imageArray(google.payload?.photos), 'google_places'],
      [imageArray(michelin.payload?.images || michelin.payload?.raw?.images || michelin.payload?.image), 'michelin'],
      [imageArray(resy.payload?.images), 'resy'],
      [imageArray(reservandonos.payload?.gallery || reservandonos.payload?.image_url), 'reservandonos'],
      [imageArray(guru.payload?.image), 'restaurantguru'],
    )
    const description = first(
      candidate('google_places', google.payload?.editorialSummary?.text),
      candidate('michelin', michelin.payload?.review),
      candidate('opentable', opentable.payload?.description),
    )

    const michelinStars = number(michelin.payload?.michelinStars) ?? 0
    const bibGourmand = Boolean(michelin.payload?.bibGourmand)
    const michelinDistinction = text(michelin.payload?.distinction)
    const distinctions = []
    if (michelinDistinction) distinctions.push({
      source: 'michelin', type: bibGourmand ? 'bib_gourmand' : 'michelin',
      label: michelinDistinction, stars: michelinStars,
      year: number(michelin.payload?.guideYear), url: text(michelin.payload?.michelinUrl),
    })
    if (number(worlds50best.payload?.rank) !== null) distinctions.push({
      source: 'worlds50best', type: 'ranking', rank: number(worlds50best.payload?.rank),
      list: text(worlds50best.payload?.awardBody), tier: text(worlds50best.payload?.signalTier),
      year: number(worlds50best.payload?.editionYear), url: text(worlds50best.payload?.url),
    })
    if (number(laListe.payload?.score) !== null) distinctions.push({
      source: 'laliste', type: 'score', score: number(laListe.payload?.score),
      year: number(laListe.payload?.editionYear), url: text(laListe.payload?.source_url),
    })
    if (mexicoGastro.payload?.selected) distinctions.push({
      source: 'mexico_gastronomico', type: 'selection',
      year: number(mexicoGastro.payload?.editionYear), url: text(mexicoGastro.payload?.source_url),
    })
    if (starWineList.source_id) distinctions.push({
      source: 'star_wine_list', type: 'wine_selection', tier: text(starWineList.payload?.signalTier),
      url: text(starWineList.payload?.source_url),
    })
    if (tesoros.source_id) distinctions.push({
      source: 'tesoros_mexico', type: 'heritage_selection', url: text(tesoros.payload?.source_url),
    })
    const prestigeScore =
      michelinStars * 10 + (bibGourmand ? 6 : 0) +
      (number(worlds50best.payload?.rank) !== null ? (number(worlds50best.payload?.rank) <= 50 ? 8 : 5) : 0) +
      (number(laListe.payload?.score) >= 90 ? 6 : 0) +
      (mexicoGastro.payload?.selected ? 2 : 0) +
      (starWineList.source_id ? 2 : 0) + (tesoros.source_id ? 2 : 0)

    const provenance = Object.fromEntries(Object.entries({
      name, address, phone, website, instagram, facebook, opening_hours: hours,
      cuisine, coordinates: latitude.value !== null && longitude.value !== null
        ? { source: latitude.source === longitude.source ? latitude.source : `${latitude.source}+${longitude.source}` }
        : { source: null },
      rating, review_count: reviewCount, price_level: price, photos, description,
    }).filter(([, result]) => result.source))

    const richness = [phone, website, hours, cuisine, rating, photos, description]
      .filter(result => result.value !== null).length
    const names = [...(sourceNames.get(r.id) || [])].sort()

    insert.run(
      r.id, name.value, address.value, phone.value, website.value, instagram.value,
      facebook.value, hours.value === null ? null : JSON.stringify(hours.value), cuisine.value,
      latitude.value, longitude.value, rating.value, reviewCount.value, price.value,
      photos.value === null ? null : JSON.stringify(photos.value), photos.value?.length || 0, description.value,
      michelinDistinction, michelinStars, bibGourmand ? 1 : 0, JSON.stringify(distinctions), prestigeScore,
      r.google_place_id, r.verified_open, r.statut, r.categorie, r.alcaldia, r.colonia, r.cp,
      names.length, JSON.stringify(names), freshestAt.get(r.id) || null, richness,
      JSON.stringify(Object.fromEntries(Object.entries(provenance).map(([field, result]) => [field, result.source]))),
      r.updated_at, generatedAt,
    )
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

db.exec(`
  CREATE INDEX idx_golden_richness ON restaurant_golden_record(richness_score DESC);
  CREATE INDEX idx_golden_sources ON restaurant_golden_record(source_count DESC);
  CREATE INDEX idx_golden_name ON restaurant_golden_record(name COLLATE NOCASE);
  CREATE INDEX idx_golden_alcaldia ON restaurant_golden_record(alcaldia);
`)

const stats = db.prepare(`
  SELECT
    COUNT(*) AS total,
    SUM(source_count > 0) AS with_external_source,
    SUM(source_count >= 2) AS multi_source,
    SUM(richness_score >= 5) AS rich_5_plus,
    SUM(phone IS NOT NULL) AS with_phone,
    SUM(website IS NOT NULL) AS with_website,
    SUM(opening_hours IS NOT NULL) AS with_hours,
    SUM(rating IS NOT NULL) AS with_rating,
    SUM(photos IS NOT NULL) AS with_photos
  FROM restaurant_golden_record
`).get()

console.log(`Golden record local créé : ${stats.total} restaurants`)
console.log(`Sources externes : ${stats.with_external_source} | multi-source : ${stats.multi_source}`)
console.log(`Richness >= 5/7 : ${stats.rich_5_plus}`)
console.log(`Téléphone ${stats.with_phone} | site ${stats.with_website} | horaires ${stats.with_hours} | note ${stats.with_rating} | photos ${stats.with_photos}`)
console.log(DB_PATH)
db.close()
