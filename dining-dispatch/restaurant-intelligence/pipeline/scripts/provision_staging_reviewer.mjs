#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';

const ENV_PATH = '.env.staging.local';
const env = Object.fromEntries(readFileSync(ENV_PATH, 'utf8').split('\n').filter((line) => line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));

if (env.STAGING_CATALOGUE_REVIEWER_ID) {
  console.log('Staging reviewer already provisioned.');
  process.exit(0);
}

const headers = {
  apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
};
async function api(path, { method = 'GET', body, extraHeaders = {} } = {}) {
  const response = await fetch(`${env.STAGING_SUPABASE_URL}${path}`, {
    method,
    headers: { ...headers, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.msg || payload?.message || `Supabase request failed (${response.status}).`);
  return payload;
}
const email = 'jules-catalogue-reviewer@staging.local';
const username = 'jules_reviewer';
const existing = await api('/auth/v1/admin/users?per_page=1000');
let user = existing.users.find((entry) => entry.email === email);
if (!user) {
  const created = await api('/auth/v1/admin/users', { method: 'POST', body: {
    email,
    email_confirm: true,
    password: crypto.randomUUID() + crypto.randomUUID(),
    user_metadata: { username },
  }});
  user = created;
}

await api('/rest/v1/profiles?on_conflict=id', {
  method: 'POST',
  body: { id: user.id, username },
  extraHeaders: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
});
appendFileSync(ENV_PATH, `\nSTAGING_CATALOGUE_REVIEWER_ID=${user.id}\n`);
console.log('Staging reviewer provisioned.');
