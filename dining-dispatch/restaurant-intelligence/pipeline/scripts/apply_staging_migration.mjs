#!/usr/bin/env node
//
// Applique un fichier de migration au projet Supabase de STAGING, et à lui
// seul.
//
// Ce dépôt n'a volontairement plus de projet lié pour la CLI Supabase : une
// commande de migration ne doit jamais avoir de cible par défaut. Cet outil
// remplace ce défaut par une cible explicite, vérifiée deux fois — la référence
// attendue du staging doit correspondre, et la référence de production est
// refusée en toutes lettres.
//
// Usage :
//   node scripts/apply_staging_migration.mjs supabase/migrations/<fichier>.sql

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import pg from 'pg';

const PRODUCTION_REF = 'enknwdpjjkpjvhjkubju';
const ENV_PATH = '.env.staging.local';

function fail(message) {
  console.error(`\nMigration non appliquée : ${message}\n`);
  process.exit(1);
}

const [, , migrationPath] = process.argv;
if (!migrationPath) fail('indiquer le chemin du fichier de migration.');
if (!existsSync(migrationPath)) fail(`${migrationPath} est introuvable.`);

if (!existsSync(ENV_PATH)) fail(`${ENV_PATH} est absent.`);
const env = {};
for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
  if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
  const index = line.indexOf('=');
  env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
}

const connectionString = env.STAGING_DATABASE_URL;
const expectedRef = env.STAGING_SUPABASE_REF;
if (!connectionString || !expectedRef) {
  fail(`${ENV_PATH} doit définir STAGING_DATABASE_URL et STAGING_SUPABASE_REF.`);
}
if (expectedRef === PRODUCTION_REF) {
  fail(`STAGING_SUPABASE_REF vaut la référence de production (${PRODUCTION_REF}).`);
}

// La référence du projet apparaît soit dans le nom d'utilisateur du pooler
// (postgres.<ref>), soit dans le nom d'hôte d'une connexion directe.
const target = new URL(connectionString);
const haystack = `${decodeURIComponent(target.username)}@${target.hostname}`;
if (haystack.includes(PRODUCTION_REF)) {
  fail(`STAGING_DATABASE_URL désigne la production (${PRODUCTION_REF}). Refus.`);
}
if (!haystack.includes(expectedRef)) {
  fail(
    `STAGING_DATABASE_URL ne désigne pas le projet ${expectedRef} annoncé par STAGING_SUPABASE_REF.\n` +
    `Une cible ambiguë est exactement ce que cet outil existe pour empêcher.`,
  );
}

const sql = readFileSync(migrationPath, 'utf8');
const name = basename(migrationPath);
const version = (name.match(/^(\d+)_/) || [])[1] || null;

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();

  const { rows } = await client.query('select current_database() as db, inet_server_addr() as host');
  console.log(`Cible  : projet ${expectedRef} (base ${rows[0].db})`);
  console.log(`Fichier: ${name}`);

  // Tout ou rien : une migration à moitié appliquée laisserait le schéma dans
  // un état que ni les tests ni le fichier ne décrivent.
  await client.query('begin');
  await client.query(sql);

  // Le staging a été reconstruit à la main, sans la CLI : la table
  // d'historique n'existe pas forcément. On l'alimente si elle est là, sans
  // la créer — inventer un historique partiel serait pire que pas d'historique.
  const ledger = await client.query(
    `select to_regclass('supabase_migrations.schema_migrations') is not null as present`,
  );
  const tracked = Boolean(version && ledger.rows[0].present);
  if (tracked) {
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name)
       values ($1, $2)
       on conflict (version) do nothing`,
      [version, name.replace(/^\d+_/, '').replace(/\.sql$/, '')],
    );
  }

  await client.query('commit');
  console.log(
    tracked
      ? '\nAppliquée et enregistrée dans l\'historique des migrations.'
      : '\nAppliquée. Historique CLI absent de ce projet : le suivi reste le dossier supabase/migrations/.',
  );
} catch (error) {
  await client.query('rollback').catch(() => {});
  fail(error.message);
} finally {
  await client.end().catch(() => {});
}
