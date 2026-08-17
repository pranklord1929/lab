#!/usr/bin/env node

/**
 * Idempotent staging seed for the Reddit-style restaurant conversations.
 *
 * Safety:
 * - reads only STAGING_* credentials from .env.staging.local;
 * - requires --apply before any write;
 * - uses deterministic comment ids, so reruns update the same demo rows;
 * - all artificial authors use the demo_ prefix and an explicit demo bio.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

const env = dotenv.parse(fs.readFileSync('.env.staging.local'))
const url = env.STAGING_SUPABASE_URL
const serviceKey = env.STAGING_SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  throw new Error('Missing staging Supabase credentials in .env.staging.local')
}

const apply = process.argv.includes('--apply')
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

const demoAuthors = [
  ['demo_amelia', 'Amelia'],
  ['demo_mateo', 'Mateo'],
  ['demo_lucia', 'Lucía'],
  ['demo_santiago', 'Santiago'],
  ['demo_camila', 'Camila'],
  ['demo_rafa', 'Rafa'],
  ['demo_ines', 'Inés'],
  ['demo_noah', 'Noah'],
  ['demo_vale', 'Vale'],
  ['demo_tomas', 'Tomás'],
]

const conversationSets = [
  [
    ({ name }) => `Has anyone been to ${name} recently? I’m curious about what feels most worth ordering on a first visit.`,
    () => 'I’d also love an update on the noise level and whether the room works for a long dinner with friends.',
    () => 'Same here. If someone has a good vegetarian choice, adding it to this thread would make the answer much more useful.',
    ({ name }) => `For a first meal at ${name}, would you choose lunch or dinner? I’m looking for the version of the place that feels most representative.`,
    () => 'I’d pick the service that gives you enough time to share several things. A short list of what the table actually enjoyed would help.',
  ],
  [
    ({ name, area }) => `What should someone know before booking ${name}${area ? ` in ${area}` : ''}? Practical details are more useful to me than another rating.`,
    () => 'The useful bits for me would be reservation difficulty, table spacing, and whether conversation is comfortable.',
    () => 'And payment details, please. A recent answer is much better than information copied from an old listing.',
    ({ name }) => `What is the strongest reason to return to ${name}: one particular plate, the room, the wine, or simply consistency?`,
    () => 'Consistency is usually the deciding factor for me. I’d love to hear from somebody who has visited more than once.',
  ],
  [
    ({ name }) => `Building a useful thread for ${name}: what did your table order, and which choice would you repeat or skip next time?`,
    () => 'Sharing the size of the group would help too. A menu can feel completely different for two people versus six.',
    () => 'Good point. I’m especially interested in whether it works well for sharing rather than ordering individual plates.',
    ({ name }) => `Does ${name} work better for a spontaneous meal or for an occasion you plan ahead? Recent experiences welcome.`,
    () => 'The answer probably depends on the day and time, so adding when you went would make this thread genuinely useful.',
  ],
  [
    ({ name }) => `Wine question for ${name}: is the list approachable if you want help choosing, or is it better for people who already know exactly what they want?`,
    () => 'I’d like to know whether there are interesting options by the glass. That changes whether I’d go for a casual dinner.',
    () => 'A current price range would be helpful as well, even if it is only approximate and clearly dated.',
    ({ name }) => `If you had one hour at ${name}, what would you prioritize? Looking for a concise first-timer strategy.`,
    () => 'I’d rather order fewer things well than rush through the menu. A recent shortlist from the community would be perfect.',
  ],
  [
    ({ name }) => `Could someone give a recent read on service at ${name}? Not a score—just how the meal flowed and what kind of evening it suits.`,
    () => 'Exactly. Friendly versus formal and quick versus leisurely are much more useful distinctions than “good” or “bad.”',
    () => 'It would also help to know whether the staff guided the ordering or expected the table to arrive with a plan.',
    ({ name }) => `Would you bring an out-of-town friend to ${name}, or is there another kind of occasion where it makes more sense?`,
    () => 'For visitors, I care about a sense of place as much as the food. Curious whether the whole experience feels distinctive.',
  ],
  [
    ({ name }) => `Value thread for ${name}: where did the meal feel generous, and where would you order differently next time?`,
    () => 'Total spend per person is useful only with context, especially drinks and the number of plates shared.',
    () => 'Agreed. Even a rough range with the date of the visit is better than a price symbol that never changes.',
    ({ name }) => `Is ${name} comfortable for eating solo, or does the experience really depend on sharing with a group?`,
    () => 'A bar seat or counter can change that answer completely. Recent solo diners, please add what the setup was like.',
  ],
]

function deterministicUUID(seed) {
  const bytes = crypto.createHash('sha256').update(seed).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function isoAt(restaurantIndex, slot) {
  const minutesAgo = ((restaurantIndex * 17) % (6 * 24 * 60)) + (4 - slot) * 7
  return new Date(Date.now() - minutesAgo * 60_000).toISOString()
}

function dayAt(restaurantIndex) {
  const daysAgo = restaurantIndex % 14
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

async function ensureDemoAuthors() {
  const { data: existingProfiles, error: profileError } = await supabase
    .from('profiles')
    .select('id,username')
    .in('username', demoAuthors.map(([username]) => username))
  if (profileError) throw profileError

  const byUsername = new Map((existingProfiles ?? []).map((profile) => [profile.username, profile]))

  for (const [username, displayName] of demoAuthors) {
    if (!byUsername.has(username)) {
      const email = `${username}@seed.thediningdispatch.test`
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password: crypto.randomBytes(32).toString('base64url'),
        email_confirm: true,
        user_metadata: { username },
      })
      if (error) throw error
      byUsername.set(username, { id: data.user.id, username })
    }

    const profile = byUsername.get(username)
    const { error: updateError } = await supabase
      .from('profiles')
      .update({
        bio: `${displayName} is an artificial demo account. All comments from this profile are fictional UI sample data.`,
        interests: [],
      })
      .eq('id', profile.id)
    if (updateError) throw updateError
  }

  return demoAuthors.map(([username]) => byUsername.get(username))
}

async function upsertBatches(table, rows, options, batchSize = 250) {
  let written = 0
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize)
    const { error } = await supabase.from(table).upsert(batch, options)
    if (error) throw new Error(`${table} batch ${index / batchSize + 1}: ${error.message}`)
    written += batch.length
    process.stdout.write(`\r${table}: ${written}/${rows.length}`)
  }
  process.stdout.write('\n')
}

const { data: restaurants, error: restaurantError } = await supabase
  .from('app_catalogue')
  .select('id,name,colonia,alcaldia,cuisine_key')
  .order('name')

if (restaurantError) throw restaurantError
if (!restaurants?.length) throw new Error('The staging app catalogue is empty')

const expectedComments = restaurants.length * 5
console.log(`Staging plan: ${restaurants.length} restaurants × 5 comments = ${expectedComments} artificial comments.`)
console.log('Shape per restaurant: 2 roots + 3 replies, including one reply nested at depth 2.')
console.log('Authors: 10 clearly labelled demo_* accounts.')

if (!apply) {
  console.log('Dry run only. Re-run with --apply to write the staging seed.')
  process.exit(0)
}

const authors = await ensureDemoAuthors()
const comments = []

for (const [restaurantIndex, restaurant] of restaurants.entries()) {
  const templates = conversationSets[restaurantIndex % conversationSets.length]
  const context = {
    name: restaurant.name,
    area: restaurant.colonia ?? restaurant.alcaldia,
    cuisine: restaurant.cuisine_key,
  }
  const ids = Array.from({ length: 5 }, (_, slot) =>
    deterministicUUID(`nested-demo-v1:${restaurant.id}:${slot}`),
  )
  const parents = [null, ids[0], ids[1], null, ids[3]]

  for (let slot = 0; slot < 5; slot += 1) {
    const author = authors[(restaurantIndex + slot * 3) % authors.length]
    comments.push({
      id: ids[slot],
      author_id: author.id,
      restaurant_id: restaurant.id,
      restaurant_name: restaurant.name,
      restaurant_area: restaurant.colonia ?? restaurant.alcaldia,
      body: templates[slot](context),
      visited_on: dayAt(restaurantIndex),
      meal_time: slot < 3 ? 'Dinner' : null,
      company: slot < 3 ? 'Friends' : null,
      kind: 'field_note',
      parent_id: parents[slot],
      created_at: isoAt(restaurantIndex, slot),
      updated_at: isoAt(restaurantIndex, slot),
    })
  }
}

// Parents must exist before replies. Insert roots, then depth 1, then depth 2.
for (const depth of [0, 1, 2]) {
  const rows = comments.filter((comment) => {
    if (depth === 0) return comment.parent_id === null
    const parent = comments.find((candidate) => candidate.id === comment.parent_id)
    if (depth === 1) return comment.parent_id !== null && parent?.parent_id === null
    return comment.parent_id !== null && parent != null && parent.parent_id !== null
  })
  await upsertBatches('dispatches', rows, { onConflict: 'id' })
}

const reactions = []
for (const [commentIndex, comment] of comments.entries()) {
  const voteCount = commentIndex % 5
  for (let voteIndex = 0; voteIndex < voteCount; voteIndex += 1) {
    const voter = authors[(commentIndex + voteIndex + 1) % authors.length]
    if (voter.id === comment.author_id) continue
    reactions.push({
      dispatch_id: comment.id,
      user_id: voter.id,
      type: 'helpful',
      created_at: new Date(new Date(comment.created_at).getTime() + (voteIndex + 1) * 90_000).toISOString(),
    })
  }
}

await upsertBatches(
  'reactions',
  reactions,
  { onConflict: 'dispatch_id,user_id,type', ignoreDuplicates: true },
)

const [{ count: commentCount, error: countError }, { count: demoProfileCount, error: demoCountError }] =
  await Promise.all([
    supabase.from('dispatches').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).like('username', 'demo\\_%'),
  ])

if (countError) throw countError
if (demoCountError) throw demoCountError

console.log(JSON.stringify({
  restaurants: restaurants.length,
  expectedDemoComments: expectedComments,
  totalComments: commentCount,
  demoProfiles: demoProfileCount,
  seededHelpfulVotes: reactions.length,
}, null, 2))
