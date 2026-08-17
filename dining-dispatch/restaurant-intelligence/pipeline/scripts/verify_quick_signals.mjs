#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const PRODUCTION_REF = 'enknwdpjjkpjvhjkubju';
const env = Object.fromEntries(readFileSync('.env.staging.local', 'utf8').split('\n').filter((line) => line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));

if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY || env.STAGING_SUPABASE_REF === PRODUCTION_REF) {
  throw new Error('Quick Signal verifier requires staging credentials and refuses production.');
}

const base = env.STAGING_SUPABASE_URL;
const adminHeaders = { apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const admin = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { ...adminHeaders, ...options.headers } });

async function createUser(label) {
  const email = `quick-signal-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
  const password = `Signal-${Math.random().toString(36).slice(2)}-Aa1!`;
  const response = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username: `signal_${label}_${Date.now().toString().slice(-5)}` } }),
  });
  if (!response.ok) throw new Error(`Could not create ${label} fixture (HTTP ${response.status}).`);
  const user = await response.json();
  const signedIn = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.STAGING_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signedIn.ok) throw new Error(`Could not sign in ${label} fixture (HTTP ${signedIn.status}).`);
  const session = await signedIn.json();
  return { id: user.id, token: session.access_token };
}

function userHeaders(token) {
  return { apikey: env.STAGING_SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
}

let owner;
let stranger;
let dispatchID;
let passed = 0;
let failed = 0;
function check(label, condition) {
  console.log(`  ${condition ? 'OK   ' : 'FAIL '} ${label}`);
  condition ? passed++ : failed++;
}

try {
  owner = await createUser('owner');
  stranger = await createUser('stranger');
  const catalogueResponse = await fetch(`${base}/rest/v1/app_catalogue?select=id,name,colonia,alcaldia&limit=1`, {
    headers: { apikey: env.STAGING_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.STAGING_SUPABASE_ANON_KEY}` },
  });
  const catalogue = catalogueResponse.ok ? (await catalogueResponse.json())[0] : null;
  if (!catalogue) throw new Error('The beta catalogue is empty.');

  const created = await fetch(`${base}/rest/v1/dispatches`, {
    method: 'POST',
    headers: userHeaders(owner.token),
    body: JSON.stringify({
      author_id: owner.id,
      restaurant_id: catalogue.id,
      restaurant_name: catalogue.name,
      restaurant_area: catalogue.colonia ?? catalogue.alcaldia,
      body: 'Come later.',
      kind: 'quick_signal',
      visited_on: '2026-07-25',
    }),
  });
  const createdRows = await created.json().catch(() => []);
  dispatchID = createdRows[0]?.id;
  check('owner can publish a short Quick Signal', created.status === 201 && Boolean(dispatchID));

  const fieldNoteTooShort = await fetch(`${base}/rest/v1/dispatches`, {
    method: 'POST', headers: userHeaders(owner.token),
    body: JSON.stringify({ author_id: owner.id, restaurant_id: catalogue.id, restaurant_name: catalogue.name, body: 'Short note', kind: 'field_note' }),
  });
  check('database keeps the Field Note minimum', fieldNoteTooShort.status >= 400);

  const forged = await fetch(`${base}/rest/v1/dispatches`, {
    method: 'POST', headers: userHeaders(stranger.token),
    body: JSON.stringify({ author_id: owner.id, restaurant_id: catalogue.id, restaurant_name: catalogue.name, body: 'Come later.', kind: 'quick_signal' }),
  });
  check('stranger cannot publish as the owner', forged.status === 401 || forged.status === 403);

  const foreignEdit = dispatchID ? await fetch(`${base}/rest/v1/dispatches?id=eq.${dispatchID}`, {
    method: 'PATCH', headers: userHeaders(stranger.token), body: JSON.stringify({ body: 'Tampered update.' }),
  }) : null;
  check('stranger cannot edit the owner signal', foreignEdit?.status === 200 && (await foreignEdit.text()) === '[]');

  const publicRead = dispatchID ? await fetch(`${base}/rest/v1/dispatches?id=eq.${dispatchID}&select=kind,body`, {
    headers: { apikey: env.STAGING_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.STAGING_SUPABASE_ANON_KEY}` },
  }) : null;
  const rows = publicRead?.ok ? await publicRead.json() : [];
  check('public thread exposes the Quick Signal kind', rows[0]?.kind === 'quick_signal' && rows[0]?.body === 'Come later.');
} finally {
  if (dispatchID) await admin(`/rest/v1/dispatches?id=eq.${dispatchID}`, { method: 'DELETE' });
  for (const user of [owner, stranger].filter(Boolean)) await admin(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
}

console.log(`Quick Signal workflow: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
