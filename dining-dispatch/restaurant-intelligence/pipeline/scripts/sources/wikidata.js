// Restaurants/cafés/bars notables de CDMX présents dans Wikidata.
// Source CC0 : coordonnées, site officiel, cuisine, image, date de création.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'wikidata'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)
const ENDPOINT = 'https://query.wikidata.org/sparql'

const QUERY = `
SELECT ?item ?itemLabel ?coord ?website ?image ?inception ?cuisineLabel WHERE {
  VALUES ?type { wd:Q11707 wd:Q30022 wd:Q187456 }
  ?item wdt:P31/wdt:P279* ?type; wdt:P625 ?coord.
  SERVICE wikibase:around {
    ?item wdt:P625 ?location.
    bd:serviceParam wikibase:center "Point(-99.1332 19.4326)"^^geo:wktLiteral;
                    wikibase:radius "35".
  }
  OPTIONAL { ?item wdt:P856 ?website. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P2012 ?cuisine. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "es,en". }
}
LIMIT 1000`

function coordinates(wkt) {
  const match = String(wkt || '').match(/Point\((-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\)/)
  return match ? { longitude: Number(match[1]), latitude: Number(match[2]) } : {}
}

async function main() {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(QUERY)}`
  const response = await fetch(url, {
    signal: AbortSignal.timeout(45000),
    headers: {
      Accept: 'application/sparql-results+json',
      'User-Agent': 'CDMXRestaurantResearch/1.0 (public data enrichment)',
    },
  })
  if (!response.ok) throw new Error(`Wikidata HTTP ${response.status}`)
  const json = await response.json()
  const grouped = new Map()

  for (const binding of json.results?.bindings || []) {
    const qid = binding.item?.value?.split('/').at(-1)
    if (!qid || !binding.itemLabel?.value || binding.itemLabel.value === qid) continue
    if (!grouped.has(qid)) {
      const coord = coordinates(binding.coord?.value)
      grouped.set(qid, {
        source_id: qid,
        name: binding.itemLabel.value,
        latitude: coord.latitude ?? null,
        longitude: coord.longitude ?? null,
        address: null,
        phone: null,
        website: binding.website?.value || null,
        payload: {
          source: SOURCE,
          wikidataId: qid,
          wikidataUrl: `https://www.wikidata.org/wiki/${qid}`,
          cuisines: [],
          websites: [],
          image: binding.image?.value || null,
          inception: binding.inception?.value || null,
          license: 'CC0',
          source_url: `https://www.wikidata.org/wiki/${qid}`,
        },
      })
    }
    const row = grouped.get(qid)
    if (binding.cuisineLabel?.value && !row.payload.cuisines.includes(binding.cuisineLabel.value)) {
      row.payload.cuisines.push(binding.cuisineLabel.value)
    }
    if (binding.website?.value && !row.payload.websites.includes(binding.website.value)) {
      row.payload.websites.push(binding.website.value)
    }
    row.website ||= binding.website?.value || null
    row.payload.image ||= binding.image?.value || null
    row.payload.inception ||= binding.inception?.value || null
  }

  const records = [...grouped.values()]
  if (records.length < 10) throw new Error(`Résultat Wikidata suspect : ${records.length}`)
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
  console.log(`Écrit : ${OUT_FILE} (${records.length} records)`)
}

main().catch(error => { console.error(error); process.exit(1) })
