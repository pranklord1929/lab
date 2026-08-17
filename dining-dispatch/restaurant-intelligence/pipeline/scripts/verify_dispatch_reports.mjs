#!/usr/bin/env node
//
// Prouve sur staging que le signalement fonctionne et qu'il est borné :
// un signalement réussi, pas deux, jamais sur son propre dispatch, jamais en
// anonyme, et personne ne lit les signalements d'autrui.

import { readFileSync } from 'node:fs';

const PRODUCTION_REF = 'enknwdpjjkpjvhjkubju';
const env = Object.fromEntries(readFileSync('.env.staging.local', 'utf8').split('\n').filter((line) => line.includes('=')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));

if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY || env.STAGING_SUPABASE_REF === PRODUCTION_REF) {
  throw new Error('Report verifier requires staging credentials and refuses production.');
}

const base = env.STAGING_SUPABASE_URL;
const adminHeaders = { apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
const admin = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { ...adminHeaders, ...options.headers } });

async function createUser(label) {
  const email = `report-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
  const password = `Report-${Math.random().toString(36).slice(2)}-Aa1!`;
  const response = await admin('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { username: `rep_${label}_${Date.now().toString().slice(-5)}` } }),
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
const anonHeaders = { apikey: env.STAGING_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.STAGING_SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };

let author;
let reporter;
let bystander;
let dispatchID;
let passed = 0;
let failed = 0;
const check = (label, condition) => {
  console.log(`  ${condition ? 'OK   ' : 'FAIL '} ${label}`);
  condition ? passed++ : failed++;
};

const report = (headers, body) => fetch(`${base}/rest/v1/dispatch_reports`, { method: 'POST', headers, body: JSON.stringify(body) });

try {
  author = await createUser('author');
  reporter = await createUser('reporter');
  bystander = await createUser('bystander');

  const created = await fetch(`${base}/rest/v1/dispatches`, {
    method: 'POST',
    headers: userHeaders(author.token),
    body: JSON.stringify({
      author_id: author.id,
      restaurant_id: '00000000-0000-0000-0000-0000000000b1',
      restaurant_name: 'Temporary Report Fixture',
      body: 'A dispatch that exists only so a report can point at something.',
      kind: 'field_note',
      visited_on: '2026-07-26',
    }),
  });
  dispatchID = (await created.json().catch(() => []))[0]?.id;
  if (!dispatchID) throw new Error(`Could not create the dispatch fixture (HTTP ${created.status}).`);

  const first = await report(userHeaders(reporter.token), {
    dispatch_id: dispatchID, reporter_id: reporter.id,
    reason: 'False or misleading information', details: 'Fixture report.',
  });
  check('an authenticated reader can report another author', first.status === 201);

  const duplicate = await report(userHeaders(reporter.token), {
    dispatch_id: dispatchID, reporter_id: reporter.id, reason: 'Other',
  });
  check('the same reader cannot report twice', duplicate.status === 409);

  const selfReport = await report(userHeaders(author.token), {
    dispatch_id: dispatchID, reporter_id: author.id, reason: 'Other',
  });
  check('an author cannot report their own dispatch', selfReport.status === 401 || selfReport.status === 403);

  const anonymous = await report(anonHeaders, {
    dispatch_id: dispatchID, reporter_id: reporter.id, reason: 'Other',
  });
  check('an anonymous caller cannot report', anonymous.status === 401 || anonymous.status === 403);

  const forged = await report(userHeaders(bystander.token), {
    dispatch_id: dispatchID, reporter_id: reporter.id, reason: 'Other',
  });
  check('a reader cannot report in someone else name', forged.status === 401 || forged.status === 403);

  const own = await fetch(`${base}/rest/v1/dispatch_reports?select=id,reason`, { headers: userHeaders(reporter.token) });
  const ownRows = own.ok ? await own.json() : [];
  check('a reporter reads their own report', own.status === 200 && ownRows.length === 1);

  const foreign = await fetch(`${base}/rest/v1/dispatch_reports?select=id`, { headers: userHeaders(bystander.token) });
  const foreignRows = foreign.ok ? await foreign.json() : null;
  check('another reader reads no report', foreign.status === 200 && Array.isArray(foreignRows) && foreignRows.length === 0);

  const anonRead = await fetch(`${base}/rest/v1/dispatch_reports?select=id`, { headers: anonHeaders });
  check('an anonymous caller reads no report', anonRead.status === 401 || anonRead.status === 403);

  const authorRead = await fetch(`${base}/rest/v1/dispatch_reports?select=id`, { headers: userHeaders(author.token) });
  const authorRows = authorRead.ok ? await authorRead.json() : null;
  check('a reported author never sees the report', authorRead.status === 200 && Array.isArray(authorRows) && authorRows.length === 0);
} finally {
  if (dispatchID) await admin(`/rest/v1/dispatch_reports?dispatch_id=eq.${dispatchID}`, { method: 'DELETE' });
  if (dispatchID) await admin(`/rest/v1/dispatches?id=eq.${dispatchID}`, { method: 'DELETE' });
  for (const user of [author, reporter, bystander].filter(Boolean)) await admin(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' });
  console.log('Temporary fixtures removed.');
}

console.log(`Dispatch reports: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
