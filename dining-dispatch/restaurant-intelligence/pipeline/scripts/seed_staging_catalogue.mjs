#!/usr/bin/env node
/*
 * Alimente le catalogue brut d'un projet Supabase de STAGING depuis le snapshot
 * SQLite local (`data/local_db/cdmx_local.sqlite`).
 *
 * La production n'est jamais lue : le snapshot local est la source. Le script
 * refuse de tourner si l'URL cible ressemble à la production.
 *
 *   node scripts/seed_staging_catalogue.mjs
 *
 * Écrit des fichiers TSV temporaires puis les charge avec `\copy` — beaucoup
 * plus rapide qu'un INSERT ligne à ligne pour 56 796 + 55 256 lignes.
 */

import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PRODUCTION_REF = 'enknwdpjjkpjvhjkubju';
const PSQL = '/opt/homebrew/opt/libpq/bin/psql';

const env = Object.fromEntries(
  readFileSync('.env.staging.local', 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trimStart().startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    })
);

const url = env.STAGING_DATABASE_URL;
if (!url || env.STAGING_SUPABASE_REF === PRODUCTION_REF || url.includes(PRODUCTION_REF)) {
  console.error('REFUS : cible absente ou identique à la production.');
  process.exit(2);
}

const db = new DatabaseSync('data/local_db/cdmx_local.sqlite', { readOnly: true });

/** Les tableaux JSON sont stockés en texte dans SQLite ; jsonb les attend en JSON. */
const asJson = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.startsWith('[') || trimmed.startsWith('{') ? trimmed : JSON.stringify(value);
  }
  return JSON.stringify(value);
};
const asBool = (value) => (value === null ? null : value ? 't' : 'f');

/** Échappement TSV : \N pour NULL, et les caractères de contrôle protégés. */
const cell = (value) =>
  value === null || value === undefined
    ? '\\N'
    : String(value).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n');

function load(table, columns, rows, transform) {
  const path = join(tmpdir(), `tdd-${table}.tsv`);
  writeFileSync(path, rows.map((row) => transform(row).map(cell).join('\t')).join('\n') + '\n');
  execFileSync(PSQL, [
    url, '-v', 'ON_ERROR_STOP=1', '-q',
    '-c', `truncate table public.${table} cascade;`,
    '-c', `\\copy public.${table} (${columns.join(',')}) from '${path}' with (format text, null '\\N')`,
  ], { stdio: ['ignore', 'ignore', 'inherit'] });
  unlinkSync(path);
  console.log(`  ${table.padEnd(28)} ${rows.length} lignes`);
}

console.log('Chargement du catalogue brut dans le staging…');

const restaurantColumns = [
  'id', 'name', 'colonia', 'alcaldia', 'address', 'lat', 'lng', 'phone', 'website', 'instagram',
  'rating', 'review_count', 'price_level', 'photo_ref', 'photo_refs', 'photo_count', 'summary',
  'hours', 'google_maps_uri', 'business_status', 'cuisine_key', 'michelin_cuisine',
  'opentable_cuisine', 'michelin_distinction', 'michelin_stars', 'bib_gourmand', 'michelin_url',
  'in_worlds_50_best', 'w50_rank', 'w50_list', 'opentable_url', 'score', 'rank_overall',
  'is_enriched', 'has_photo',
];

load(
  'restaurant_search_mv',
  restaurantColumns,
  db.prepare(`select ${restaurantColumns.join(',')} from restaurant_search_mv`).all(),
  (r) => [
    r.id, r.name, r.colonia, r.alcaldia, r.address, r.lat, r.lng, r.phone, r.website, r.instagram,
    r.rating, r.review_count, r.price_level, r.photo_ref, asJson(r.photo_refs), r.photo_count ?? 0,
    r.summary, asJson(r.hours), r.google_maps_uri, r.business_status, r.cuisine_key,
    r.michelin_cuisine, r.opentable_cuisine, r.michelin_distinction, r.michelin_stars ?? 0,
    asBool(r.bib_gourmand ?? 0), r.michelin_url, asBool(r.in_worlds_50_best ?? 0), r.w50_rank,
    r.w50_list, r.opentable_url, r.score, r.rank_overall,
    asBool(r.is_enriched ?? 0), asBool(r.has_photo ?? 0),
  ]
);

const menuColumns = ['id', 'restaurant_id', 'menu_document_id', 'nom', 'description', 'prix', 'devise', 'categorie'];
load(
  'menu_items',
  menuColumns,
  db.prepare(`select ${menuColumns.join(',')} from menu_items`).all(),
  (r) => [r.id, r.restaurant_id, r.menu_document_id, r.nom, r.description, r.prix, r.devise, r.categorie]
);

const extractedColumns = ['id', 'restaurant_id', 'nom', 'prix', 'devise'];
load(
  'menu_items_local_extracted',
  extractedColumns,
  db.prepare(`select ${extractedColumns.join(',')} from menu_items_local_extracted`).all(),
  (r) => [r.id, r.restaurant_id, r.nom, r.prix, r.devise]
);

console.log('Terminé.');
