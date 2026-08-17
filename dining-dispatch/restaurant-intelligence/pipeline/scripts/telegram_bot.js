// Native Telegram interface for the local Dining Dispatch concierge.
// Telegram -> localhost Next API -> local SQLite/embeddings -> local Ollama.
import 'dotenv/config'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CONCIERGE_URL = process.env.CONCIERGE_URL || 'http://localhost:3000/api/concierge'
if (!TOKEN) throw new Error('TELEGRAM_BOT_TOKEN manque dans .env')

const API = `https://api.telegram.org/bot${TOKEN}`
const BOT_DB_PATH = process.env.TELEGRAM_DB_PATH || path.join(ROOT, 'data', 'local_db', 'telegram_bot.sqlite')
mkdirSync(path.dirname(BOT_DB_PATH), { recursive: true })
const botDb = new DatabaseSync(BOT_DB_PATH)
botDb.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    vote TEXT NOT NULL,
    query TEXT,
    restaurant_ids TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS favorites (
    chat_id TEXT NOT NULL,
    restaurant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    card_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (chat_id, restaurant_id)
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    direction TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS traveler_profiles (
    chat_id TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    party_size INTEGER,
    dietary_json TEXT NOT NULL DEFAULT '[]',
    budget TEXT,
    area_text TEXT,
    location_json TEXT,
    preferred_cuisine TEXT,
    onboarding_step TEXT NOT NULL DEFAULT 'party',
    onboarding_complete INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`)
const insertFeedback = botDb.prepare(
  'INSERT INTO feedback (created_at,chat_id,vote,query,restaurant_ids) VALUES (?,?,?,?,?)'
)
const insertFavorite = botDb.prepare(
  'INSERT OR REPLACE INTO favorites (chat_id,restaurant_id,name,card_json,created_at) VALUES (?,?,?,?,?)'
)
const insertEvent = botDb.prepare(
  'INSERT INTO events (created_at,chat_id,direction,payload) VALUES (?,?,?,?)'
)
const selectProfile = botDb.prepare('SELECT * FROM traveler_profiles WHERE chat_id=?')
const upsertProfile = botDb.prepare(`INSERT OR REPLACE INTO traveler_profiles
  (chat_id,language,party_size,dietary_json,budget,area_text,location_json,preferred_cuisine,onboarding_step,onboarding_complete,updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)

const states = new Map()
let running = true

const COPY = {
  fr: {
    welcome: "Bienvenue chez The Dining Dispatch. Décrivez un plat, une ambiance ou un quartier à Mexico — ou partagez votre position.",
    nearbyButton: '📍 Restaurants près de moi', nearbyQuery: 'Trouve-moi les meilleurs restaurants près de moi',
    more: "Trois autres", useful: 'Utile', review: 'À revoir', saved: 'Ajouté aux favoris',
    favorites: 'Mes favoris', noFavorites: "Vous n'avez encore aucun favori.",
    help: 'Décrivez votre envie librement. /favorites affiche vos favoris, /reset recommence et /anywhere retire la géolocalisation.',
    reset: 'Conversation réinitialisée.', anywhere: 'Géolocalisation retirée.',
    engineDown: 'Le moteur local Ollama est indisponible.', indexDown: "L'index local est indisponible.", error: 'Petit souci local. Réessayez dans quelques secondes.',
    maps: 'Carte', site: 'Site', reserve: 'Réserver', favorite: 'Favori', instagram: 'Instagram', details: 'Détails', back: 'Retour',
  },
  en: {
    welcome: 'Welcome to The Dining Dispatch. Describe a dish, mood or area in Mexico City — or share your location.',
    nearbyButton: '📍 Restaurants near me', nearbyQuery: 'Find the best restaurants near me',
    more: 'Three more', useful: 'Useful', review: 'Needs work', saved: 'Saved to favorites',
    favorites: 'My favorites', noFavorites: 'You have no favorites yet.',
    help: 'Describe what you want. /favorites shows saved places, /reset starts over and /anywhere clears your location.',
    reset: 'Conversation reset.', anywhere: 'Location cleared.',
    engineDown: 'The local Ollama engine is unavailable.', indexDown: 'The local index is unavailable.', error: 'Small local issue. Please try again in a few seconds.',
    maps: 'Map', site: 'Website', reserve: 'Book', favorite: 'Save', instagram: 'Instagram', details: 'Details', back: 'Back',
  },
  es: {
    welcome: 'Bienvenido a The Dining Dispatch. Describe un plato, un ambiente o una zona de CDMX — o comparte tu ubicación.',
    nearbyButton: '📍 Restaurantes cerca de mí', nearbyQuery: 'Encuentra los mejores restaurantes cerca de mí',
    more: 'Tres más', useful: 'Útil', review: 'Mejorar', saved: 'Guardado en favoritos',
    favorites: 'Mis favoritos', noFavorites: 'Todavía no tienes favoritos.',
    help: 'Describe lo que buscas. /favorites muestra tus favoritos, /reset reinicia y /anywhere elimina la ubicación.',
    reset: 'Conversación reiniciada.', anywhere: 'Ubicación eliminada.',
    engineDown: 'El motor local Ollama no está disponible.', indexDown: 'El índice local no está disponible.', error: 'Pequeño problema local. Inténtalo de nuevo en unos segundos.',
    maps: 'Mapa', site: 'Web', reserve: 'Reservar', favorite: 'Favorito', instagram: 'Instagram', details: 'Detalles', back: 'Volver',
  },
}

const ONBOARD = {
  fr: {
    intro: `<b>Bienvenue chez The Dining Dispatch 🇲🇽</b>\n\nNous explorons <b>56 000+ restaurants</b> et <b>25 000+ plats</b> à Mexico pour trouver des adresses adaptées à votre groupe — pas seulement les plus connues.\n\nJe vais d'abord apprendre à vous connaître. Cela prend moins d'une minute.`,
    party: '<b>1/4 · Vous êtes combien ?</b>', dietary: '<b>2/4 · Des régimes alimentaires dans le groupe ?</b>\nSélectionnez tout ce qui compte, puis validez.',
    budget: '<b>3/4 · Quel budget par personne ?</b>', location: '<b>4/4 · Où serez-vous ?</b>\nPartagez votre position, ou écrivez le nom de votre hôtel ou quartier.',
    cuisine: '<b>Profil presque prêt · Que voulez-vous découvrir en priorité ?</b>', ready: '<b>Votre concierge est prêt.</b>\n\nDites-moi maintenant ce que vous cherchez, naturellement.\n\n<i>Exemple : « Un dîner mexicain ce soir près de mon hôtel, avec une option végétarienne. »</i>',
    welcomeBack: '<b>Bon retour !</b> Votre profil est déjà enregistré. Dites-moi ce que vous cherchez, ou utilisez /profile pour le modifier.',
    profile: '<b>Votre profil</b>', profileMissing: 'Votre profil n’est pas encore terminé. Utilisez /start.',
    newSearch: 'Nouvelle recherche. Votre profil voyageur est conservé.', updateProfile: 'Modifier mon profil', done: 'Valider', none: 'Aucun', share: '📍 Partager ma position',
  },
  en: {
    intro: `<b>Welcome to The Dining Dispatch 🇲🇽</b>\n\nWe explore <b>56,000+ restaurants</b> and <b>25,000+ dishes</b> across Mexico City to find places that genuinely fit your group.\n\nFirst, let me get to know you. It takes less than a minute.`,
    party: '<b>1/4 · How many people are you?</b>', dietary: '<b>2/4 · Any dietary needs in the group?</b>\nSelect everything that matters, then confirm.',
    budget: '<b>3/4 · What is your budget per person?</b>', location: '<b>4/4 · Where will you be?</b>\nShare your location, or type your hotel or neighbourhood.',
    cuisine: '<b>Almost ready · What would you most like to discover?</b>', ready: '<b>Your concierge is ready.</b>\n\nNow tell me what you need in your own words.\n\n<i>Example: “Mexican dinner tonight near my hotel, with a vegetarian option.”</i>',
    welcomeBack: '<b>Welcome back!</b> Your profile is saved. Tell me what you need, or use /profile to update it.',
    profile: '<b>Your profile</b>', profileMissing: 'Your profile is not complete yet. Use /start.',
    newSearch: 'New search. Your traveller profile is preserved.', updateProfile: 'Update profile', done: 'Confirm', none: 'None', share: '📍 Share my location',
  },
  es: {
    intro: `<b>Bienvenido a The Dining Dispatch 🇲🇽</b>\n\nExploramos <b>más de 56 000 restaurantes</b> y <b>25 000 platos</b> en Ciudad de México para encontrar lugares que realmente encajen con tu grupo.\n\nPrimero quiero conocerte. Tardarás menos de un minuto.`,
    party: '<b>1/4 · ¿Cuántas personas son?</b>', dietary: '<b>2/4 · ¿Hay necesidades alimentarias en el grupo?</b>\nSelecciona todo lo necesario y confirma.',
    budget: '<b>3/4 · ¿Cuál es el presupuesto por persona?</b>', location: '<b>4/4 · ¿Dónde estarán?</b>\nComparte tu ubicación o escribe el hotel o la colonia.',
    cuisine: '<b>Casi listo · ¿Qué quieren descubrir primero?</b>', ready: '<b>Tu concierge está listo.</b>\n\nAhora dime lo que buscas con tus propias palabras.\n\n<i>Ejemplo: «Cena mexicana esta noche cerca del hotel, con opción vegetariana.»</i>',
    welcomeBack: '<b>¡Qué bueno verte de nuevo!</b> Tu perfil está guardado. Dime qué buscas o usa /profile para modificarlo.',
    profile: '<b>Tu perfil</b>', profileMissing: 'Tu perfil todavía no está completo. Usa /start.',
    newSearch: 'Nueva búsqueda. Conservamos tu perfil de viajero.', updateProfile: 'Modificar perfil', done: 'Confirmar', none: 'Ninguno', share: '📍 Compartir ubicación',
  },
}

const DIET_LABELS = {
  fr: { vegetarian: 'Végétarien', vegan: 'Vegan', gluten_free: 'Sans gluten', halal: 'Halal', meat: 'Option viande' },
  en: { vegetarian: 'Vegetarian', vegan: 'Vegan', gluten_free: 'Gluten-free', halal: 'Halal', meat: 'Meat option' },
  es: { vegetarian: 'Vegetariano', vegan: 'Vegano', gluten_free: 'Sin gluten', halal: 'Halal', meat: 'Opción de carne' },
}
const BUDGET_LABELS = {
  fr: { low: 'Moins de 300 MXN', medium: '300–600 MXN', high: '600–1 000 MXN', premium: '1 000+ MXN', flexible: 'Flexible' },
  en: { low: 'Under 300 MXN', medium: '300–600 MXN', high: '600–1,000 MXN', premium: '1,000+ MXN', flexible: 'Flexible' },
  es: { low: 'Menos de 300 MXN', medium: '300–600 MXN', high: '600–1 000 MXN', premium: '1 000+ MXN', flexible: 'Flexible' },
}
const CUISINE_LABELS = {
  fr: { mexican: 'Mexicaine', regional: 'Régionale', tacos: 'Tacos', seafood: 'Fruits de mer', surprise: 'Surprenez-moi' },
  en: { mexican: 'Mexican', regional: 'Regional', tacos: 'Tacos', seafood: 'Seafood', surprise: 'Surprise me' },
  es: { mexican: 'Mexicana', regional: 'Regional', tacos: 'Tacos', seafood: 'Mariscos', surprise: 'Sorpréndeme' },
}

function languageFromCode(code) {
  const value = String(code || '').toLowerCase()
  return value.startsWith('en') ? 'en' : value.startsWith('es') ? 'es' : 'fr'
}

function detectLanguage(text, fallback = 'fr') {
  const tokens = String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/)
  const markers = {
    fr: new Set(['je', 'cherche', 'veux', 'avec', 'sans', 'moins', 'cher', 'quartier']),
    en: new Set(['i', 'im', 'looking', 'want', 'with', 'without', 'cheap', 'near', 'please']),
    es: new Set(['quiero', 'busco', 'con', 'sin', 'barato', 'cerca', 'precio', 'quisiera']),
  }
  const scores = Object.entries(markers).map(([language, words]) => [language, tokens.filter(token => words.has(token)).length])
    .sort((a, b) => b[1] - a[1])
  return scores[0][1] ? scores[0][0] : fallback
}

function emptyProfile(language = 'fr') {
  return { language, partySize: null, dietary: [], budget: null, areaText: null, location: null, preferredCuisine: null, step: 'party', complete: false }
}

function loadProfile(chatId, language = 'fr') {
  const row = selectProfile.get(String(chatId))
  if (!row) return emptyProfile(language)
  return {
    language: row.language || language,
    partySize: row.party_size,
    dietary: JSON.parse(row.dietary_json || '[]'),
    budget: row.budget,
    areaText: row.area_text,
    location: row.location_json ? JSON.parse(row.location_json) : null,
    preferredCuisine: row.preferred_cuisine,
    step: row.onboarding_step || 'party',
    complete: Boolean(row.onboarding_complete),
  }
}

function saveProfile(chatId, profile) {
  upsertProfile.run(
    String(chatId), profile.language, profile.partySize, JSON.stringify(profile.dietary || []), profile.budget,
    profile.areaText, profile.location ? JSON.stringify(profile.location) : null, profile.preferredCuisine,
    profile.step, profile.complete ? 1 : 0, new Date().toISOString()
  )
}

function freshState(language = 'fr', profile = emptyProfile(language)) {
  return { messages: [], exclude: [], chips: [], lastCards: [], lastReply: null, location: profile.location, language: profile.language || language, profile }
}

function stateFor(chatId, language = 'fr') {
  if (!states.has(chatId)) {
    const profile = loadProfile(chatId, language)
    states.set(chatId, freshState(language, profile))
  }
  return states.get(chatId)
}

function partyKeyboard() {
  return { inline_keyboard: [
    [1, 2, 3].map(value => ({ text: String(value), callback_data: `onboard:party:${value}` })),
    [4, 5, 6].map(value => ({ text: value === 6 ? '6+' : String(value), callback_data: `onboard:party:${value}` })),
  ] }
}

function dietaryKeyboard(profile, language) {
  const labels = DIET_LABELS[language]
  const selected = new Set(profile.dietary || [])
  const option = key => ({ text: `${selected.has(key) ? '✓ ' : ''}${labels[key]}`, callback_data: `onboard:diet:${key}` })
  return { inline_keyboard: [
    [option('vegetarian'), option('vegan')], [option('gluten_free'), option('halal')],
    [{ text: ONBOARD[language].none, callback_data: 'onboard:diet:none' }, { text: `✓ ${ONBOARD[language].done}`, callback_data: 'onboard:diet:done' }],
  ] }
}

function budgetKeyboard(language) {
  const labels = BUDGET_LABELS[language]
  return { inline_keyboard: [
    ['low', 'medium'].map(key => ({ text: labels[key], callback_data: `onboard:budget:${key}` })),
    ['high', 'premium'].map(key => ({ text: labels[key], callback_data: `onboard:budget:${key}` })),
    [{ text: labels.flexible, callback_data: 'onboard:budget:flexible' }],
  ] }
}

function cuisineKeyboard(language) {
  const labels = CUISINE_LABELS[language]
  return { inline_keyboard: [
    ['mexican', 'regional'].map(key => ({ text: labels[key], callback_data: `onboard:cuisine:${key}` })),
    ['tacos', 'seafood'].map(key => ({ text: labels[key], callback_data: `onboard:cuisine:${key}` })),
    [{ text: labels.surprise, callback_data: 'onboard:cuisine:surprise' }],
  ] }
}

function profileSummary(profile, language) {
  const diet = profile.dietary?.length ? profile.dietary.map(key => DIET_LABELS[language][key] || key).join(', ') : ONBOARD[language].none
  const budget = BUDGET_LABELS[language][profile.budget] || '—'
  const cuisine = CUISINE_LABELS[language][profile.preferredCuisine] || profile.preferredCuisine || '—'
  const location = profile.areaText || (profile.location ? '📍 GPS' : '—')
  const labels = language === 'en'
    ? ['People', 'Dietary needs', 'Budget / person', 'Location', 'Priority']
    : language === 'es' ? ['Personas', 'Alimentación', 'Presupuesto / persona', 'Ubicación', 'Prioridad']
      : ['Personnes', 'Régimes', 'Budget / personne', 'Zone', 'Priorité']
  return `${ONBOARD[language].profile}\n\n👥 ${labels[0]} : <b>${profile.partySize || '—'}</b>\n🥗 ${labels[1]} : <b>${escapeHtml(diet)}</b>\n💳 ${labels[2]} : <b>${escapeHtml(budget)}</b>\n📍 ${labels[3]} : <b>${escapeHtml(location)}</b>\n🍽 ${labels[4]} : <b>${escapeHtml(cuisine)}</b>`
}

async function sendCuisineQuestion(chatId, state) {
  state.profile.step = 'cuisine'
  saveProfile(chatId, state.profile)
  await telegram('sendMessage', { chat_id: chatId, text: ONBOARD[state.language].cuisine, parse_mode: 'HTML', reply_markup: cuisineKeyboard(state.language) })
}

async function completeOnboarding(chatId, state, cuisine) {
  state.profile.preferredCuisine = cuisine
  state.profile.step = 'ready'
  state.profile.complete = true
  saveProfile(chatId, state.profile)
  await telegram('sendMessage', { chat_id: chatId, text: `${profileSummary(state.profile, state.language)}\n\n${ONBOARD[state.language].ready}`, parse_mode: 'HTML', reply_markup: { remove_keyboard: true } })
}

function logEvent(chatId, direction, payload) {
  insertEvent.run(new Date().toISOString(), String(chatId), direction, JSON.stringify(payload))
}

function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function displayName(value) {
  const name = String(value || '').trim()
  return name && name === name.toUpperCase()
    ? name.toLowerCase().replace(/(^|\s)\p{L}/gu, letter => letter.toUpperCase())
    : name
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch { return null }
}

function mapsUrl(card) {
  const direct = safeUrl(card.google_maps_uri)
  if (direct) return direct
  if (Number.isFinite(card.lat) && Number.isFinite(card.lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${card.lat},${card.lng}`
  }
  return null
}

async function telegram(method, body = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(method === 'getUpdates' ? 35_000 : 15_000),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || !payload.ok) throw new Error(`${method}: ${payload.description || `HTTP ${response.status}`}`)
  return payload.result
}

async function askConcierge(state, more = false) {
  const response = await fetch(CONCIERGE_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: state.messages.slice(-12), exclude: state.exclude, more, location: state.location,
      profile: state.profile?.complete ? {
        partySize: state.profile.partySize,
        dietary: state.profile.dietary,
        budget: state.profile.budget,
        areaText: state.profile.areaText,
        preferredCuisine: state.profile.preferredCuisine,
      } : null,
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.ok) throw new Error(`Concierge HTTP ${response.status}`)
  return response.json()
}

function formatReply(reply, language) {
  const blocks = [escapeHtml(reply.intro)]
  for (const [index, card] of reply.cards.entries()) {
    const place = [card.colonia, card.alcaldia].filter(Boolean).join(' · ')
    const distinction = card.michelin_stars ? `⭐ Michelin ${card.michelin_stars}`
      : card.bib_gourmand ? 'Michelin Bib Gourmand' : card.in_worlds_50_best ? "World's 50 Best" : card.michelin_distinction
    const details = [card.rating ? `★ ${card.rating}/5` : null, card.price_level ? '$'.repeat(card.price_level) : null, place, distinction]
      .filter(Boolean).join(' · ')
    const dishes = card.dishes.slice(0, 2).map(dish => {
      const price = dish.prix != null ? ` — ${dish.prix} ${dish.devise || 'MXN'}` : ''
      return `   • ${escapeHtml(dish.nom)}${escapeHtml(price)}`
    })
    const groupMatches = (card.group_matches || []).map(match => {
      const label = DIET_LABELS[language][match.requirement] || match.requirement
      return `   ✓ ${escapeHtml(label)} : ${escapeHtml(match.evidence)}`
    })
    blocks.push(`<b>${index + 1}. ${escapeHtml(displayName(card.name))}</b>${details ? `\n${escapeHtml(details)}` : ''}${groupMatches.length ? `\n${groupMatches.join('\n')}` : ''}${dishes.length ? `\n${dishes.join('\n')}` : ''}`)
  }
  if (reply.question) blocks.push(`<i>${escapeHtml(reply.question)}</i>`)
  const locale = language === 'en' ? 'en-US' : language === 'es' ? 'es-MX' : 'fr-FR'
  blocks.push(`🔎 ${Number(reply.meta?.dishCount || 0).toLocaleString(locale)} plats/menu items`)
  return blocks.filter(Boolean).join('\n\n').slice(0, 4000)
}

function compactKeyboard(reply, state) {
  state.chips = Array.isArray(reply.chips) ? reply.chips.slice(0, 4) : []
  state.lastCards = reply.cards || []
  state.lastReply = reply
  const copy = COPY[state.language]
  const rows = []
  if (state.lastCards.length) {
    rows.push(state.lastCards.map((card, index) => ({
      text: `${index + 1} · ${displayName(card.name)}`.slice(0, 22), callback_data: `card:${index}`,
    })))
  }
  for (let i = 0; i < state.chips.length; i += 2) {
    rows.push(state.chips.slice(i, i + 2).map((text, j) => ({ text, callback_data: `chip:${i + j}` })))
  }
  if (reply.cards?.length) {
    rows.push([
      { text: `↻ ${copy.more}`, callback_data: 'more' },
      { text: '👍', callback_data: 'vote:up' },
      { text: '👎', callback_data: 'vote:down' },
    ])
  }
  return rows.length ? { inline_keyboard: rows } : undefined
}

function formatCardDetail(card, index, language) {
  const place = [card.colonia, card.alcaldia].filter(Boolean).join(' · ')
  const distinction = card.michelin_stars ? `⭐ Michelin ${card.michelin_stars}`
    : card.bib_gourmand ? 'Michelin Bib Gourmand' : card.in_worlds_50_best ? "World's 50 Best" : card.michelin_distinction
  const details = [card.rating ? `★ ${card.rating}/5` : null, card.price_level ? '$'.repeat(card.price_level) : null, place, distinction]
    .filter(Boolean).join(' · ')
  const dishes = card.dishes.slice(0, 3).map(dish => {
    const price = dish.prix != null ? ` — ${dish.prix} ${dish.devise || 'MXN'}` : ''
    return `• ${escapeHtml(dish.nom)}${escapeHtml(price)}`
  })
  const groupMatches = (card.group_matches || []).map(match => {
    const label = DIET_LABELS[language][match.requirement] || match.requirement
    return `✓ ${escapeHtml(label)} : ${escapeHtml(match.evidence)}`
  })
  return `<b>${index + 1}. ${escapeHtml(displayName(card.name))}</b>${details ? `\n${escapeHtml(details)}` : ''}${groupMatches.length ? `\n\n${groupMatches.join('\n')}` : ''}${dishes.length ? `\n\n${dishes.join('\n')}` : ''}`
}

function detailKeyboard(card, index, state) {
  const copy = COPY[state.language]
  const rows = []
  const links = []
  const map = mapsUrl(card)
  const website = safeUrl(card.website)
  const instagram = safeUrl(card.instagram)
  const booking = safeUrl(card.opentable_url)
  if (map) links.push({ text: `📍 ${copy.maps}`, url: map })
  if (website) links.push({ text: `🌐 ${copy.site}`, url: website })
  if (instagram) links.push({ text: `📸 ${copy.instagram}`, url: instagram })
  if (booking) links.push({ text: `🍽 ${copy.reserve}`, url: booking })
  for (let i = 0; i < links.length; i += 2) rows.push(links.slice(i, i + 2))
  rows.push([
    { text: `← ${copy.back}`, callback_data: 'back' },
    { text: `♡ ${copy.favorite}`, callback_data: `fav:${index}` },
  ])
  return { inline_keyboard: rows }
}

async function sendConciergeReply(chat, state, more = false, editMessageId = null) {
  await telegram('sendChatAction', { chat_id: chat.id, action: 'typing' })
  const typing = setInterval(() => telegram('sendChatAction', { chat_id: chat.id, action: 'typing' }).catch(() => {}), 4000)
  let reply
  try { reply = await askConcierge(state, more) } finally { clearInterval(typing) }
  if (reply.status !== 'ok') {
    const copy = COPY[state.language]
    await telegram('sendMessage', { chat_id: chat.id, text: reply.status === 'no-ollama' ? copy.engineDown : copy.indexDown })
    return
  }
  state.exclude.push(...reply.cards.map(card => card.id))
  state.exclude = [...new Set(state.exclude)].slice(-60)
  state.messages.push({ role: 'assistant', content: reply.intro })
  state.messages = state.messages.slice(-12)
  const payload = {
    chat_id: chat.id, text: formatReply(reply, state.language), parse_mode: 'HTML',
    reply_markup: compactKeyboard(reply, state),
  }
  if (editMessageId) await telegram('editMessageText', { ...payload, message_id: editMessageId })
  else await telegram('sendMessage', { ...payload, disable_web_page_preview: true })
  logEvent(chat.id, 'assistant', {
    intro: reply.intro, question: reply.question, chips: reply.chips, filter: reply.meta?.filter,
    cards: reply.cards.map(card => ({ id: card.id, name: card.name })),
  })
}

async function showFavorites(chat, state) {
  const copy = COPY[state.language]
  const rows = botDb.prepare('SELECT card_json FROM favorites WHERE chat_id=? ORDER BY created_at DESC LIMIT 20').all(String(chat.id))
  if (!rows.length) return telegram('sendMessage', { chat_id: chat.id, text: copy.noFavorites })
  const cards = rows.map(row => JSON.parse(row.card_json))
  const buttons = cards.map((card, index) => {
    const map = mapsUrl(card)
    return map ? [{ text: `📍 ${index + 1} ${displayName(card.name)}`.slice(0, 60), url: map }] : []
  }).filter(row => row.length)
  await telegram('sendMessage', {
    chat_id: chat.id,
    text: `<b>${escapeHtml(copy.favorites)}</b>\n\n${cards.map((card, index) => `${index + 1}. ${escapeHtml(displayName(card.name))}`).join('\n')}`,
    parse_mode: 'HTML', reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
  })
}

async function handleMessage(message) {
  const chat = message.chat
  const telegramLanguage = languageFromCode(message.from?.language_code)
  const state = stateFor(chat.id, telegramLanguage)
  if (message.location) {
    logEvent(chat.id, 'user', { location: { lat: message.location.latitude, lng: message.location.longitude } })
    state.language = telegramLanguage
    state.location = { lat: message.location.latitude, lng: message.location.longitude }
    state.profile.location = state.location
    state.profile.areaText = null
    state.profile.language = state.language
    if (!state.profile.complete && state.profile.step === 'location') {
      saveProfile(chat.id, state.profile)
      await sendCuisineQuestion(chat.id, state)
      return
    }
    saveProfile(chat.id, state.profile)
    state.messages.push({ role: 'user', content: COPY[state.language].nearbyQuery })
    state.messages = state.messages.slice(-12)
    await sendConciergeReply(chat, state, false)
    return
  }

  const text = String(message.text || '').trim()
  if (!text) return
  logEvent(chat.id, 'user', { text: text.slice(0, 500) })
  const command = text.split(/\s/)[0].split('@')[0].toLowerCase()
  if (command === '/start') {
    const existing = loadProfile(chat.id, telegramLanguage)
    if (existing.complete) {
      states.set(chat.id, freshState(existing.language, existing))
      await telegram('sendMessage', { chat_id: chat.id, text: `${ONBOARD[existing.language].welcomeBack}\n\n${profileSummary(existing, existing.language)}`, parse_mode: 'HTML' })
      return
    }
    const profile = emptyProfile(telegramLanguage)
    saveProfile(chat.id, profile)
    states.set(chat.id, freshState(telegramLanguage, profile))
    await telegram('sendMessage', { chat_id: chat.id, text: ONBOARD[telegramLanguage].intro, parse_mode: 'HTML' })
    await telegram('sendMessage', { chat_id: chat.id, text: ONBOARD[telegramLanguage].party, parse_mode: 'HTML', reply_markup: partyKeyboard() })
    return
  }
  if (command === '/reset' || command === '/new') {
    states.set(chat.id, freshState(state.language, state.profile))
    await telegram('sendMessage', { chat_id: chat.id, text: ONBOARD[state.language].newSearch })
    return
  }
  if (command === '/help') {
    await telegram('sendMessage', { chat_id: chat.id, text: COPY[state.language].help })
    return
  }
  if (command === '/favorites') {
    await showFavorites(chat, state)
    return
  }
  if (command === '/profile') {
    if (!state.profile.complete) {
      await telegram('sendMessage', { chat_id: chat.id, text: ONBOARD[state.language].profileMissing })
    } else {
      await telegram('sendMessage', { chat_id: chat.id, text: profileSummary(state.profile, state.language), parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: ONBOARD[state.language].updateProfile, callback_data: 'profile:restart' }]] } })
    }
    return
  }
  if (command === '/anywhere') {
    state.location = null
    state.profile.location = null
    saveProfile(chat.id, state.profile)
    await telegram('sendMessage', { chat_id: chat.id, text: COPY[state.language].anywhere })
    return
  }

  if (!state.profile.complete) {
    if (state.profile.step === 'location') {
      state.profile.areaText = text.slice(0, 120)
      state.profile.location = null
      state.location = null
      saveProfile(chat.id, state.profile)
      await sendCuisineQuestion(chat.id, state)
      return
    }
    if (state.profile.step === 'cuisine') {
      await completeOnboarding(chat.id, state, text.slice(0, 80))
      return
    }
    await telegram('sendMessage', { chat_id: chat.id, text: ONBOARD[state.language][state.profile.step] || ONBOARD[state.language].party, parse_mode: 'HTML' })
    return
  }

  state.language = detectLanguage(text, state.language || telegramLanguage)
  state.messages.push({ role: 'user', content: text.slice(0, 500) })
  state.messages = state.messages.slice(-12)
  await sendConciergeReply(chat, state, false)
}

async function handleCallback(callback) {
  const chat = callback.message?.chat
  if (!chat) return
  const state = stateFor(chat.id, languageFromCode(callback.from?.language_code))
  const copy = COPY[state.language]
  const messageId = callback.message?.message_id
  logEvent(chat.id, 'callback', { data: callback.data })

  if (callback.data === 'profile:restart') {
    const profile = emptyProfile(state.language)
    saveProfile(chat.id, profile)
    states.set(chat.id, freshState(state.language, profile))
    await telegram('answerCallbackQuery', { callback_query_id: callback.id })
    await telegram('sendMessage', { chat_id: chat.id, text: ONBOARD[state.language].party, parse_mode: 'HTML', reply_markup: partyKeyboard() })
    return
  }

  if (callback.data?.startsWith('onboard:party:')) {
    const value = Number(callback.data.slice('onboard:party:'.length))
    if (!Number.isInteger(value) || value < 1) return
    state.profile.partySize = value
    state.profile.step = 'dietary'
    saveProfile(chat.id, state.profile)
    await telegram('answerCallbackQuery', { callback_query_id: callback.id })
    if (messageId) await telegram('editMessageText', { chat_id: chat.id, message_id: messageId, text: ONBOARD[state.language].dietary, parse_mode: 'HTML', reply_markup: dietaryKeyboard(state.profile, state.language) })
    return
  }

  if (callback.data?.startsWith('onboard:diet:')) {
    const choice = callback.data.slice('onboard:diet:'.length)
    await telegram('answerCallbackQuery', { callback_query_id: callback.id })
    if (choice === 'done' || choice === 'none') {
      if (choice === 'none') state.profile.dietary = []
      state.profile.step = 'budget'
      saveProfile(chat.id, state.profile)
      if (messageId) await telegram('editMessageText', { chat_id: chat.id, message_id: messageId, text: ONBOARD[state.language].budget, parse_mode: 'HTML', reply_markup: budgetKeyboard(state.language) })
      return
    }
    if (!DIET_LABELS[state.language][choice]) return
    const selected = new Set(state.profile.dietary || [])
    if (selected.has(choice)) selected.delete(choice); else selected.add(choice)
    state.profile.dietary = [...selected]
    saveProfile(chat.id, state.profile)
    if (messageId) await telegram('editMessageReplyMarkup', { chat_id: chat.id, message_id: messageId, reply_markup: dietaryKeyboard(state.profile, state.language) })
    return
  }

  if (callback.data?.startsWith('onboard:budget:')) {
    const budget = callback.data.slice('onboard:budget:'.length)
    if (!BUDGET_LABELS[state.language][budget]) return
    state.profile.budget = budget
    state.profile.step = 'location'
    saveProfile(chat.id, state.profile)
    await telegram('answerCallbackQuery', { callback_query_id: callback.id })
    if (messageId) await telegram('editMessageText', { chat_id: chat.id, message_id: messageId, text: `✓ ${escapeHtml(BUDGET_LABELS[state.language][budget])}`, parse_mode: 'HTML' })
    await telegram('sendMessage', {
      chat_id: chat.id, text: ONBOARD[state.language].location, parse_mode: 'HTML',
      reply_markup: chat.type === 'private' ? { keyboard: [[{ text: ONBOARD[state.language].share, request_location: true }]], resize_keyboard: true, one_time_keyboard: true } : undefined,
    })
    return
  }

  if (callback.data?.startsWith('onboard:cuisine:')) {
    const cuisine = callback.data.slice('onboard:cuisine:'.length)
    if (!CUISINE_LABELS[state.language][cuisine]) return
    await telegram('answerCallbackQuery', { callback_query_id: callback.id })
    if (messageId) await telegram('editMessageText', { chat_id: chat.id, message_id: messageId, text: `✓ ${escapeHtml(CUISINE_LABELS[state.language][cuisine])}`, parse_mode: 'HTML' })
    await completeOnboarding(chat.id, state, cuisine)
    return
  }

  if (callback.data?.startsWith('card:')) {
    const index = Number(callback.data.slice(5))
    const card = state.lastCards[index]
    await telegram('answerCallbackQuery', { callback_query_id: callback.id })
    if (card && messageId) {
      await telegram('editMessageText', {
        chat_id: chat.id, message_id: messageId, text: formatCardDetail(card, index, state.language),
        parse_mode: 'HTML', reply_markup: detailKeyboard(card, index, state),
      })
    }
    return
  }
  if (callback.data === 'back') {
    await telegram('answerCallbackQuery', { callback_query_id: callback.id })
    if (state.lastReply && messageId) {
      await telegram('editMessageText', {
        chat_id: chat.id, message_id: messageId, text: formatReply(state.lastReply, state.language),
        parse_mode: 'HTML', reply_markup: compactKeyboard(state.lastReply, state),
      })
    }
    return
  }

  if (callback.data?.startsWith('vote:')) {
    const vote = callback.data.slice(5) === 'up' ? 'up' : 'down'
    const query = [...state.messages].reverse().find(message => message.role === 'user')?.content || null
    insertFeedback.run(new Date().toISOString(), String(chat.id), vote, query, JSON.stringify(state.lastCards.map(card => card.id)))
    await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: vote === 'up' ? '👍' : '📝' })
    return
  }
  if (callback.data?.startsWith('fav:')) {
    const card = state.lastCards[Number(callback.data.slice(4))]
    if (card) insertFavorite.run(String(chat.id), card.id, card.name, JSON.stringify(card), new Date().toISOString())
    await telegram('answerCallbackQuery', { callback_query_id: callback.id, text: copy.saved })
    return
  }

  await telegram('answerCallbackQuery', { callback_query_id: callback.id })
  if (callback.data === 'more') {
    await sendConciergeReply(chat, state, true, messageId)
    return
  }
  if (callback.data?.startsWith('chip:')) {
    const chip = state.chips[Number(callback.data.slice(5))]
    if (!chip) return
    state.messages.push({ role: 'user', content: chip })
    state.messages = state.messages.slice(-12)
    await sendConciergeReply(chat, state, false, messageId)
  }
}

async function main() {
  const me = await telegram('getMe')
  const webhook = await telegram('getWebhookInfo')
  if (webhook.url) throw new Error('Un webhook Telegram est déjà actif; supprime-le avant le long polling.')
  await Promise.all([
    telegram('setMyCommands', { commands: [
      { command: 'new', description: 'Start a new search' }, { command: 'profile', description: 'View or update my profile' },
      { command: 'favorites', description: 'Saved restaurants' }, { command: 'anywhere', description: 'Clear location' }, { command: 'help', description: 'Help' },
    ] }),
    telegram('setMyCommands', { language_code: 'fr', commands: [
      { command: 'new', description: 'Nouvelle recherche' }, { command: 'profile', description: 'Voir ou modifier mon profil' },
      { command: 'favorites', description: 'Mes restaurants favoris' }, { command: 'anywhere', description: 'Retirer ma position' }, { command: 'help', description: 'Aide' },
    ] }),
    telegram('setMyCommands', { language_code: 'es', commands: [
      { command: 'new', description: 'Nueva búsqueda' }, { command: 'profile', description: 'Ver o modificar mi perfil' },
      { command: 'favorites', description: 'Mis restaurantes favoritos' }, { command: 'anywhere', description: 'Eliminar ubicación' }, { command: 'help', description: 'Ayuda' },
    ] }),
  ])
  console.log(`Telegram bot actif: @${me.username}`)
  let offset = 0
  while (running) {
    try {
      const updates = await telegram('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'callback_query'] })
      for (const update of updates) {
        offset = update.update_id + 1
        try {
          if (update.message) await handleMessage(update.message)
          else if (update.callback_query) await handleCallback(update.callback_query)
        } catch (error) {
          const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id
          const state = chatId ? stateFor(chatId) : null
          console.error(`Update ${update.update_id}: ${error.message}`)
          if (chatId) await telegram('sendMessage', { chat_id: chatId, text: COPY[state?.language || 'fr'].error }).catch(() => {})
        }
      }
    } catch (error) {
      if (!running) break
      console.error(error.message)
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  process.on('SIGINT', () => { running = false })
  process.on('SIGTERM', () => { running = false })
  main().catch(error => { console.error(error.message); process.exit(1) })
}

export {
  emptyProfile, loadProfile, saveProfile, freshState, partyKeyboard, dietaryKeyboard,
  budgetKeyboard, cuisineKeyboard, profileSummary, formatReply, formatCardDetail,
}
