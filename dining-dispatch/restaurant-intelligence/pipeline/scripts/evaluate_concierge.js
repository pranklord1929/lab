// Search-only, read-only regression benchmark for the local concierge API.
// Run the web server with CONCIERGE_DISABLE_LLM=1: Qwen prose is deliberately
// outside this benchmark. Every returned restaurant and dish is verified
// against the SQLite snapshot used to build the semantic index.

import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const API = process.env.CONCIERGE_API || 'http://localhost:3000/api/concierge'
const QUIET = process.env.CONCIERGE_EVAL_QUIET === '1'
const DB_PATH = process.env.LOCAL_DB_PATH || resolve('data/local_db/cdmx_local.sqlite')
const db = new DatabaseSync(DB_PATH, { readOnly: true })
const fold = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const dishText = card => fold((card.dishes || []).map(dish => dish.nom).join(' '))
const area = (card, expected) => fold(card.colonia).includes(expected)
const areaOrBorough = (card, expected) => fold(`${card.colonia || ''} ${card.alcaldia || ''}`).includes(expected)
const condesaArea = card => /condesa|hipodromo/.test(fold(card.colonia))
const dishesContain = (card, expected) => card.dishes.length > 0 && card.dishes.every(dish => fold(dish.nom).includes(expected))
const distanceKm = (a, b) => {
  const radians = degrees => degrees * Math.PI / 180
  const dLat = radians(b.lat - a.lat)
  const dLng = radians(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

const restaurantById = new Map(db.prepare('SELECT * FROM restaurant_search_mv').all().map(row => [row.id, row]))
const primaryMenu = db.prepare("SELECT restaurant_id, nom, prix, devise, COALESCE(description, '') description FROM menu_items").all()
const primaryCovered = new Set(primaryMenu.map(row => row.restaurant_id))
const fallbackMenu = db.prepare("SELECT restaurant_id, nom, prix, devise, '' description FROM menu_items_local_extracted").all()
  .filter(row => !primaryCovered.has(row.restaurant_id))
const menuByRestaurant = new Map()
for (const row of [...primaryMenu, ...fallbackMenu]) {
  if (!menuByRestaurant.has(row.restaurant_id)) menuByRestaurant.set(row.restaurant_id, [])
  menuByRestaurant.get(row.restaurant_id).push(row)
}
const cuisineEvidence = (card, expected) => {
  const row = restaurantById.get(card.id) || {}
  const evidence = fold(`${row.cuisine_key || ''} ${row.michelin_cuisine || ''} ${row.opentable_cuisine || ''} ${row.summary || ''}`)
  return expected === 'mexican' ? /mexic|taco|taquer|antojito|pozole|birria/.test(evidence) : evidence.includes(expected)
}
const seafoodEvidence = card => {
  const row = restaurantById.get(card.id) || {}
  return /seafood|mariscos|pescado|poisson|fish restaurant/.test(fold(`${row.cuisine_key || ''} ${row.michelin_cuisine || ''} ${row.opentable_cuisine || ''} ${row.summary || ''}`))
}
const venueEvidence = (card, pattern) => {
  const row = restaurantById.get(card.id) || {}
  return pattern.test(fold(`${row.name || ''} ${row.cuisine_key || ''} ${row.opentable_cuisine || ''} ${row.summary || ''}`))
}
const nonDiningCuisine = card => /^(shopping_mall|grocery_store|supermarket|convenience_store|pharmacy|department_store)$/.test(fold(card.cuisine_key))

function sqliteEvidence(card) {
  const row = restaurantById.get(card.id)
  if (!row || row.is_enriched !== 1 || row.name !== card.name) return `restaurant:${card.name}`
  for (const dish of card.dishes || []) {
    const evidence = (menuByRestaurant.get(card.id) || []).find(item =>
      fold(item.nom) === fold(dish.nom)
      && (item.prix == null ? dish.prix == null : Number(item.prix) === Number(dish.prix)))
    if (!evidence) return `dish:${card.name}/${dish.nom}/${dish.prix}`
  }
  const requirementPatterns = {
    vegetarian: /vegetarian|vegetarien|vegetarienne|vegetariano|vegetariana|vegan|vegano|vegana|plant.?based/,
    vegan: /vegan|vegano|vegana|plant.?based/,
    gluten_free: /gluten.?free|sans gluten|sin gluten/,
    halal: /halal/,
    meat: /\bbeef\b|\bsteak\b|\bchicken\b|\bpork\b|\blamb\b|\bmeat\b|\bcarne\b|\bpollo\b|\bcerdo\b|\bres\b|\bbistec\b|\barrachera\b|\bchorizo\b|\bbarbacoa\b|\bcordero\b/,
  }
  for (const match of card.group_matches || []) {
    const pattern = requirementPatterns[match.requirement]
    if (!pattern) return `group-requirement:${card.name}/${match.requirement}`
    const venueText = fold(`${row.name || ''} ${row.cuisine_key || ''} ${row.michelin_cuisine || ''} ${row.opentable_cuisine || ''} ${row.summary || ''}`)
    const item = (menuByRestaurant.get(card.id) || []).find(candidate => fold(candidate.nom) === fold(match.evidence))
    const itemText = fold(`${item?.nom || ''} ${item?.description || ''}`)
    if (match.requirement === 'meat' && /\bvegan|vegano|vegana|vegetarian|vegetariano|vegetariana|plant.?based/.test(venueText)) {
      return `group-evidence:${card.name}/${match.requirement}/${match.evidence}`
    }
    if (match.requirement === 'meat' && /vegan|vegetar|plant.?based|meatless|sans viande|sin carne/.test(itemText)) {
      return `group-evidence:${card.name}/${match.requirement}/${match.evidence}`
    }
    if (!(fold(match.evidence) === fold(row.name) && pattern.test(venueText))
        && !(item && pattern.test(itemText))) {
      return `group-evidence:${card.name}/${match.requirement}/${match.evidence}`
    }
  }
  return null
}

const cases = [
  {
    name: 'FR dish + neighbourhood + low budget', minCards: 1,
    messages: ['Je cherche des tacos al pastor pas chers à Roma Norte'],
    validate: card => area(card, 'roma norte') && card.price_level <= 2
      && dishText(card).includes('taco') && dishText(card).includes('pastor'),
  },
  {
    name: 'FR special occasion + upscale', minCards: 3,
    messages: ['Un restaurant romantique et haut de gamme à Polanco pour un anniversaire'],
    validate: card => area(card, 'polanco') && card.price_level >= 3
      && !/cocktail_bar|^bar$/.test(card.cuisine_key || ''),
  },
  {
    name: 'FR dish price ceiling', minCards: 1,
    messages: ['Ceviche à moins de 300 pesos à Condesa'],
    validate: card => area(card, 'condesa') && card.dishes.length > 0
      && card.dishes.every(dish => fold(dish.nom).includes('ceviche') && dish.prix != null && dish.prix <= 300),
  },
  {
    name: 'ES strict vegan venue', minCards: 0, maxCards: 0,
    messages: ['Quiero un restaurante vegano en Coyoacán'],
    validate: card => /vegan|vegano|plant.?based/.test(fold(`${card.name} ${card.cuisine_key}`)),
  },
  {
    name: 'EN Juarez neighbourhood ambiguity', minCards: 1,
    messages: ['A great cocktail bar in Juarez'],
    validate: card => area(card, 'juarez')
      && /bar|cocktail|speakeasy|cantina|gastropub|night.?club/.test(fold(`${card.name} ${card.cuisine_key}`)),
  },
  {
    name: 'FR dish evidence purity', minCards: 3,
    messages: ['Je veux manger des ramen'],
    validate: card => card.dishes.length > 0 && card.dishes.every(dish => fold(dish.nom).includes('ramen')),
  },
  {
    name: 'ES combined pastor + area + budget', minCards: 1,
    messages: ['Quiero tacos al pastor baratos en Roma Norte'],
    validate: card => area(card, 'roma norte') && card.price_level <= 2
      && dishText(card).includes('taco') && dishText(card).includes('pastor'),
  },
  {
    name: 'ES combined dish price + area', minCards: 1,
    messages: ['Quiero chilaquiles por menos de 200 pesos en Coyoacán'],
    validate: card => fold(`${card.colonia} ${card.alcaldia}`).includes('coyoacan') && card.dishes.length > 0
      && card.dishes.every(dish => fold(dish.nom).includes('chilaquil') && dish.prix != null && dish.prix <= 200),
  },
  {
    name: 'EN combined dish price + area', minCards: 1,
    messages: ['Mole under 300 pesos in Polanco'],
    validate: card => area(card, 'polanco') && card.dishes.length > 0
      && card.dishes.every(dish => fold(dish.nom).includes('mole') && dish.prix != null && dish.prix <= 300),
  },
  {
    name: 'FR vague discovery', minCards: 3,
    messages: ['Un truc sympa pour ce soir'], validate: () => true,
  },
  {
    name: 'ES vague discovery', minCards: 3,
    messages: ['Algo bueno para cenar esta noche'], validate: () => true,
  },
  {
    name: 'ES vague restaurant phrasing', minCards: 3,
    messages: ['Quiero un buen restaurante para cenar'], validate: () => true,
  },
  {
    name: 'EN vague discovery', minCards: 3,
    messages: ['Something nice for dinner tonight'], validate: () => true,
  },
  {
    name: 'FR absent dish must be empty', minCards: 0, maxCards: 0,
    messages: ['Je veux manger une poutine'], validate: () => false,
  },
  {
    name: 'EN absent dish must be empty', minCards: 0, maxCards: 0,
    messages: ['Find me khachapuri in Mexico City'], validate: () => false,
  },
  {
    name: 'ES absent dish must be empty', minCards: 0, maxCards: 0,
    messages: ['Quiero comer injera'], validate: () => false,
  },
  {
    name: 'FR Michelin hard filter', minCards: 3,
    messages: ['Une table Michelin à Polanco'],
    validate: card => area(card, 'polanco') && (card.michelin_stars || card.bib_gourmand || card.michelin_distinction),
  },
  {
    name: 'EN Benito Juarez borough explicit', minCards: 3,
    messages: ['A good restaurant in Benito Juarez'],
    validate: card => fold(card.alcaldia).includes('benito juarez'),
  },
  {
    name: 'FR conversational refinement', minCards: 1,
    messages: ['Je veux manger des chilaquiles', 'Finalement à Coyoacán et moins de 200 pesos'],
    validate: card => fold(`${card.colonia} ${card.alcaldia}`).includes('coyoacan') && card.dishes.length > 0
      && card.dishes.every(dish => fold(dish.nom).includes('chilaquil') && dish.prix != null && dish.prix <= 200),
  },
  {
    name: 'FR pizza plural-to-singular conversation', minCards: 1,
    messages: [
      'je cherche un restaurant pas cher dans Roma Norte avec des pizzas',
      'Je veux manger une pizza dans Roma Norte',
    ],
    validate: card => area(card, 'roma norte') && card.price_level <= 2 && card.dishes.length > 0
      && card.dishes.every(dish => fold(dish.nom).includes('pizza')),
  },
  {
    name: 'FR independent request resets prior pizza context', minCards: 3,
    messages: [
      'je cherche un restaurant pas cher dans Roma Norte avec des pizzas',
      'Je veux manger cuisine française',
    ],
    validateReply: reply => reply.meta?.filter === 'French',
    validate: card => cuisineEvidence(card, 'french'),
  },
  {
    name: 'EN cuisine + neighbourhood', minCards: 1,
    messages: ['I want Italian food in Polanco'],
    validate: card => area(card, 'polanco') && cuisineEvidence(card, 'italian'),
  },
  {
    name: 'ES cuisine + borough', minCards: 1,
    messages: ['Quiero comida japonesa en Coyoacán'],
    validate: card => fold(`${card.colonia} ${card.alcaldia}`).includes('coyoacan') && cuisineEvidence(card, 'japanese'),
  },
  {
    name: 'Profile defaults: family + budget + area + vague cuisine', minCards: 1,
    profile: { partySize: 5, dietary: [], budget: 'low', areaText: 'Roma Norte', preferredCuisine: 'mexican' },
    messages: ['Un truc sympa pour ce soir'],
    validateReply: reply => /5 personnes/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'roma norte') && card.price_level <= 2 && cuisineEvidence(card, 'mexican'),
  },
  {
    name: 'Profile current cuisine overrides saved cuisine', minCards: 1,
    profile: { partySize: 2, dietary: [], budget: 'flexible', areaText: 'Polanco', preferredCuisine: 'mexican' },
    messages: ['I want Italian food'],
    validate: card => area(card, 'polanco') && cuisineEvidence(card, 'italian'),
  },
  {
    name: 'Profile explicit dish overrides saved cuisine', minCards: 1,
    profile: { partySize: 2, dietary: [], budget: 'flexible', areaText: null, preferredCuisine: 'mexican' },
    messages: ['Je veux manger des ramen'],
    validate: card => card.dishes.length > 0 && card.dishes.every(dish => fold(dish.nom).includes('ramen')),
  },
  {
    name: 'Profile current area overrides saved area', minCards: 1,
    profile: { partySize: 3, dietary: [], budget: 'flexible', areaText: 'Roma Norte', preferredCuisine: 'surprise' },
    messages: ['Quiero comida japonesa en Coyoacán'],
    validate: card => fold(`${card.colonia} ${card.alcaldia}`).includes('coyoacan') && cuisineEvidence(card, 'japanese'),
  },
  {
    name: 'Profile vegetarian group has SQLite proof', minCards: 1,
    profile: { partySize: 5, dietary: ['vegetarian'], budget: 'flexible', areaText: 'Roma Norte', preferredCuisine: 'surprise' },
    messages: ['Un restaurant sympa pour ce soir'],
    validate: card => area(card, 'roma norte')
      && card.group_matches?.some(match => match.requirement === 'vegetarian'),
  },
  {
    name: 'Profile family + vegetarian + Mexican + area combination', minCards: 1,
    profile: { partySize: 5, dietary: ['vegetarian'], budget: 'medium', areaText: 'Roma Norte', preferredCuisine: 'mexican' },
    messages: ['Un dîner mexicain sympa à Roma Norte'],
    validate: card => area(card, 'roma norte') && card.price_level <= 3
      && /mexic|taco|taquer|antojito|pozole|birria/.test(fold(`${restaurantById.get(card.id)?.cuisine_key || ''} ${restaurantById.get(card.id)?.summary || ''}`))
      && card.group_matches?.some(match => match.requirement === 'vegetarian'),
  },
  {
    name: 'FR plural sushi keeps dish evidence', minCards: 1,
    messages: ['Je veux des sushis à Polanco'],
    validate: card => area(card, 'polanco') && dishesContain(card, 'sushi'),
  },
  {
    name: 'EN birria dish evidence', minCards: 3,
    messages: ['I want birria tonight'], validate: card => dishesContain(card, 'birria'),
  },
  {
    name: 'ES enchiladas + neighbourhood', minCards: 1,
    messages: ['Quiero enchiladas en Roma Norte'],
    validate: card => area(card, 'roma norte') && dishesContain(card, 'enchilada'),
  },
  {
    name: 'FR quesadillas + borough', minCards: 1,
    messages: ['Des quesadillas à Coyoacán'],
    validate: card => areaOrBorough(card, 'coyoacan') && dishesContain(card, 'quesadilla'),
  },
  {
    name: 'EN burger + Juarez', minCards: 1,
    messages: ['Find me a burger in Juarez'],
    validate: card => area(card, 'juarez') && dishesContain(card, 'burger'),
  },
  {
    name: 'FR curry + Condesa', minCards: 1,
    messages: ['Je veux un curry à Condesa'],
    validate: card => area(card, 'condesa') && dishesContain(card, 'curry'),
  },
  {
    name: 'ES cochinita pibil evidence', minCards: 3,
    messages: ['Quiero cochinita pibil'],
    validate: card => dishesContain(card, 'cochinita'),
  },
  {
    name: 'FR tamales evidence', minCards: 2,
    messages: ['Je veux manger des tamales'], validate: card => dishesContain(card, 'tamal'),
  },
  {
    name: 'ES pozole + low budget', minCards: 3,
    messages: ['Quiero pozole barato'],
    validate: card => card.price_level <= 2 && dishesContain(card, 'pozole'),
  },
  {
    name: 'EN steak + Polanco', minCards: 1,
    messages: ['A steak dinner in Polanco'],
    validate: card => area(card, 'polanco') && dishesContain(card, 'steak'),
  },
  {
    name: 'FR Korean cuisine', minCards: 3,
    messages: ['Un restaurant coréen'], validate: card => cuisineEvidence(card, 'korean'),
  },
  {
    name: 'EN Thai cuisine + area', minCards: 1,
    messages: ['Thai food in Roma Norte'],
    validate: card => area(card, 'roma norte') && cuisineEvidence(card, 'thai'),
  },
  {
    name: 'ES Chinese cuisine', minCards: 3,
    messages: ['Comida china'], validate: card => cuisineEvidence(card, 'chinese'),
  },
  {
    name: 'EN Indian cuisine', minCards: 1,
    messages: ['Indian food in Mexico City'], validate: card => cuisineEvidence(card, 'indian'),
  },
  {
    name: 'FR Lebanese cuisine', minCards: 1,
    messages: ['Cuisine libanaise'], validate: card => cuisineEvidence(card, 'lebanese'),
  },
  {
    name: 'EN Spanish cuisine', minCards: 3,
    messages: ['Spanish food in Mexico City'], validate: card => cuisineEvidence(card, 'spanish'),
  },
  {
    name: 'FR Centro area only', minCards: 3,
    messages: ['Une bonne adresse dans le Centro'], validate: card => area(card, 'centro'),
  },
  {
    name: 'EN Roma Sur area only', minCards: 3,
    messages: ['A nice restaurant in Roma Sur'], validate: card => area(card, 'roma sur'),
  },
  {
    name: 'ES San Angel area only', minCards: 3,
    messages: ['Un buen restaurante en San Ángel'], validate: card => area(card, 'san angel'),
  },
  {
    name: 'FR Narvarte area only', minCards: 3,
    messages: ['Un restaurant sympa à Narvarte'], validate: card => area(card, 'narvarte'),
  },
  {
    name: 'EN Napoles area only', minCards: 3,
    messages: ['Somewhere good in Napoles'], validate: card => area(card, 'napoles'),
  },
  {
    name: 'ES Santa Fe area only', minCards: 3,
    messages: ['Algo bueno para cenar en Santa Fe'], validate: card => area(card, 'santa fe'),
  },
  {
    name: 'FR Del Valle area only', minCards: 3,
    messages: ['Où manger à Del Valle ?'], validate: card => area(card, 'del valle'),
  },
  {
    name: 'EN cheap + Condesa', minCards: 3,
    messages: ['Something cheap in Condesa'],
    validate: card => condesaArea(card) && card.price_level <= 2,
  },
  {
    name: 'ES elegant + Roma Norte', minCards: 3,
    messages: ['Algo elegante en Roma Norte'],
    validate: card => area(card, 'roma norte') && !/cocktail_bar|^bar$/.test(card.cuisine_key || ''),
  },
  {
    name: 'FR explicit no Michelin', minCards: 3,
    messages: ['Pas de Michelin à Polanco'],
    validate: card => area(card, 'polanco') && !card.michelin_stars && !card.bib_gourmand && !card.michelin_distinction,
  },
  {
    name: 'FR natural group request', minCards: 1,
    messages: ['On est 5 avec une personne végétarienne, dîner mexicain à Roma Norte'],
    validateReply: reply => /5 personnes/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'roma norte') && cuisineEvidence(card, 'mexican')
      && card.group_matches?.some(match => match.requirement === 'vegetarian'),
  },
  {
    name: 'EN natural group request', minCards: 1,
    messages: ['We are 4, one person is vegetarian, Mexican dinner in Roma Norte'],
    validateReply: reply => /4 people/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'roma norte') && cuisineEvidence(card, 'mexican')
      && card.group_matches?.some(match => match.requirement === 'vegetarian'),
  },
  {
    name: 'ES natural group request', minCards: 1,
    messages: ['Somos 6, una persona vegetariana, comida mexicana en Roma Norte'],
    validateReply: reply => /6 personas/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'roma norte') && cuisineEvidence(card, 'mexican')
      && card.group_matches?.some(match => match.requirement === 'vegetarian'),
  },
  {
    name: 'EN gluten-free group proof', minCards: 1,
    messages: ['A restaurant with a gluten-free option'],
    validate: card => card.group_matches?.some(match => match.requirement === 'gluten_free'),
  },
  {
    name: 'EN halal group returns no false proof', minCards: 0, maxCards: 0,
    messages: ['A halal option for one person'], validate: () => false,
  },
  {
    name: 'EN near-me radius', minCards: 3,
    location: { lat: 19.4194, lng: -99.1616 },
    messages: ['Restaurants near me'],
    validate: card => Number.isFinite(card.lat) && Number.isFinite(card.lng)
      && distanceKm({ lat: 19.4194, lng: -99.1616 }, card) <= 5,
  },
  {
    name: 'EN three-more excludes prior shortlist', minCards: 3, moreSequence: true,
    messages: ['Something nice for dinner tonight'], validate: () => true,
  },
  {
    name: 'FR profile high budget overridden by cheap request', minCards: 1,
    profile: { partySize: 2, dietary: [], budget: 'high', areaText: 'Condesa', preferredCuisine: 'surprise' },
    messages: ['Finalement quelque chose de pas cher'],
    validate: card => condesaArea(card) && card.price_level <= 2,
  },
  {
    name: 'ES request party size overrides profile', minCards: 1,
    profile: { partySize: 2, dietary: [], budget: 'flexible', areaText: 'Roma Norte', preferredCuisine: 'mexican' },
    messages: ['Somos 7, queremos una cena mexicana'],
    validateReply: reply => /7 personas/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'roma norte') && cuisineEvidence(card, 'mexican'),
  },
  {
    name: 'FR absent lutefisk must be empty', minCards: 0, maxCards: 0,
    messages: ['Je veux manger du lutefisk'], validate: () => false,
  },
  {
    name: 'EN absent bunny chow must be empty', minCards: 0, maxCards: 0,
    messages: ['Find me bunny chow'], validate: () => false,
  },
  {
    name: 'ES absent surstromming must be empty', minCards: 0, maxCards: 0,
    messages: ['Quiero comer surströmming'], validate: () => false,
  },
  {
    name: 'FR landmark Frida Kahlo maps to Coyoacan', minCards: 3,
    messages: ['Où déjeuner après le musée Frida Kahlo ?'],
    validate: card => areaOrBorough(card, 'coyoacan'),
  },
  {
    name: 'EN landmark Bellas Artes maps to Centro', minCards: 3,
    messages: ['Dinner near Bellas Artes'], validate: card => area(card, 'centro'),
  },
  {
    name: 'ES landmark Soumaya maps to Polanco', minCards: 3,
    messages: ['Comer cerca del Museo Soumaya'], validate: card => area(card, 'polanco'),
  },
  {
    name: 'FR landmark anthropology maps to Chapultepec', minCards: 3,
    messages: ["Un restaurant après le musée d'anthropologie"],
    validate: card => area(card, 'chapultepec'),
  },
  {
    name: 'FR no-seafood exclusion', minCards: 3,
    messages: ['Un bon restaurant à Polanco mais sans poisson'],
    validateReply: reply => /sans poisson/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'polanco') && !seafoodEvidence(card),
  },
  {
    name: 'EN no-seafood exclusion', minCards: 3,
    messages: ['Dinner in Roma Norte, no seafood'],
    validateReply: reply => /no seafood/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'roma norte') && !seafoodEvidence(card),
  },
  {
    name: 'ES no-seafood exclusion', minCards: 3,
    messages: ['Cena en Condesa sin mariscos'],
    validateReply: reply => /sin mariscos/.test(reply.meta?.filter || ''),
    validate: card => condesaArea(card) && !seafoodEvidence(card),
  },
  {
    name: 'FR family phrasing + daughter no meat', minCards: 1,
    messages: ['On sera 5, ma fille ne mange pas de viande, dîner mexicain à Roma Norte'],
    validateReply: reply => /5 personnes/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'roma norte') && cuisineEvidence(card, 'mexican')
      && card.group_matches?.some(match => match.requirement === 'vegetarian'),
  },
  {
    name: 'FR colloquial restau + cuisine + area', minCards: 1,
    messages: ['Je cherche un restau italien à Polanco'],
    validate: card => area(card, 'polanco') && cuisineEvidence(card, 'italian'),
  },
  {
    name: 'FR brunch + Condesa cluster', minCards: 1,
    messages: ['Je veux bruncher à Condesa'],
    validate: card => condesaArea(card)
      && venueEvidence(card, /breakfast|brunch|desayuno|coffee.?shop|\bcafe\b|bakery|panaderia|pasteleria|creperie/),
  },
  {
    name: 'FR breakfast + Coyoacan', minCards: 1,
    messages: ['Un bon petit-déjeuner à Coyoacán'],
    validate: card => areaOrBorough(card, 'coyoacan')
      && venueEvidence(card, /breakfast|brunch|desayuno|coffee.?shop|\bcafe\b|bakery|panaderia|pasteleria|creperie/),
  },
  {
    name: 'ES breakfast + Polanco', minCards: 1,
    messages: ['Quiero desayunar en Polanco'],
    validate: card => area(card, 'polanco')
      && venueEvidence(card, /breakfast|brunch|desayuno|coffee.?shop|\bcafe\b|bakery|panaderia|pasteleria|creperie/),
  },
  {
    name: 'FR dessert and cafe + Condesa', minCards: 1,
    messages: ['Dessert et café à Condesa'],
    validate: card => condesaArea(card)
      && venueEvidence(card, /coffee|\bcafe\b|bakery|panaderia|pasteleria|patisserie|dessert|creperie|donut/),
  },
  {
    name: 'FR medium budget + Mexican + area', minCards: 1,
    messages: ['Un restaurant mexicain budget moyen à Roma Norte'],
    validateReply: reply => /budget moyen/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'roma norte') && card.price_level <= 3 && cuisineEvidence(card, 'mexican'),
  },
  {
    name: 'ES medium budget + Italian', minCards: 1,
    messages: ['Cena italiana con presupuesto medio'],
    validateReply: reply => /presupuesto medio/.test(reply.meta?.filter || ''),
    validate: card => card.price_level <= 3 && cuisineEvidence(card, 'italian'),
  },
  {
    name: 'EN medium budget + Italian + area', minCards: 1,
    messages: ['Italian dinner, medium budget, in Polanco'],
    validateReply: reply => /medium budget/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'polanco') && card.price_level <= 3 && cuisineEvidence(card, 'italian'),
  },
  {
    name: 'FR negative area then replacement', minCards: 1,
    messages: ['Je veux une pizza mais pas à Roma Norte, plutôt Condesa'],
    validate: card => condesaArea(card) && dishesContain(card, 'pizza'),
  },
  {
    name: 'FR negative dish then replacement', minCards: 3,
    messages: ['Finalement pas de tacos, plutôt des ramen'],
    validate: card => dishesContain(card, 'ramen') && !dishText(card).includes('taco'),
  },
  {
    name: 'EN Pujol style but cheaper', minCards: 3,
    messages: ['Something like Pujol but cheaper'],
    validate: card => card.price_level <= 2 && cuisineEvidence(card, 'mexican') && card.name !== 'Pujol',
  },
  {
    name: 'FR named restaurant lookup Pujol', minCards: 1, maxCards: 1,
    messages: ['Que penses-tu de Pujol ?'], validate: card => card.name === 'Pujol',
  },
  {
    name: 'FR named restaurant lookup Quintonil', minCards: 1, maxCards: 1,
    messages: ['Je veux réserver chez Quintonil'], validate: card => card.name === 'Quintonil',
  },
  {
    name: 'EN authentic Mexican + Centro', minCards: 1,
    messages: ['Authentic Mexican food in Centro'],
    validate: card => area(card, 'centro') && cuisineEvidence(card, 'mexican'),
  },
  {
    name: 'EN local non-touristy excludes awards', minCards: 3,
    messages: ['Local food, not touristy'],
    validate: card => cuisineEvidence(card, 'mexican') && !card.michelin_stars
      && !card.bib_gourmand && !card.michelin_distinction && !card.in_worlds_50_best,
  },
  {
    name: 'FR cocktails + dinner excludes pure nightlife', minCards: 1,
    messages: ['Cocktails et dîner à Roma Norte'],
    validate: card => area(card, 'roma norte') && !/^bar$|night.?club/.test(fold(card.cuisine_key))
      && venueEvidence(card, /cocktail|coctel|mixolog/),
  },
  {
    name: 'FR rooftop avoids menu-item false positive', minCards: 0, maxCards: 0,
    messages: ['Un rooftop à Roma Norte'], validate: () => false,
  },
  {
    name: 'FR multi-intent ceviche + mezcal', minCards: 3,
    messages: ['Je veux du ceviche et du mezcal'],
    validate: card => dishText(card).includes('ceviche') && dishText(card).includes('mezcal'),
  },
  {
    name: 'FR multi-intent tacos + quesadillas + area', minCards: 1,
    messages: ['Tacos et quesadillas à Coyoacán'],
    validate: card => areaOrBorough(card, 'coyoacan')
      && dishText(card).includes('taco') && dishText(card).includes('quesadilla'),
  },
  {
    name: 'EN multi-intent sushi + ramen + area', minCards: 1,
    messages: ['Sushi and ramen in Polanco'],
    validate: card => area(card, 'polanco') && dishText(card).includes('sushi') && dishText(card).includes('ramen'),
  },
  {
    name: 'FR veggie slang gets verified group option', minCards: 1,
    messages: ['Une option végé à Condesa'],
    validate: card => condesaArea(card)
      && card.group_matches?.some(match => match.requirement === 'vegetarian'),
  },
  {
    name: 'EN veggie slang gets verified group option', minCards: 1,
    messages: ['A veggie option in Polanco'],
    validateReply: reply => /vegetarian option/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'polanco')
      && card.group_matches?.some(match => match.requirement === 'vegetarian'),
  },
  {
    name: 'EN mixed vegetarian + meat group has two proofs', minCards: 3,
    messages: ['We are five, my daughter is veggie and my husband loves meat'],
    validateReply: reply => /5 people/.test(reply.meta?.filter || ''),
    validate: card => card.group_matches?.some(match => match.requirement === 'vegetarian')
      && card.group_matches?.some(match => match.requirement === 'meat'),
  },
  {
    name: 'FR over-constrained mixed group stays honest', minCards: 0, maxCards: 0,
    messages: ['On est 5, ma fille est végé et mon mari adore la viande, mexicain à Roma Norte'],
    validate: () => false,
  },
  {
    name: 'ES mixed group does not become vegetarian-only venue', minCards: 0, maxCards: 0,
    messages: ['Somos 5, mi hija es vegetariana y mi marido quiere carne, comida mexicana en Roma Norte'],
    validateReply: reply => /opción vegetariana/.test(reply.meta?.filter || '') && /opción de carne/.test(reply.meta?.filter || ''),
    validate: () => false,
  },
  {
    name: 'FR typo Polonco normalizes to Polanco', minCards: 1,
    messages: ['Un resto italien à Polonco'],
    validate: card => area(card, 'polanco') && cuisineEvidence(card, 'italian'),
  },
  {
    name: 'FR typo Romma normalizes to Roma', minCards: 1,
    messages: ['Tacos à Romma Norte'],
    validate: card => area(card, 'roma norte') && dishesContain(card, 'taco'),
  },
  {
    name: 'EN typo Condessa normalizes to Condesa', minCards: 3,
    messages: ['Something nice in Condessa'], validate: card => condesaArea(card),
  },
  {
    name: 'EN symbolic $$$ exact price', minCards: 3,
    messages: ['Mexican food in Roma Norte, $$$'],
    validateReply: reply => /\$\$\$/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'roma norte') && card.price_level === 3 && cuisineEvidence(card, 'mexican'),
  },
  {
    name: 'ES symbolic $$$ exact price + dish', minCards: 1,
    messages: ['Quiero sushi en Polanco, presupuesto $$$'],
    validateReply: reply => /\$\$\$/.test(reply.meta?.filter || ''),
    validate: card => area(card, 'polanco') && card.price_level === 3 && dishesContain(card, 'sushi'),
  },
  {
    name: 'FR ramen budget excludes retail venues', minCards: 1,
    messages: ['Je veux manger des ramen', 'Finalement moins de 200 pesos'],
    validate: card => !nonDiningCuisine(card) && card.dishes.length > 0
      && card.dishes.every(dish => fold(dish.nom).includes('ramen') && dish.prix != null && dish.prix <= 200),
  },
  {
    name: 'EN empty fallback stays English', minCards: 0, maxCards: 0,
    messages: ['Find me smørrebrød'],
    validateReply: reply => /^I couldn.t find/.test(reply.intro || ''), validate: () => false,
  },
  {
    name: 'ES empty fallback stays Spanish', minCards: 0, maxCards: 0,
    messages: ['Quiero comer smørrebrød'],
    validateReply: reply => /^No encontré/.test(reply.intro || ''), validate: () => false,
  },
  {
    name: 'EN assistant-interleaved refinement', minCards: 1,
    messages: [
      { role: 'user', content: 'I want Italian food' },
      { role: 'assistant', content: 'Here are some Italian restaurants.' },
      { role: 'user', content: 'Actually, in Polanco with a medium budget' },
    ],
    validate: card => area(card, 'polanco') && card.price_level <= 3 && cuisineEvidence(card, 'italian'),
  },
]

let passed = 0
const failures = []
const startedAll = Date.now()
for (const test of cases) {
  const started = Date.now()
  try {
    const messages = test.messages.map(content => typeof content === 'string' ? { role: 'user', content } : content)
    let exclude = test.exclude || []
    let more = test.more === true
    let firstIds = []
    if (test.moreSequence) {
      const firstResponse = await fetch(API, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages, exclude: [], more: false, profile: test.profile, location: test.location, searchOnly: true }),
        signal: AbortSignal.timeout(10_000),
      })
      const firstReply = await firstResponse.json()
      firstIds = (firstReply.cards || []).map(card => card.id)
      exclude = firstIds
      more = true
    }
    const response = await fetch(API, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages, exclude, more, profile: test.profile, location: test.location, searchOnly: true }), signal: AbortSignal.timeout(10_000),
    })
    const reply = await response.json()
    const cards = reply.cards || []
    const semanticInvalid = cards.filter(card => !test.validate(card)).map(card => card.name)
    const evidenceInvalid = cards.map(sqliteEvidence).filter(Boolean)
    const countValid = cards.length >= test.minCards && (test.maxCards == null || cards.length <= test.maxCards)
    const noQwen = reply.meta?.responseMode === 'fallback' && Number(reply.meta?.wrapperMs || 0) < 50
    const replyValid = !test.validateReply || test.validateReply(reply)
    const sequenceValid = !test.moreSequence || (firstIds.length > 0 && cards.every(card => !firstIds.includes(card.id)))
    const ok = response.ok && reply.status === 'ok' && countValid && replyValid
      && semanticInvalid.length === 0 && evidenceInvalid.length === 0 && noQwen && sequenceValid
    if (ok) passed++
    else failures.push(test.name)
    if (!QUIET || !ok) {
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${test.name}  (${Date.now() - started}ms)`)
      console.log(`      filter=${reply.meta?.filter || 'none'} · pool=${reply.meta?.poolCount ?? 0} · search=${reply.meta?.searchMs ?? '?'}ms · cards=${cards.map(card => card.name).join(' | ') || 'none'}`)
      if (!countValid) console.log(`      invalid-count=${cards.length}, expected ${test.minCards}..${test.maxCards ?? '∞'}`)
      if (!replyValid) console.log(`      invalid-reply filter=${reply.meta?.filter || 'none'}`)
      if (!noQwen) console.log(`      invalid-mode=${reply.meta?.responseMode}, wrapper=${reply.meta?.wrapperMs}ms`)
      if (!sequenceValid) console.log(`      invalid-more-sequence overlap or empty initial shortlist`)
      if (semanticInvalid.length) console.log(`      invalid-semantic=${semanticInvalid.join(' | ')}`)
      if (evidenceInvalid.length) console.log(`      invalid-sqlite=${evidenceInvalid.join(' | ')}`)
    }
  } catch (error) {
    failures.push(test.name)
    console.log(`FAIL  ${test.name}  ${error.message}`)
  }
}

db.close()
console.log(`\n${passed}/${cases.length} benchmark cases passed in ${((Date.now() - startedAll) / 1000).toFixed(1)}s`)
if (failures.length) console.log(`Failures: ${failures.join(' · ')}`)
process.exitCode = passed === cases.length ? 0 : 1
