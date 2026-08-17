// Extrait le texte des 317 liens menus depuis data/menu_links.json
// HTML → cheerio. PDF → pdf-parse. Concurrence 8.
// Output : data/menu_texts.json | Flag : --import pour Supabase

import { createClient } from '@supabase/supabase-js'
import { readFile, writeFile } from 'fs/promises'
import { resolve } from 'path'
import https from 'https'
import http from 'http'
import 'dotenv/config'

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const importDb = process.argv.includes('--import')
const CONCURRENCY = 8
const OUTPUT = resolve('data/menu_texts.json')
const sleep = ms => new Promise(r => setTimeout(r, ms))

class Semaphore {
  constructor(n) { this.n = n; this.q = [] }
  async acquire() { if (this.n > 0) { this.n--; return } await new Promise(r => this.q.push(r)); this.n-- }
  release() { this.n++; if (this.q.length) this.q.shift()() }
}

const sslAgent = new https.Agent({ rejectUnauthorized: false })
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.7',
}

async function fetchUrl(url, timeout = 15000) {
  const isHttps = url.startsWith('https')
  const mod = isHttps ? https : http
  const opts = { headers: HEADERS, timeout }
  if (isHttps) opts.agent = sslAgent

  return new Promise((res, rej) => {
    const req = mod.get(url, opts, r => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode) && r.headers.location) {
        const next = r.headers.location.startsWith('http') ? r.headers.location : new URL(r.headers.location, url).href
        return fetchUrl(next, timeout).then(res).catch(rej)
      }
      const chunks = []
      r.on('data', c => chunks.push(c))
      r.on('end', () => res({ status: r.statusCode, ct: r.headers['content-type'] || '', body: Buffer.concat(chunks) }))
      r.on('error', rej)
    })
    req.on('error', rej)
    req.on('timeout', () => { req.destroy(); rej(new Error('timeout')) })
    setTimeout(() => { req.destroy(); rej(new Error('timeout')) }, timeout)
  })
}

function htmlToText(buf) {
  let s = buf.toString('utf8')
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
       .replace(/<style[\s\S]*?<\/style>/gi, ' ')
       .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
       .replace(/<header[\s\S]*?<\/header>/gi, ' ')
       .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
       .replace(/<[^>]+>/g, ' ')
       .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
       .replace(/\s+/g, ' ').trim()
  // Keep lines that look menu-relevant
  const lines = s.split(/[;]|(?<=[?.!])\s+/).map(l => l.trim()).filter(l => l.length > 3 && l.length < 400)
  return lines.slice(0, 1000).join(' ').slice(0, 8000)
}

async function pdfToText(buf) {
  try {
    const { default: pdfParse } = await import('pdf-parse')
    const data = await pdfParse(buf)
    return (data.text || '').replace(/\s+/g, ' ').trim().slice(0, 8000)
  } catch { return '' }
}

async function processLink(link) {
  try {
    const r = await fetchUrl(link.url)
    if (!r || r.status < 200 || r.status >= 400) return null
    const isPdf = r.ct.includes('pdf') || link.url.toLowerCase().endsWith('.pdf')
    const text = isPdf ? await pdfToText(r.body) : htmlToText(r.body)
    if (!text || text.length < 50) return null
    return { ...link, menuText: text, len: text.length }
  } catch { return null }
}

async function main() {
  const links = JSON.parse(await readFile('data/menu_links.json', 'utf8'))
  console.log(`Menu text scraper | ${links.length} liens | concurrence ${CONCURRENCY}`)

  // Max 3 liens par restaurant pour pas noyer
  const byId = {}
  for (const l of links) {
    if (!byId[l.id]) byId[l.id] = []
    if (byId[l.id].length < 3) byId[l.id].push(l)
  }
  const queue = Object.values(byId).flat()
  console.log(`${queue.length} après dédup (max 3/restaurant)`)

  const sem = new Semaphore(CONCURRENCY)
  let ok = 0, fail = 0
  const results = []

  await Promise.all(queue.map(async (link, i) => {
    await sem.acquire()
    try {
      const r = await processLink(link)
      if (r) { results.push(r); ok++; process.stdout.write(`✓`) }
      else { fail++; process.stdout.write(`✗`) }
      if ((ok + fail) % 40 === 0) process.stdout.write(` ${ok+fail}/${queue.length}\n`)
    } finally { sem.release() }
    await sleep(100)
  }))

  process.stdout.write('\n')

  // Agréger par restaurant
  const byRestaurant = {}
  for (const r of results) {
    if (!byRestaurant[r.id]) byRestaurant[r.id] = { id: r.id, name: r.name, texts: [] }
    byRestaurant[r.id].texts.push(r.menuText)
  }
  const aggregated = Object.values(byRestaurant).map(r => ({
    id: r.id, name: r.name,
    menuText: r.texts.join('\n\n---\n\n'),
    sourceCount: r.texts.length,
  }))

  await writeFile(OUTPUT, JSON.stringify(aggregated, null, 2))
  console.log(`\n✓ ${ok} extraits | ✗ ${fail} échecs`)
  console.log(`${aggregated.length} restaurants avec menu text`)
  console.log(`Export: ${OUTPUT}`)

  if (importDb) {
    console.log('\nImport Supabase...')
    let upd = 0, err = 0
    for (const r of aggregated) {
      const { error } = await supabase.from('restaurants').update({ menu_text: r.menuText }).eq('id', r.id)
      if (error) err++; else upd++
    }
    console.log(`${upd} mis à jour | ${err} erreurs`)
  }
}

main().catch(e => { console.error(e.message); process.exit(1) })
