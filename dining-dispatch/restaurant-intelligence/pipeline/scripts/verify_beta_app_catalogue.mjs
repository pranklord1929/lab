#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const LEGACY_REF = 'enknwdpjjkpjvhjkubju';
const EXPECTED_BETA_COUNT = 876;
const env = Object.fromEntries(
  readFileSync('.env.staging.local', 'utf8')
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

if (
  !env.STAGING_SUPABASE_URL ||
  !env.STAGING_SUPABASE_ANON_KEY ||
  !env.STAGING_SUPABASE_SERVICE_ROLE_KEY ||
  env.STAGING_SUPABASE_REF === LEGACY_REF
) {
  throw new Error('Beta catalogue verifier requires the non-legacy backend credentials.');
}

const base = env.STAGING_SUPABASE_URL;
const anon = {
  apikey: env.STAGING_SUPABASE_ANON_KEY,
  Authorization: `Bearer ${env.STAGING_SUPABASE_ANON_KEY}`,
};
const admin = {
  apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
};

async function rows(path, headers = anon) {
  const response = await fetch(`${base}/rest/v1/${path}`, { headers });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function exactCount(path, headers = anon) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    method: 'HEAD',
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  });
  const range = response.headers.get('content-range') || '';
  return { status: response.status, count: Number(range.split('/').at(-1)) || 0 };
}

async function rpc(searchQuery) {
  const response = await fetch(`${base}/rest/v1/rpc/search_app_restaurants`, {
    method: 'POST',
    headers: { ...anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ search_query: searchQuery, max_results: 50 }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
  console.log(`  ${condition ? 'OK   ' : 'FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
  condition ? passed++ : failed++;
}

const app = await exactCount('app_catalogue?select=id');
check(
  'anonymous app catalogue contains only the qualified beta cohort',
  app.status < 300 && app.count === EXPECTED_BETA_COUNT,
  `${app.count} rows`,
);

const raw = await rows('restaurant_search_mv?select=id&limit=1');
check('raw corpus remains inaccessible', [401, 403, 404].includes(raw.status), `HTTP ${raw.status}`);

const governance = await rows('catalogue_membership?select=restaurant_id&limit=1');
check('catalogue governance remains private', [401, 403, 404].includes(governance.status), `HTTP ${governance.status}`);

const strictPublic = await exactCount('public_catalogue?select=id');
check(
  'human-reviewed public catalogue remains empty',
  strictPublic.status < 300 && strictPublic.count === 0,
);

const internalColumn = await rows('app_catalogue?select=id,score&limit=1');
check('pipeline score is not exposed by the beta contract', internalColumn.status >= 400);

const sample = await rows('app_catalogue?select=id,name&order=review_count.desc&limit=1');
const sampleName = Array.isArray(sample.body) ? sample.body[0]?.name : null;
const search = sampleName ? await rpc(sampleName) : { status: 0, body: [] };
check(
  'beta search returns a member of the app catalogue',
  search.status === 200 && Array.isArray(search.body) && search.body.length > 0,
);

for (const wildcard of ['%', '_', '\\']) {
  const result = await rpc(wildcard);
  check(
    `search treats ${JSON.stringify(wildcard)} literally`,
    result.status === 200 && Array.isArray(result.body) && result.body.length === 0,
  );
}

const membership = await exactCount('catalogue_membership?select=restaurant_id', admin);
check(
  'private membership count matches the app cohort',
  membership.status < 300 && membership.count === EXPECTED_BETA_COUNT,
  `${membership.count} rows`,
);

console.log(`Beta app catalogue: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
