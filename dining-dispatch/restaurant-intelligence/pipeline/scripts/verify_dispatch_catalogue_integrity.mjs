#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const LEGACY_REF = 'enknwdpjjkpjvhjkubju';
const env = Object.fromEntries(
  readFileSync('.env.staging.local', 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

if (
  !env.STAGING_SUPABASE_URL
  || !env.STAGING_SUPABASE_ANON_KEY
  || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY
  || env.STAGING_SUPABASE_REF === LEGACY_REF
) {
  throw new Error('Dispatch integrity verifier requires official beta credentials and refuses the legacy project.');
}

const base = env.STAGING_SUPABASE_URL;
const adminHeaders = {
  apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};
const anonHeaders = {
  apikey: env.STAGING_SUPABASE_ANON_KEY,
  Authorization: `Bearer ${env.STAGING_SUPABASE_ANON_KEY}`,
};

async function admin(path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { ...adminHeaders, ...options.headers },
  });
}

async function createUser() {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `dispatch-integrity-${suffix}@example.invalid`;
  const password = `Dispatch-${suffix}-Aa1!`;
  const created = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: `integrity_${Date.now().toString().slice(-6)}` },
    }),
  });
  if (!created.ok) throw new Error(`Could not create fixture user (HTTP ${created.status}).`);
  const user = await created.json();
  const signedIn = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.STAGING_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signedIn.ok) throw new Error(`Could not sign in fixture user (HTTP ${signedIn.status}).`);
  return { id: user.id, token: (await signedIn.json()).access_token };
}

function userHeaders(token, returning = true) {
  return {
    apikey: env.STAGING_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(returning ? { Prefer: 'return=representation' } : {}),
  };
}

let fixture;
let dispatchID;
let passed = 0;
let failed = 0;
function check(label, condition) {
  console.log(`  ${condition ? 'OK   ' : 'FAIL '} ${label}`);
  condition ? passed++ : failed++;
}

try {
  const catalogueResponse = await fetch(
    `${base}/rest/v1/app_catalogue?select=id,name,colonia,alcaldia&limit=1`,
    { headers: anonHeaders },
  );
  const catalogueRows = catalogueResponse.ok ? await catalogueResponse.json() : [];
  const restaurant = catalogueRows[0];
  if (!restaurant) throw new Error('The beta catalogue is empty.');

  fixture = await createUser();

  const created = await fetch(`${base}/rest/v1/dispatches`, {
    method: 'POST',
    headers: userHeaders(fixture.token),
    body: JSON.stringify({
      author_id: fixture.id,
      restaurant_id: restaurant.id,
      restaurant_name: 'FORGED RESTAURANT NAME',
      restaurant_area: 'FORGED AREA',
      body: 'A complete fixture note with enough useful detail.',
      kind: 'field_note',
      visited_on: '2026-07-26',
    }),
  });
  const createdRows = await created.json().catch(() => []);
  dispatchID = createdRows[0]?.id;
  check('owner can publish against app_catalogue', created.status === 201 && Boolean(dispatchID));
  check(
    'database overwrites client restaurant labels',
    createdRows[0]?.restaurant_name === restaurant.name
      && createdRows[0]?.restaurant_area === (restaurant.colonia ?? restaurant.alcaldia),
  );

  const invalid = await fetch(`${base}/rest/v1/dispatches`, {
    method: 'POST',
    headers: userHeaders(fixture.token),
    body: JSON.stringify({
      author_id: fixture.id,
      restaurant_id: crypto.randomUUID(),
      restaurant_name: 'Invented',
      body: 'A complete but non-catalogue fixture restaurant note.',
      kind: 'field_note',
      visited_on: '2026-07-26',
    }),
  });
  check('non-catalogue restaurant is rejected', invalid.status >= 400);

  const updated = dispatchID
    ? await fetch(`${base}/rest/v1/rpc/update_field_note`, {
        method: 'POST',
        headers: userHeaders(fixture.token, false),
        body: JSON.stringify({
          target_dispatch_id: dispatchID,
          new_body: 'The field note and all of its topics changed atomically.',
          new_topics: ['Food', 'Service'],
        }),
      })
    : null;
  check('owner can update field note atomically', updated?.ok === true);

  const topics = dispatchID
    ? await fetch(
        `${base}/rest/v1/dispatch_topics?dispatch_id=eq.${dispatchID}&select=topic&order=topic`,
        { headers: anonHeaders },
      ).then((response) => (response.ok ? response.json() : []))
    : [];
  check(
    'atomic update leaves the complete topic set',
    topics.map((row) => row.topic).join(',') === 'Food,Service',
  );

  const publicRead = dispatchID
    ? await fetch(
        `${base}/rest/v1/dispatches?id=eq.${dispatchID}&select=restaurant_id,restaurant_name,body`,
        { headers: anonHeaders },
      )
    : null;
  const publicRows = publicRead?.ok ? await publicRead.json() : [];
  check(
    'qualified canonical note remains publicly readable',
    publicRows[0]?.restaurant_id === restaurant.id
      && publicRows[0]?.restaurant_name === restaurant.name,
  );
} finally {
  if (fixture?.id) {
    await admin(`/auth/v1/admin/users/${fixture.id}`, { method: 'DELETE' });
  }
}

const residual = dispatchID
  ? await admin(`/rest/v1/dispatches?id=eq.${dispatchID}&select=id`).then((response) => response.json())
  : [];
check('fixture cleanup cascades through the community tables', residual.length === 0);

console.log(`Dispatch catalogue integrity: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
