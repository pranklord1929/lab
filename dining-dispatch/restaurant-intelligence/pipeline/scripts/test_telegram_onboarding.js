import { strict as assert } from 'node:assert'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dbPath = path.join(tmpdir(), `telegram-onboarding-${process.pid}.sqlite`)
process.env.TELEGRAM_BOT_TOKEN = 'local-test-token'
process.env.TELEGRAM_DB_PATH = dbPath

const onboarding = await import('./telegram_bot.js')
const profile = onboarding.emptyProfile('fr')
assert.equal(profile.step, 'party')
assert.equal(profile.complete, false)
assert.equal(onboarding.partyKeyboard().inline_keyboard.flat().length, 6)

profile.partySize = 5
profile.dietary = ['vegetarian', 'gluten_free']
profile.budget = 'medium'
profile.areaText = 'Roma Norte'
profile.preferredCuisine = 'mexican'
profile.step = 'ready'
profile.complete = true
onboarding.saveProfile('local-test-chat', profile)

const restored = onboarding.loadProfile('local-test-chat', 'en')
assert.deepEqual(restored, profile)
assert.match(onboarding.profileSummary(restored, 'fr'), /5/)
assert.match(onboarding.profileSummary(restored, 'fr'), /Végétarien/)
assert.match(onboarding.profileSummary(restored, 'fr'), /Roma Norte/)
assert.ok(onboarding.dietaryKeyboard(restored, 'fr').inline_keyboard.flat().some(button => button.text.startsWith('✓ Végétarien')))
assert.ok(onboarding.budgetKeyboard('en').inline_keyboard.flat().some(button => button.callback_data === 'onboard:budget:medium'))
assert.ok(onboarding.cuisineKeyboard('es').inline_keyboard.flat().some(button => button.callback_data === 'onboard:cuisine:mexican'))

const proofCard = {
  name: 'Casa Test', colonia: 'Roma Norte', alcaldia: 'Cuauhtémoc', rating: 4.6,
  price_level: 2, dishes: [], group_matches: [
    { requirement: 'vegetarian', evidence: 'Taco vegano' },
    { requirement: 'meat', evidence: 'Arrachera' },
  ],
}
const proofReply = { intro: 'Found it', cards: [proofCard], question: null, meta: { dishCount: 25003 } }
assert.match(onboarding.formatReply(proofReply, 'fr'), /Végétarien : Taco vegano/)
assert.match(onboarding.formatReply(proofReply, 'en'), /Vegetarian : Taco vegano/)
assert.match(onboarding.formatCardDetail(proofCard, 0, 'es'), /Vegetariano : Taco vegano/)
assert.match(onboarding.formatReply(proofReply, 'fr'), /Option viande : Arrachera/)
assert.match(onboarding.formatReply(proofReply, 'en'), /Meat option : Arrachera/)
assert.match(onboarding.formatCardDetail(proofCard, 0, 'es'), /Opción de carne : Arrachera/)

console.log('Telegram onboarding: persistence, summaries, keyboards and dietary proofs OK')
if (existsSync(dbPath)) rmSync(dbPath, { force: true })
