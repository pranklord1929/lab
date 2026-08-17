// SECTUR — Tesoros de México 2020, restaurants explicitement nommés à CDMX.
// Source officielle : annuaire PDF national publié par la Secretaría de Turismo.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'tesoros_mexico'
const TODAY = new Date().toISOString().slice(0, 10)
const SOURCE_URL = 'https://www.sectur.gob.mx/wp-content/uploads/2020/09/LISTA-TESOROS-DE-M%C3%89XICO-AL-2020.pdf'
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

const rows = [
  [9, 'Los Danzantes', 'Coyoacán', 'https://www.losdanzantes.com'],
  [10, 'Corazón de Maguey', 'Coyoacán', 'https://www.corazondemaguey.com'],
  [11, 'El Cardenal Alameda', 'Cuauhtémoc', 'https://www.restauranteelcardenal.com'],
  [12, 'Hacienda de los Morales', 'Miguel Hidalgo', 'https://www.haciendalosmorales.com'],
  [14, 'Zéfiro', 'Cuauhtémoc', 'https://www.elclaustro.edu.mx'],
  [15, 'El Mayor', 'Cuauhtémoc', 'https://www.elmayor.com.mx'],
  [16, 'Mercaderes Enoteca', 'Cuauhtémoc', 'https://www.restaurantemercaderes.com'],
  [17, 'Azul Histórico', 'Cuauhtémoc', 'https://www.azulhistorico.com'],
  [18, 'Azul Condesa', 'Cuauhtémoc', 'https://www.azulcondesa.com'],
  [19, 'Pujol', 'Miguel Hidalgo', 'https://www.enriqueolivera.com'],
  [115, 'Limosneros', 'Cuauhtémoc', 'https://www.limosneros.com.mx'],
]

const records = rows.map(([directoryNumber, name, alcaldia, website]) => ({
  source_id: `tesoros-2020-${directoryNumber}`,
  name,
  latitude: null,
  longitude: null,
  address: `${alcaldia}, Ciudad de México, México`,
  phone: null,
  website,
  payload: {
    publisher: 'Secretaría de Turismo de México (SECTUR)',
    signal: 'tesoros_de_mexico',
    editionYear: 2020,
    directoryNumber,
    city: 'Ciudad de México',
    alcaldia,
    establishmentType: 'restaurant',
    officialRecognition: true,
    source_url: SOURCE_URL,
  },
}))

await mkdir(OUT_DIR, { recursive: true })
await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
console.log(`Écrit : ${OUT_FILE} (${records.length} records)`)
