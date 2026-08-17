#!/usr/bin/env node

import { DatabaseSync } from 'node:sqlite';
import process from 'node:process';

const dbPath = process.env.LOCAL_DB_PATH ?? 'data/local_db/cdmx_local.sqlite';
const supabaseUrl = process.env.TARGET_SUPABASE_URL;
const serviceKey = process.env.TARGET_SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error('TARGET_SUPABASE_URL and TARGET_SUPABASE_SERVICE_KEY are required');
}

const db = new DatabaseSync(dbPath, { readOnly: true });
const BATCH_SIZE = 250;

function parseJson(value) {
  if (typeof value !== 'string' || value === '') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function restaurantRow(row) {
  return {
    ...row,
    photo_refs: parseJson(row.photo_refs),
    hours: parseJson(row.hours),
    bib_gourmand: Boolean(row.bib_gourmand),
    in_worlds_50_best: Boolean(row.in_worlds_50_best),
    is_enriched: Boolean(row.is_enriched),
    has_photo: Boolean(row.has_photo),
  };
}

function nullable(value) {
  return value === '' ? null : value;
}

async function upsert(table, rows) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    throw new Error(`${table}: ${response.status} ${await response.text()}`);
  }
}

async function importTable(table, selectSql, transform = (row) => row) {
  const total = Number(db.prepare(`select count(*) as count from ${table}`).get().count);
  const statement = db.prepare(`${selectSql} limit ? offset ?`);
  let imported = 0;
  while (imported < total) {
    const rows = statement.all(BATCH_SIZE, imported).map((row) => {
      const transformed = transform(row);
      return Object.fromEntries(Object.entries(transformed).map(([key, value]) => [key, nullable(value)]));
    });
    await upsert(table, rows);
    imported += rows.length;
    process.stdout.write(`\r${table}: ${Math.min(imported, total)}/${total}`);
  }
  process.stdout.write('\n');
}

try {
  await importTable('restaurant_search_mv', 'select * from restaurant_search_mv', restaurantRow);
  await importTable('menu_items', 'select * from menu_items');
  await importTable('menu_items_local_extracted', 'select * from menu_items_local_extracted');
} finally {
  db.close();
}
