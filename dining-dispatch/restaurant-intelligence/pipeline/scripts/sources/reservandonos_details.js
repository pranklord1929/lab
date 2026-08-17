// Enriches today's Reservandonos raw dump from public profile pages.
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const TODAY = new Date().toISOString().slice(0, 10)
const FILE = resolve('data/raw/reservandonos', `${TODAY}.json`)
const CONCURRENCY = 8
const TIMEOUT = 18000

function decodeNuxt(html) {
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) return null
  const table = JSON.parse(match[1])
  const cache = new Map()
  function ref(index) {
    if (index < 0) return null
    if (cache.has(index)) return cache.get(index)
    const node = table[index]
    if (node === null || typeof node !== 'object') return node
    if (Array.isArray(node)) {
      if (typeof node[0] === 'string' && ['ShallowReactive', 'Reactive', 'Set'].includes(node[0])) return ref(node[1])
      const array = []
      cache.set(index, array)
      for (const value of node) array.push(typeof value === 'number' ? ref(value) : value)
      return array
    }
    const object = {}
    cache.set(index, object)
    for (const [key, value] of Object.entries(node)) object[key] = typeof value === 'number' ? ref(value) : value
    return object
  }
  return ref(0)
}

async function detail(row) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const response = await fetch(row.payload.profile_url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const root = decodeNuxt(await response.text())
    const wrapper = Object.values(root?.data || {}).find(value => String(value?.data?.id) === String(row.source_id))
    const data = wrapper?.data
    if (!data) throw new Error('profile payload missing')
    const schema = data.schema || {}
    const geo = data.geolocation || {}
    return {
      ...row,
      latitude: Number(geo.latitude) || row.latitude,
      longitude: Number(geo.longitude) || row.longitude,
      address: geo.text_direction || schema.address?.streetAddress || row.address,
      phone: schema.telephone || row.phone,
      payload: {
        ...row.payload,
        description_html: data.description || null,
        gallery: (data.gallery || []).map(image => image.file).filter(Boolean),
        schedules: data.schedules || null,
        cuisines: (data.cuisines || []).map(item => item.name).filter(Boolean),
        amenities: (data.amenities || []).map(item => item.name).filter(Boolean),
        dress_code: data.dress_code || null,
        rating: Number(data.reviews?.totalScore ?? schema.aggregateRating?.ratingValue) || row.payload.rating,
        review_count: Number(data.reviews?.quantity ?? schema.aggregateRating?.reviewCount) || null,
        menu: data.menu || null,
        menu_pdf: data.menu_pdf || null,
        schema,
        geolocation: geo,
        detail_scraped_at: new Date().toISOString(),
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

const rows = JSON.parse(await readFile(FILE, 'utf8'))
let cursor = 0
let done = 0
const stats = { ok: 0, failed: 0 }
async function worker() {
  while (cursor < rows.length) {
    const index = cursor++
    try { rows[index] = await detail(rows[index]); stats.ok++ }
    catch (error) { rows[index].payload.detail_error = String(error.message); stats.failed++ }
    done++
    if (done % 50 === 0) {
      console.log(`${done}/${rows.length} — ok ${stats.ok}, failed ${stats.failed}`)
      await writeFile(FILE, `${JSON.stringify(rows, null, 2)}\n`)
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
await writeFile(FILE, `${JSON.stringify(rows, null, 2)}\n`)
console.log(JSON.stringify(stats))
