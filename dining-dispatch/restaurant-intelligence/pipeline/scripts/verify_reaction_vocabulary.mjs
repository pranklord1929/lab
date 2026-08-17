#!/usr/bin/env node
//
// Prouve sur staging que le vocabulaire des réactions est celui de la décision
// Phase 0, et que l'ancien est refusé par la base — pas seulement masqué par
// un libellé côté client.

import { readFileSync } from 'node:fs';

const PRODUCTION_REF = 'enknwdpjjkpjvhjkubju';
const env = Object.fromEntries(readFileSync('.env.staging.local', 'utf8').split('\n').filter((line) => line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));

if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY || env.STAGING_SUPABASE_REF === PRODUCTION_REF) {
  throw new Error('Reaction vocabulary verifier requires staging credentials and refuses production.');
}

const rules = JSON.parse(readFileSync('shared/community-rules.json', 'utf8'));
const base = env.STAGING_SUPABASE_URL;
const adminHeaders = { apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const admin = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { ...adminHeaders, ...options.headers } });

async function createUser(label) {
  const email = `reaction-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
  const password = `Reaction-${Math.random().toString(36).slice(2)}-Aa1!`;
  const response = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username: `react_${label}_${Date.now().toString().slice(-5)}` } }),
  });
  if (!response.ok) throw new Error(`Could not create ${label} fixture (HTTP ${response.status}).`);
  const user = await response.json();
  const signedIn = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.STAGING_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signedIn.ok) throw new Error(`Could not sign in ${label} fixture (HTTP ${signedIn.status}).`);
  return { id: user.id, token: (await signedIn.json()).access_token };
}

const userHeaders = (token) => ({ apikey: env.STAGING_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' });

let author;
let reader;
let dispatchID;
let passed = 0;
let failed = 0;
const check = (label, condition) => {
  console.log(`  ${condition ? 'OK   ' : 'FAIL '} ${label}`);
  condition ? passed++ : failed++;
};

try {
  author = await createUser('author');
  reader = await createUser('reader');

  const created = await fetch(`${base}/rest/v1/dispatches`, {
    method: 'POST',
    headers: userHeaders(author.token),
    body: JSON.stringify({
      author_id: author.id,
      restaurant_id: '00000000-0000-0000-0000-0000000000a1',
      restaurant_name: 'Temporary Reaction Fixture',
      body: 'Come later, the line clears after two in the afternoon.',
      kind: 'field_note',
      visited_on: '2026-07-26',
    }),
  });
  dispatchID = (await created.json().catch(() => []))[0]?.id;
  if (!dispatchID) throw new Error(`Could not create the dispatch fixture (HTTP ${created.status}).`);

  for (const type of rules.reactionTypes) {
    const response = await fetch(`${base}/rest/v1/reactions`, {
      method: 'POST', headers: userHeaders(reader.token),
      body: JSON.stringify({ dispatch_id: dispatchID, user_id: reader.id, type }),
    });
    check(`the database accepts ${type}`, response.status === 201);
  }

  for (const type of rules.retiredReactionTypes) {
    const response = await fetch(`${base}/rest/v1/reactions`, {
      method: 'POST', headers: userHeaders(reader.token),
      body: JSON.stringify({ dispatch_id: dispatchID, user_id: reader.id, type }),
    });
    check(`the database rejects the retired ${type}`, response.status >= 400);
  }
} finally {
  if (dispatchID) await admin(`/rest/v1/dispatches?id=eq.${dispatchID}`, { method: 'DELETE' });
  for (const user of [author, reader].filter(Boolean)) await admin(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
  console.log('Temporary fixtures removed.');
}

console.log(`Reaction vocabulary: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
