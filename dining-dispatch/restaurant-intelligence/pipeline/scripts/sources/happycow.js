// HappyCow — Top 10 Vegan / Vegetarian Restaurants, Mexico City 2026.
// Snapshot factuel : rang, note, volume d'avis, téléphone, adresse et tags.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'happycow'
const TODAY = new Date().toISOString().slice(0, 10)
const LIST_URL = 'https://www.happycow.net/best-vegan-restaurants/mexico-city-mexico'
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

const rows = [
  [45855, 'por-siempre-vegana', 'Por Siempre Vegana - Food Stall', 5.0, 161, '+52-5539237976', 'Coahuila 169, Roma Norte, Mexico City, Mexico', ['vegan','fast_food','mexican','breakfast','takeout']],
  [181769, 'na-tlali', 'Na Tlali', 5.0, 96, '+52-5552058249', 'Avenida de la Paz 57, San Ángel, Mexico City, Mexico, 01000', ['vegan','mexican','bakery','delivery','takeout','beer_wine']],
  [85756, 'taco-vegan', 'VEGuerrero', 5.0, 149, '+52-5588481263', 'Calle Ignacio Zaragoza 53, Buenavista, Mexico City, Mexico', ['vegan','fast_food','mexican','takeout']],
  [95474, 'malportaco', 'Malportaco', 5.0, 72, '+52-5527302832', 'Diagonal San Antonio 1725, Narvarte Oriente, Mexico City, Mexico', ['vegan','fast_food','mexican','takeout','beer_wine']],
  [151676, 'gracias-madre', 'Gracias Madre', 4.5, 212, '+52-5567915634', 'Tabasco 97 local B, Roma Norte, Mexico City, Mexico', ['vegan','fast_food','mexican','delivery','takeout']],
  [313253, 'vegan-ramen-mei', 'Vegan Ramen Mei - Condesa', 5.0, 122, null, 'Avenida Tamaulipas 155, Condesa, Mexico City, Mexico', ['vegan','japanese','asian','ramen','delivery','takeout']],
  [64361, 'gatorta', 'Gatorta - Food Stand', 5.0, 161, '+52-5530384404', 'Puebla 182 esquina con Insurgentes, Roma, Mexico City, Mexico', ['vegan','fast_food','mexican','bakery','takeout']],
  [71451, 'viko', 'Viko', 5.0, 115, '+52-5527478475', 'Pasaje Chapultepec local 29, Mexico City, Mexico', ['vegan','fast_food','mexican','delivery','takeout']],
  [349760, 'taco-santo', 'Taco Santo', 5.0, 41, '+52-5571590323', 'Chihuahua 142, Cuauhtémoc, Mexico City, Mexico', ['vegan','fast_food','mexican','gluten_free','delivery','takeout']],
  [277678, 'la-plantisqueria', 'La Plantisquería', 5.0, 55, '+52-5525634973', 'Chihuahua 207, Roma Norte, Cuauhtémoc, Mexico City, Mexico', ['vegan','fast_food','mexican','seafood_style','delivery','takeout']],
]

const records = rows.map(([id, slug, name, rating, reviewCount, phone, address, tags], index) => ({
  source_id: String(id),
  name,
  latitude: null,
  longitude: null,
  address,
  phone,
  website: null,
  payload: {
    publisher: 'HappyCow',
    signal: 'happycow_top_10_mexico_city',
    editionYear: 2026,
    rank: index + 1,
    rating,
    reviewCount,
    tags,
    vegan: true,
    source_url: `https://www.happycow.net/reviews/${slug}-mexico-city-${id}`,
    list_url: LIST_URL,
  },
}))

await mkdir(OUT_DIR, { recursive: true })
await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
console.log(`Écrit : ${OUT_FILE} (${records.length} records)`)
