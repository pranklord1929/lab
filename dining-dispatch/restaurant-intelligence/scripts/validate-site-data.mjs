#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = resolve(packageRoot, 'site-data');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const fail = (message) => { throw new Error(message); };

const manifest = readJson(resolve(dataRoot, 'manifest.json'));
const index = readJson(resolve(dataRoot, 'index.json'));
const launch = readJson(resolve(dataRoot, 'launch-candidates.json'));
const collections = readJson(resolve(dataRoot, 'collections.json'));
const files = readdirSync(resolve(dataRoot, 'restaurants')).filter((file) => file.endsWith('.json'));

if (index.length !== 876) fail(`Expected 876 index records, found ${index.length}`);
if (launch.length !== 100) fail(`Expected 100 launch candidates, found ${launch.length}`);
if (files.length !== 876) fail(`Expected 876 restaurant files, found ${files.length}`);
if (manifest.counts.restaurants !== index.length) fail('Manifest/index restaurant count mismatch');
if (manifest.counts.launchCandidates !== launch.length) fail('Manifest/launch count mismatch');

const indexIds = new Set(index.map((record) => record.id));
const indexSlugs = new Set(index.map((record) => record.slug));
if (indexIds.size !== index.length) fail('Duplicate restaurant IDs in index');
if (indexSlugs.size !== index.length) fail('Duplicate restaurant slugs in index');

const launchIds = new Set(launch.map((record) => record.id));
const launchSlugs = new Set(launch.map((record) => record.slug));
if (launchIds.size !== launch.length || launchSlugs.size !== launch.length) fail('Duplicate launch candidate');
if (![...launchIds].every((id) => indexIds.has(id))) fail('Launch candidate missing from index');

for (const summary of index) {
  const path = resolve(dataRoot, 'restaurants', `${summary.slug}.json`);
  const record = readJson(path);
  if (record.id !== summary.id || record.slug !== summary.slug) fail(`Index/file mismatch: ${summary.slug}`);
  if (record.verification.status !== 'machine_assembled_candidate') fail(`Invalid verification state: ${summary.slug}`);
  if (record.editorial.status !== 'not_reviewed') fail(`Unexpected editorial state: ${summary.slug}`);
  if (record.editorial.bestFor.length || record.editorial.avoidFor.length || record.editorial.visitorTypes.length) {
    fail(`Subjective editorial arrays must be empty: ${summary.slug}`);
  }
  if (record.editorial.ambience || record.editorial.idealMoment || record.editorial.review) {
    fail(`Subjective editorial text must be empty: ${summary.slug}`);
  }
  if (record.seo.indexable !== false || summary.indexable !== false) fail(`Unreviewed record became indexable: ${summary.slug}`);
  if (record.media.publicImageUrl !== null) fail(`Unexpected public image URL: ${summary.slug}`);
  if (record.seo.launchEligible !== launchSlugs.has(summary.slug)) fail(`Launch flag/file mismatch: ${summary.slug}`);
}

for (const collection of collections) {
  if (!collection.restaurantSlugs.every((slug) => launchSlugs.has(slug))) {
    fail(`Collection references a non-launch record: ${collection.id}`);
  }
}

for (const required of ['pujol', 'quintonil']) {
  if (!indexSlugs.has(required)) fail(`Missing required spot-check route: ${required}`);
}

console.log(JSON.stringify({
  valid: true,
  restaurants: index.length,
  uniqueSlugs: indexSlugs.size,
  launchCandidates: launch.length,
  indexableRestaurants: index.filter((record) => record.indexable).length,
  restaurantFiles: files.length,
  collections: collections.length,
  requiredRoutes: ['pujol', 'quintonil'],
}, null, 2));

