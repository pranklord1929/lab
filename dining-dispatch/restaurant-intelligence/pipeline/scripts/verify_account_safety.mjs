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
  throw new Error('Account safety verifier requires official beta credentials and refuses the legacy project.');
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
const admin = (path, options = {}) => fetch(`${base}${path}`, {
  ...options,
  headers: { ...adminHeaders, ...options.headers },
});

async function createUser(label) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `account-${label}-${suffix}@example.invalid`;
  const password = `Account-${suffix}-Aa1!`;
  const created = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: `account_${label}_${Date.now().toString().slice(-5)}` },
    }),
  });
  if (!created.ok) throw new Error(`Could not create ${label} fixture (HTTP ${created.status}).`);
  const user = await created.json();
  const signedIn = await fetch(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.STAGING_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!signedIn.ok) throw new Error(`Could not sign in ${label} fixture (HTTP ${signedIn.status}).`);
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

let owner;
let blocked;
let passed = 0;
let failed = 0;
function check(label, condition) {
  console.log(`  ${condition ? 'OK   ' : 'FAIL '} ${label}`);
  condition ? passed++ : failed++;
}

try {
  owner = await createUser('owner');
  blocked = await createUser('blocked');

  const inserted = await fetch(`${base}/rest/v1/blocked_users`, {
    method: 'POST',
    headers: userHeaders(owner.token),
    body: JSON.stringify({ user_id: owner.id, blocked_user_id: blocked.id }),
  });
  check('member can block another member', inserted.status === 201);

  const ownerRead = await fetch(`${base}/rest/v1/blocked_users?select=blocked_user_id`, {
    headers: userHeaders(owner.token, false),
  });
  const ownerRows = ownerRead.ok ? await ownerRead.json() : [];
  check('owner can read their private block', ownerRows[0]?.blocked_user_id === blocked.id);

  const blockedRead = await fetch(`${base}/rest/v1/blocked_users?select=blocked_user_id`, {
    headers: userHeaders(blocked.token, false),
  });
  check('blocked member cannot see who blocked them', blockedRead.ok && (await blockedRead.json()).length === 0);

  const anonRead = await fetch(`${base}/rest/v1/blocked_users?select=blocked_user_id`, {
    headers: anonHeaders,
  });
  check('anonymous clients cannot read block lists', anonRead.status === 401 || anonRead.status === 403);

  const selfBlock = await fetch(`${base}/rest/v1/blocked_users`, {
    method: 'POST',
    headers: userHeaders(owner.token),
    body: JSON.stringify({ user_id: owner.id, blocked_user_id: owner.id }),
  });
  check('self-blocking is rejected', selfBlock.status >= 400);

  const deleted = await fetch(`${base}/rest/v1/rpc/delete_own_account`, {
    method: 'POST',
    headers: userHeaders(owner.token, false),
    body: '{}',
  });
  check('member can delete their own account', deleted.ok);

  const deletedUser = await admin(`/auth/v1/admin/users/${owner.id}`);
  check('account deletion removes the auth user', deletedUser.status === 404);
  owner = null;

  const blockResidual = await admin(
    `/rest/v1/blocked_users?blocked_user_id=eq.${blocked.id}&select=user_id`,
  );
  check('account deletion cascades through block rows', blockResidual.ok && (await blockResidual.json()).length === 0);
} finally {
  for (const user of [owner, blocked].filter(Boolean)) {
    await admin(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
  }
}

console.log(`Account safety: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
