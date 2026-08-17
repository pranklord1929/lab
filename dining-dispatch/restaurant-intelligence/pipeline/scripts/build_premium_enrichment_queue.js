// Builds the product-enrichment queue used to grow the chatbot corpus.
// Derived/local only: canonical restaurants and raw source rows stay untouched.
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DB_PATH = resolve('data/local_db/cdmx_local.sqlite')
const OUT_PATH = resolve('data/exports/premium_enrichment_queue.json')
const db = new DatabaseSync(DB_PATH)

const touristCore = /\b(roma norte|roma sur|condesa|hip[oó]dromo|ju[aá]rez|centro|polanco|coyoac[aá]n|san [aá]ngel|n[aá]poles|cuauht[eé]moc)\b/i
const affluentCore = /\b(lomas|bosques|santa fe|pedregal|jardines del pedregal|del valle|anzures|granada|ampliaci[oó]n granada|interlomas)\b/i

function areaWeight(colonia, alcaldia) {
  const place = `${colonia || ''} ${alcaldia || ''}`
  if (touristCore.test(place)) return { tier: 'tourist_core', weight: 60 }
  if (affluentCore.test(place)) return { tier: 'affluent_core', weight: 45 }
  return { tier: 'premium_district', weight: 25 }
}

const rows = db.prepare(`
  WITH menus AS (
    SELECT restaurant_id, COUNT(*) AS item_count FROM (
      SELECT restaurant_id FROM menu_items
      UNION ALL
      SELECT restaurant_id FROM menu_items_local_extracted
    ) GROUP BY restaurant_id
  )
  SELECT s.*, g.website AS golden_website, g.instagram AS golden_instagram,
    g.prestige_score, g.source_count, COALESCE(m.item_count, 0) AS menu_item_count
  FROM restaurant_search_mv s
  JOIN restaurant_golden_record g ON g.restaurant_id = s.id
  LEFT JOIN menus m ON m.restaurant_id = s.id
  WHERE s.is_enriched = 1
`).all()

const queue = rows.map(row => {
  const area = areaWeight(row.colonia, row.alcaldia)
  const hasMenu = row.menu_item_count > 0
  const hasWebsite = Boolean(row.golden_website)
  const hasInstagram = Boolean(row.golden_instagram)
  const prestige = Number(row.michelin_stars || 0) * 80
    + Number(row.bib_gourmand || 0) * 45
    + Number(row.in_worlds_50_best || 0) * 70
    + Math.min(Number(row.prestige_score || 0) * 5, 50)
  const rankBoost = Math.max(0, 45 - Math.floor(Number(row.rank_overall || 5000) / 20))
  const gapBoost = (hasMenu ? 0 : 100) + (hasWebsite ? 0 : 25) + (hasInstagram ? 0 : 10)
  const priorityScore = area.weight + prestige + rankBoost + gapBoost

  let status = 'golden'
  let nextAction = 'instagram_or_quality'
  if (!hasMenu && hasWebsite) {
    status = 'menu_ready'
    nextAction = 'crawl_official_menu'
  } else if (!hasMenu) {
    status = 'website_needed'
    nextAction = 'discover_official_website'
  }

  return {
    restaurant_id: row.id,
    name: row.name,
    colonia: row.colonia,
    alcaldia: row.alcaldia,
    area_tier: area.tier,
    status,
    next_action: nextAction,
    priority_score: priorityScore,
    rank_overall: row.rank_overall,
    score: row.score,
    rating: row.rating,
    review_count: row.review_count,
    michelin_distinction: row.michelin_distinction,
    in_worlds_50_best: Boolean(row.in_worlds_50_best),
    website: row.golden_website,
    instagram: row.golden_instagram,
    menu_item_count: row.menu_item_count,
    missing_menu: !hasMenu,
    missing_website: !hasWebsite,
    missing_instagram: !hasInstagram,
    source_count: row.source_count,
  }
}).sort((a, b) => b.priority_score - a.priority_score || a.rank_overall - b.rank_overall)

db.exec(`
  DROP TABLE IF EXISTS premium_enrichment_queue;
  CREATE TABLE premium_enrichment_queue (
    restaurant_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    colonia TEXT,
    alcaldia TEXT,
    area_tier TEXT NOT NULL,
    status TEXT NOT NULL,
    next_action TEXT NOT NULL,
    priority_score REAL NOT NULL,
    rank_overall INTEGER,
    score REAL,
    rating REAL,
    review_count INTEGER,
    michelin_distinction TEXT,
    in_worlds_50_best INTEGER NOT NULL,
    website TEXT,
    instagram TEXT,
    menu_item_count INTEGER NOT NULL,
    missing_menu INTEGER NOT NULL,
    missing_website INTEGER NOT NULL,
    missing_instagram INTEGER NOT NULL,
    source_count INTEGER NOT NULL,
    generated_at TEXT NOT NULL
  );
`)

const generatedAt = new Date().toISOString()
const insert = db.prepare(`INSERT INTO premium_enrichment_queue VALUES (${Array(22).fill('?').join(',')})`)
db.exec('BEGIN')
try {
  for (const row of queue) {
    insert.run(
      row.restaurant_id, row.name, row.colonia, row.alcaldia, row.area_tier,
      row.status, row.next_action, row.priority_score, row.rank_overall, row.score,
      row.rating, row.review_count, row.michelin_distinction,
      Number(row.in_worlds_50_best), row.website, row.instagram,
      row.menu_item_count, Number(row.missing_menu), Number(row.missing_website),
      Number(row.missing_instagram), row.source_count, generatedAt,
    )
  }
  db.exec('COMMIT')
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}

mkdirSync(resolve('data/exports'), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify({ generated_at: generatedAt, count: queue.length, restaurants: queue }, null, 2))

const stats = db.prepare(`
  SELECT status, area_tier, COUNT(*) AS restaurants
  FROM premium_enrichment_queue GROUP BY status, area_tier ORDER BY status, area_tier
`).all()
console.table(stats)
console.log(`Queue premium : ${queue.length} restaurants → ${OUT_PATH}`)
db.close()
