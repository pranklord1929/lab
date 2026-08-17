// Transforme l'export crawl/retry en fichiers plats exploitables:
// - liens par restaurant pour import DB ou moteur de recherche
// - backlog des sites encore echoues a corriger.

import { readFile, writeFile, mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'

const inputPath = getArg('input', 'data/mvp_discovered_links_merged.json')
const linksOutputPath = getArg('links-output', 'data/mvp_links_flat.json')
const backlogOutputPath = getArg('backlog-output', 'data/mvp_failed_websites_backlog.json')

function getArg(name, fallback) {
  const raw = process.argv.find(arg => arg.startsWith(`--${name}=`))
  return raw ? raw.split('=').slice(1).join('=') : fallback
}

function hostFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return null
  }
}

function dedupeLinks(rows) {
  const byKey = new Map()

  for (const row of rows) {
    const key = `${row.restaurantId}:${row.url}`
    if (!byKey.has(key)) byKey.set(key, row)
  }

  return [...byKey.values()]
}

async function writeJson(path, data) {
  const absolutePath = resolve(path)
  await mkdir(dirname(absolutePath), { recursive: true })
  await writeFile(absolutePath, `${JSON.stringify(data, null, 2)}\n`)
  return absolutePath
}

async function main() {
  const restaurants = JSON.parse(await readFile(inputPath, 'utf8'))
  const links = []
  const backlog = []

  for (const item of restaurants) {
    for (const link of item.links || []) {
      links.push({
        restaurantId: item.restaurantId,
        restaurantName: item.name,
        colonia: item.colonia || null,
        sourceWebsite: item.website,
        sourceFinalUrl: item.finalUrl || null,
        url: link.url,
        host: link.host || hostFromUrl(link.url),
        linkType: link.linkType,
        provider: link.provider,
        anchorText: link.anchorText || '',
        discoveredAt: item.retriedAt || item.discoveredAt || null,
      })
    }

    if (item.status !== 'ok') {
      backlog.push({
        restaurantId: item.restaurantId,
        restaurantName: item.name,
        website: item.website,
        host: hostFromUrl(item.website),
        status: item.status,
        httpStatus: item.httpStatus || null,
        error: item.error || null,
        attempts: item.attempts || [],
      })
    }
  }

  const dedupedLinks = dedupeLinks(links)
  const linksOutput = await writeJson(linksOutputPath, dedupedLinks)
  const backlogOutput = await writeJson(backlogOutputPath, backlog)

  const byType = dedupedLinks.reduce((acc, link) => {
    acc[link.linkType] = (acc[link.linkType] || 0) + 1
    return acc
  }, {})

  const byProvider = dedupedLinks.reduce((acc, link) => {
    acc[link.provider] = (acc[link.provider] || 0) + 1
    return acc
  }, {})

  console.log('Exports generes.')
  console.log(`Liens plats: ${dedupedLinks.length} | ${linksOutput}`)
  console.log(`Backlog sites echoues: ${backlog.length} | ${backlogOutput}`)
  console.log(`Par type: ${JSON.stringify(byType)}`)
  console.log(`Par provider: ${JSON.stringify(byProvider)}`)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
