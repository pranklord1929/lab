#!/usr/bin/env node
/**
 * Assign curated symbolic avatars + display names to seed demo profiles.
 * Uses the closed catalogues in DispatchAvatar (symbol + tint).
 *
 * Usage: node scripts/seed_demo_avatars.mjs --apply
 */

import { readFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const ENV_PATH = '.env.staging.local'
const apply = process.argv.includes('--apply')

/** Curated looks — each seed member gets a stable kitchen identity. */
const SEEDS = [
  { username: 'amelia_ruiz', display_name: 'Amelia', avatar_symbol: 'wineglass', avatar_tint: 'plum' },
  { username: 'camila_v', display_name: 'Camila', avatar_symbol: 'fish', avatar_tint: 'clay' },
  { username: 'ines_mora', display_name: 'Inés', avatar_symbol: 'carrot', avatar_tint: 'olive' },
  { username: 'lucia_cdmx', display_name: 'Lucía', avatar_symbol: 'leaf', avatar_tint: 'olive' },
  { username: 'mateo_g', display_name: 'Mateo', avatar_symbol: 'frying.pan', avatar_tint: 'ember' },
  { username: 'noah_p', display_name: 'Noah', avatar_symbol: 'cup.and.saucer', avatar_tint: 'gold' },
  { username: 'rafa_ortiz', display_name: 'Rafa', avatar_symbol: 'flame', avatar_tint: 'ember' },
  { username: 'santi_bl', display_name: 'Santi', avatar_symbol: 'fork.knife', avatar_tint: 'ink' },
  { username: 'tomas_rey', display_name: 'Tomás', avatar_symbol: 'mug', avatar_tint: 'clay' },
  { username: 'vale_mx', display_name: 'Vale', avatar_symbol: 'birthday.cake', avatar_tint: 'plum' },
]

function loadEnv(path) {
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trimStart().startsWith('#')) continue
    const i = line.indexOf('=')
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return env
}

if (!existsSync(ENV_PATH)) {
  console.error('Missing .env.staging.local')
  process.exit(1)
}

const env = loadEnv(ENV_PATH)
const sb = createClient(env.STAGING_SUPABASE_URL, env.STAGING_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

console.log(`Will set avatars for ${SEEDS.length} seed profiles.`)
if (!apply) {
  console.log(SEEDS)
  console.log('Dry run. Re-run with --apply.')
  process.exit(0)
}

let updated = 0
for (const seed of SEEDS) {
  const { data, error } = await sb
    .from('profiles')
    .update({
      display_name: seed.display_name,
      avatar_symbol: seed.avatar_symbol,
      avatar_tint: seed.avatar_tint,
    })
    .eq('username', seed.username)
    .select('id,username,avatar_symbol,avatar_tint,display_name')
  if (error) throw error
  if (data?.length) {
    updated++
    console.log('✓', data[0].username, data[0].avatar_symbol, data[0].avatar_tint)
  } else {
    console.warn('missing profile', seed.username)
  }
}
console.log(JSON.stringify({ updated }, null, 2))
