#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const PRODUCTION_REF = 'enknwdpjjkpjvhjkubju';
const env = Object.fromEntries(readFileSync('.env.staging.local', 'utf8').split('\n').filter((line) => line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));

if (!env.STAGING_CATALOGUE_REVIEWER_ID || env.STAGING_SUPABASE_REF === PRODUCTION_REF) {
  throw new Error('This verifier needs the local staging reviewer and refuses production.');
}

const headers = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });
async function api(path, { method = 'GET', body, service = true, extraHeaders = {} } = {}) {
  const key = service ? env.STAGING_SUPABASE_SERVICE_ROLE_KEY : env.STAGING_SUPABASE_ANON_KEY;
  const response = await fetch(`${env.STAGING_SUPABASE_URL}${path}`, {
    method,
    headers: { ...headers(key), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || `Request failed (${response.status})`);
  return payload;
}

const members = await api('/rest/v1/catalogue_membership?select=restaurant_id&limit=1000');
const existing = new Set(members.map((row) => row.restaurant_id));
const raw = await api('/rest/v1/restaurant_search_mv?select=id&limit=1000');
const fixtureId = raw.find((row) => !existing.has(row.id))?.id;
if (!fixtureId) throw new Error('Could not find a raw non-member fixture.');

let created = false;
try {
  await api('/rest/v1/catalogue_membership', {
    method: 'POST',
    body: { restaurant_id: fixtureId, status: 'candidate', qa_note: 'temporary review workflow fixture' },
    extraHeaders: { 'Content-Type': 'application/json' },
  });
  created = true;

  for (const action of ['coordinate_verified', 'identity_verified', 'published']) {
    await api('/rest/v1/rpc/apply_catalogue_review', {
      method: 'POST',
      body: {
        p_restaurant_id: fixtureId,
        p_reviewer_id: env.STAGING_CATALOGUE_REVIEWER_ID,
        p_action: action,
        p_note: 'temporary verifier fixture',
        p_lat: null,
        p_lng: null,
      },
      extraHeaders: { 'Content-Type': 'application/json' },
    });
  }

  const publicRows = await api(`/rest/v1/public_catalogue?select=id&limit=1&id=eq.${fixtureId}`, { service: false });
  if (!publicRows.some((row) => row.id === fixtureId)) throw new Error('Published fixture is absent from the public catalogue.');

  const events = await api(`/rest/v1/catalogue_review_events?select=action&restaurant_id=eq.${fixtureId}&order=created_at.asc`);
  const expected = ['coordinate_verified', 'identity_verified', 'published'];
  if (events.map((event) => event.action).join('|') !== expected.join('|')) throw new Error('Review history is incomplete.');

  console.log('Catalogue review workflow: OK');
} finally {
  if (created) {
    await api(`/rest/v1/catalogue_membership?restaurant_id=eq.${fixtureId}`, { method: 'DELETE' });
    console.log('Temporary fixture cleaned.');
  }
}
