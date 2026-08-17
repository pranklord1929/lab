// Convertit le checkpoint produit via Chrome en dump ingestable.
// Seules les pages ayant un JSON-LD Restaurant valide sont conservées.

import { mkdir, readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'

const date = process.argv.find(arg => arg.startsWith('--date='))?.split('=')[1]
  || new Date().toISOString().slice(0, 10)
const dir = resolve('data/raw/restaurantguru')
const checkpoint = resolve(dir, `chrome_details_checkpoint_${date}.json`)
const output = resolve(dir, `${date}.json`)

const raw = JSON.parse(await readFile(checkpoint, 'utf8'))
const records = (raw.records || []).filter(row => row.detail_status === 'ok')
const unique = [...new Map(records.map(row => [row.source_id, row])).values()]

if (unique.length === 0) throw new Error('Aucune page Restaurant Guru valide dans le checkpoint')
await mkdir(dir, { recursive: true })
await writeFile(output, JSON.stringify(unique, null, 2))
console.log(`Écrit : ${output} (${unique.length} records enrichis)`)
