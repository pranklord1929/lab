// Deterministic adversarial campaign for the concierge search layer.
// It generates hundreds of multilingual requests from facts that already
// exist in the read-only SQLite snapshot. Qwen is always bypassed.

import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const API = process.env.CONCIERGE_API || 'http://localhost:3000/api/concierge'
const DB_PATH = process.env.LOCAL_DB_PATH || resolve('data/local_db/cdmx_local.sqlite')
const LIMIT = Number(process.env.CONCIERGE_STRESS_LIMIT || 360)
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.CONCIERGE_STRESS_CONCURRENCY || 2)))
const FAMILY_FILTER = process.env.CONCIERGE_STRESS_FAMILY || ''
const db = new DatabaseSync(DB_PATH, { readOnly: true })
const fold = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const nonDining = /^(shopping_mall|grocery_store|supermarket|convenience_store|pharmacy|department_store)$/

const restaurants = db.prepare('SELECT * FROM restaurant_search_mv WHERE is_enriched=1').all()
  .filter(row => !nonDining.test(String(row.cuisine_key || '')))
const restaurantById = new Map(restaurants.map(row => [row.id, row]))
const primaryMenu = db.prepare("SELECT restaurant_id, nom, prix, devise FROM menu_items").all()
const primaryCovered = new Set(primaryMenu.map(row => row.restaurant_id))
const fallbackMenu = db.prepare("SELECT restaurant_id, nom, prix, devise FROM menu_items_local_extracted").all()
  .filter(row => !primaryCovered.has(row.restaurant_id))
const menu = [...primaryMenu, ...fallbackMenu].filter(item => restaurantById.has(item.restaurant_id))

const areas = [
  'roma norte', 'roma sur', 'polanco', 'condesa', 'coyoacan', 'juarez', 'centro',
  'san angel', 'santa fe', 'narvarte', 'napoles', 'del valle', 'chapultepec',
]
const areaDisplay = {
  'roma norte': 'Roma Norte', 'roma sur': 'Roma Sur', polanco: 'Polanco', condesa: 'Condesa',
  coyoacan: 'Coyoacán', juarez: 'Juárez', centro: 'Centro', 'san angel': 'San Ángel',
  'santa fe': 'Santa Fe', narvarte: 'Narvarte', napoles: 'Nápoles', 'del valle': 'Del Valle',
  chapultepec: 'Chapultepec',
}
const areaMatches = (row, expected) => {
  const colonia = fold(row.colonia)
  const alcaldia = fold(row.alcaldia)
  if (expected === 'condesa') return /condesa|hipodromo/.test(colonia)
  if (['coyoacan', 'tlalpan', 'cuauhtemoc', 'xochimilco'].includes(expected)) return colonia.includes(expected) || alcaldia.includes(expected)
  return colonia.includes(expected)
}

const cuisineWords = {
  french: ['française', 'French', 'francesa'], italian: ['italienne', 'Italian', 'italiana'],
  mexican: ['mexicaine', 'Mexican', 'mexicana'], japanese: ['japonaise', 'Japanese', 'japonesa'],
  chinese: ['chinoise', 'Chinese', 'china'], korean: ['coréenne', 'Korean', 'coreana'],
  thai: ['thaïe', 'Thai', 'tailandesa'], indian: ['indienne', 'Indian', 'india'],
  lebanese: ['libanaise', 'Lebanese', 'libanesa'], spanish: ['espagnole', 'Spanish', 'española'],
}
const cuisineMatches = (row, expected) => {
  const text = fold(`${row.cuisine_key || ''} ${row.michelin_cuisine || ''} ${row.opentable_cuisine || ''} ${row.summary || ''}`)
  return expected === 'mexican' ? /mexic|taco|taquer|antojito|pozole|birria/.test(text) : text.includes(expected)
}

const dishSpecs = [
  ['tacos', 'taco'], ['ramen', 'ramen'], ['pizza', 'pizza'], ['ceviche', 'ceviche'],
  ['mole', 'mole'], ['chilaquiles', 'chilaquil'], ['sushi', 'sushi'], ['tamales', 'tamal'],
  ['birria', 'birria'], ['pozole', 'pozole'], ['enchiladas', 'enchilada'],
  ['quesadillas', 'quesadilla'], ['burger', 'burger'], ['steak', 'steak'],
  ['paella', 'paella'], ['curry', 'curry'], ['falafel', 'falafel'], ['cochinita', 'cochinita'],
]
const dishTokens = value => fold(value).split(/[^a-z0-9]+/).filter(Boolean).map(token => {
  if (/^pizzas?$/.test(token)) return 'pizza'
  if (/^sushis?$/.test(token)) return 'sushi'
  if (/^tacos?$/.test(token)) return 'taco'
  if (/^moles?$/.test(token)) return 'mole'
  if (/^tamales?$/.test(token)) return 'tamal'
  if (/^enchiladas?$/.test(token)) return 'enchilada'
  if (/^quesadillas?$/.test(token)) return 'quesadilla'
  if (/^chilaquiles?$/.test(token)) return 'chilaquil'
  return token
})
const dishHas = (value, stem) => dishTokens(value).includes(stem)
const menuHas = (restaurantId, stem) => menu.some(item => item.restaurant_id === restaurantId && dishHas(item.nom, stem))

const languagePrompt = {
  fr: {
    area: area => `Un bon restaurant à ${area}`,
    cuisine: cuisine => `Je cherche un restaurant de cuisine ${cuisine}`,
    both: (cuisine, area) => `Un restaurant ${cuisine} à ${area}`,
    dish: dish => `Je veux manger ${dish}`,
    dishArea: (dish, area) => `Je veux manger ${dish} à ${area}`,
    low: area => `Un restaurant pas cher à ${area}`,
    medium: area => `Un restaurant avec un budget moyen à ${area}`,
    high: area => `Un restaurant haut de gamme à ${area}`,
  },
  en: {
    area: area => `A good restaurant in ${area}`,
    cuisine: cuisine => `I want ${cuisine} food`,
    both: (cuisine, area) => `${cuisine} food in ${area}`,
    dish: dish => `I want to eat ${dish}`,
    dishArea: (dish, area) => `Find me ${dish} in ${area}`,
    low: area => `Something cheap in ${area}`,
    medium: area => `A medium budget restaurant in ${area}`,
    high: area => `An upscale restaurant in ${area}`,
  },
  es: {
    area: area => `Un buen restaurante en ${area}`,
    cuisine: cuisine => `Quiero comida ${cuisine}`,
    both: (cuisine, area) => `Comida ${cuisine} en ${area}`,
    dish: dish => `Quiero comer ${dish}`,
    dishArea: (dish, area) => `Quiero ${dish} en ${area}`,
    low: area => `Un restaurante barato en ${area}`,
    medium: area => `Un restaurante de presupuesto medio en ${area}`,
    high: area => `Un restaurante de alta gama en ${area}`,
  },
}
const languages = ['fr', 'en', 'es']
const cases = []
const add = test => cases.push({ ...test, id: cases.length + 1 })

for (const area of areas) {
  for (const language of languages) add({
    family: 'area', language, query: languagePrompt[language].area(areaDisplay[area]),
    validate: card => areaMatches(card, area), min: restaurants.some(row => areaMatches(row, area)) ? 1 : 0,
  })
}

for (const cuisine of Object.keys(cuisineWords)) {
  for (let index = 0; index < languages.length; index++) {
    const language = languages[index]
    add({
      family: 'cuisine', language, query: languagePrompt[language].cuisine(cuisineWords[cuisine][index]),
      validate: card => cuisineMatches(restaurantById.get(card.id) || card, cuisine), min: restaurants.some(row => cuisineMatches(row, cuisine)) ? 1 : 0,
    })
  }
}

const areaCuisinePairs = []
for (const area of areas) for (const cuisine of Object.keys(cuisineWords)) {
  if (restaurants.some(row => areaMatches(row, area) && cuisineMatches(row, cuisine))) areaCuisinePairs.push([area, cuisine])
}
for (let index = 0; index < Math.min(75, areaCuisinePairs.length); index++) {
  const [area, cuisine] = areaCuisinePairs[index]
  const languageIndex = index % languages.length
  const language = languages[languageIndex]
  add({
    family: 'area+cuisine', language,
    query: languagePrompt[language].both(cuisineWords[cuisine][languageIndex], areaDisplay[area]),
    validate: card => areaMatches(card, area) && cuisineMatches(restaurantById.get(card.id) || card, cuisine), min: 1,
  })
}

for (const [dish, stem] of dishSpecs) {
  for (const language of languages) add({
    family: 'dish', language, query: languagePrompt[language].dish(dish),
    validate: card => (card.dishes || []).length > 0 && card.dishes.every(item => dishHas(item.nom, stem)),
    min: menu.some(item => dishHas(item.nom, stem)) ? 1 : 0,
  })
}

const dishAreaPairs = []
for (const [dish, stem] of dishSpecs) for (const area of areas) {
  if (restaurants.some(row => areaMatches(row, area) && menuHas(row.id, stem))) dishAreaPairs.push([dish, stem, area])
}
for (let index = 0; index < Math.min(65, dishAreaPairs.length); index++) {
  const [dish, stem, area] = dishAreaPairs[index]
  const language = languages[index % languages.length]
  add({
    family: 'dish+area', language, query: languagePrompt[language].dishArea(dish, areaDisplay[area]),
    validate: card => areaMatches(card, area) && (card.dishes || []).length > 0
      && card.dishes.every(item => dishHas(item.nom, stem)), min: 1,
  })
}

for (const area of areas.slice(0, 10)) for (const budget of ['low', 'medium', 'high']) for (const language of languages) {
  const candidates = restaurants.filter(row => areaMatches(row, area) && row.price_level != null && (
    budget === 'low' ? row.price_level <= 2 : budget === 'medium' ? row.price_level <= 3 : row.price_level >= 3
  ))
  add({
    family: `budget:${budget}`, language, query: languagePrompt[language][budget](areaDisplay[area]),
    validate: card => areaMatches(card, area) && card.price_level != null && (
      budget === 'low' ? card.price_level <= 2 : budget === 'medium' ? card.price_level <= 3 : card.price_level >= 3
    ), min: candidates.length ? 1 : 0,
  })
}

const selectedCases = cases.filter(test => !FAMILY_FILTER || test.family === FAMILY_FILTER).slice(0, LIMIT)
let cursor = 0
let passed = 0
const failures = []

async function worker() {
  while (cursor < selectedCases.length) {
    const test = selectedCases[cursor++]
    try {
      const response = await fetch(API, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: test.query }], exclude: [], more: false, searchOnly: true }),
        signal: AbortSignal.timeout(10_000),
      })
      const reply = await response.json()
      const cards = reply.cards || []
      let evidenceProblem = null
      const badEvidence = cards.find(card => {
        const row = restaurantById.get(card.id)
        if (!row || row.name !== card.name) {
          evidenceProblem = `restaurant:${card.id}/${card.name}`
          return true
        }
        const badDish = (card.dishes || []).find(dish => !menu.some(item => item.restaurant_id === card.id && fold(item.nom) === fold(dish.nom)))
        if (badDish) evidenceProblem = `dish:${card.id}/${badDish.nom}`
        return !!badDish
      })
      const invalid = cards.filter(card => !test.validate(card))
      const ok = response.ok && reply.status === 'ok' && reply.meta?.responseMode === 'fallback'
        && Number(reply.meta?.wrapperMs || 0) < 50 && cards.length >= test.min && !badEvidence && invalid.length === 0
      if (ok) passed++
      else failures.push({ family: test.family, language: test.language, query: test.query,
        reason: !response.ok ? `http-${response.status}` : cards.length < test.min ? 'false-empty' : badEvidence ? `sqlite-evidence:${evidenceProblem}` : invalid.length ? 'constraint-leak' : 'response-mode',
        filter: reply.meta?.filter || null, cards: cards.map(card => card.name) })
    } catch (error) {
      failures.push({ family: test.family, language: test.language, query: test.query, reason: `error:${error.message}`, cards: [] })
    }
  }
}

const started = Date.now()
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
db.close()

const clusters = new Map()
for (const failure of failures) {
  const key = `${failure.family} / ${failure.reason}`
  clusters.set(key, (clusters.get(key) || 0) + 1)
}
console.log(`Adversarial campaign: ${passed}/${selectedCases.length} passed in ${((Date.now() - started) / 1000).toFixed(1)}s (concurrency=${CONCURRENCY})`)
for (const [cluster, count] of [...clusters.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${count} × ${cluster}`)
for (const failure of failures.slice(0, 30)) console.log(`FAIL [${failure.family}/${failure.language}] ${failure.query} :: ${failure.reason} :: ${failure.cards.join(' | ') || 'none'}`)
process.exitCode = failures.length ? 1 : 0
