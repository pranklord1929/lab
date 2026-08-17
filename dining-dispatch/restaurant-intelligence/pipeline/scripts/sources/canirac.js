// Répertoire SafeTravels CANIRAC — signal officiel historique de conformité.
// Les entrées servent à enrichir/valider une identité, jamais à présumer
// qu'un établissement est encore ouvert aujourd'hui.

import { mkdir, writeFile } from 'fs/promises'
import { resolve } from 'path'

const SOURCE = 'canirac_safetravels'
const TODAY = new Date().toISOString().slice(0, 10)
const URL = 'https://safetravels.canirac.org.mx/'
const OUT_DIR = resolve('data/raw', SOURCE)
const OUT_FILE = resolve(OUT_DIR, `${TODAY}.json`)

function decode(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&aacute;/gi, 'á').replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í').replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú').replace(/&ntilde;/gi, 'ñ')
    .replace(/\s+/g, ' ')
    .trim()
}

function postalCode(address) {
  return address.match(/\b(0\d{4}|1[0-6]\d{3})\b/)?.[1] || null
}

function parse(html) {
  const records = new Map()
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map(match => decode(match[1]))
    if (cells.length < 3) continue
    const [name, address, folio] = cells
    if (!name || !address || !folio || /restaurante/i.test(name) && /direcci[oó]n/i.test(address)) continue
    if (!/^\w?[\w-]{2,20}$/.test(folio.replace(/\s/g, ''))) continue
    if (!/CDMX|Ciudad de M[eé]xico|M[eé]xico D\.?F\.?/i.test(address)) continue

    const sourceId = folio.replace(/\s+/g, '')
    records.set(sourceId, {
      source_id: sourceId,
      name,
      latitude: null,
      longitude: null,
      address,
      phone: null,
      website: null,
      payload: {
        publisher: 'CANIRAC',
        signal: 'safe_travels_certification',
        historical: true,
        folio: sourceId,
        postalCode: postalCode(address),
        source_url: URL,
        caveat: 'Historic certification signal; does not prove current operating status.',
      },
    })
  }
  return [...records.values()]
}

async function main() {
  const response = await fetch(URL, {
    headers: { 'User-Agent': 'CDMX Restaurant Data Research/1.0' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const records = parse(await response.text())
  if (records.length < 20) throw new Error(`Parsing suspect: ${records.length} records`)
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(OUT_FILE, JSON.stringify(records, null, 2))
  console.log(`Écrit : ${OUT_FILE} (${records.length} records)`)
}

main().catch(error => { console.error(error); process.exit(1) })
