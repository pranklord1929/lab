// Snapshot officiel Star Wine List — Mexico City, édition consultée en 2026.
// Signal premium/vin. Les listes officielles sont petites et éditorialisées.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'star_wine_list'
const TODAY = new Date().toISOString().slice(0, 10)
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)
const RESTAURANTS_URL = 'https://starwinelist.com/restaurants/mexico-city'
const BARS_URL = 'https://starwinelist.com/wine-bars/mexico-city'

const RESTAURANTS = [
  'Alfredo di Roma', 'Au Pied de Cochon', 'Brutal', 'Café Milou', 'Chapulín',
  'La Cave Club France', 'Lago | Algo', 'Loretta', 'Maximo Bistrot', 'NIV',
  'Piazza Pasticcio', 'Plonk', 'Prime Steak Club', 'Pujol', 'Quintonil',
  'Raíz', 'Sarde', 'Sartoria', 'Sepia', 'The Palm', 'Zeru Lomas',
  // Présents dans la vue combinée officielle en 2026.
  'Pardela', 'Sud 777',
]

const WINE_BARS = [
  'Cicatriz', 'Cuvée 09', 'Granate', 'Hugo', 'Lenez', 'Local 1', 'Loup Bar',
  'Manarola', 'NIV', 'Plonk', 'Si Mon', 'Somma', 'Tannin Artbar',
  'Tierras de Uva', 'Vigneron', 'Wine Bar by Concours Mondial de Bruxelles',
]

function slug(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const names = new Map()
for (const name of RESTAURANTS) names.set(name, ['restaurant'])
for (const name of WINE_BARS) {
  const categories = names.get(name) || []
  names.set(name, [...categories, 'wine_bar'])
}

const records = [...names].map(([name, categories]) => ({
  source_id: `mexico-city:${slug(name)}`,
  name,
  latitude: null,
  longitude: null,
  address: 'Mexico City, Mexico',
  phone: null,
  website: null,
  payload: {
    publisher: 'Star Wine List',
    signal: 'wine_program_editorial_selection',
    signalTier: 'A',
    editionYear: 2026,
    categories,
    city: 'Mexico City',
    source_url: categories.includes('wine_bar') ? BARS_URL : RESTAURANTS_URL,
  },
}))

await mkdir(OUT_DIR, { recursive: true })
await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
console.log(`Écrit : ${OUT_FILE} (${records.length} records)`)
