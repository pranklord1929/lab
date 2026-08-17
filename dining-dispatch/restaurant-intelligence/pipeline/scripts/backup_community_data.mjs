#!/usr/bin/env node
//
// Sauvegarde locale du contenu communautaire du backend beta officiel.
//
// Le corpus de restaurants est reconstructible : il vient de l'ingestion et il
// existe un instantané SQLite local. Les profils, dispatches et réactions ne le
// sont pas — ils ont été écrits par des personnes réelles et n'existent que
// dans Supabase, sur un plan gratuit sans sauvegarde gérée. C'est la seule
// donnée du projet dont la perte serait définitive.
//
// Strictement en lecture : uniquement des GET PostgREST. Le script n'écrit
// jamais dans Supabase et ne détient aucun moyen de le faire.

import { readFileSync, mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Backend officiel de l'application. Codé en dur volontairement : la garde
// n'a aucune valeur si la cible peut être redéfinie par la variable qu'elle
// vérifie.
const BETA_REF = 'myqikzsfrzhntekuayjh';
const LEGACY_REF = 'enknwdpjjkpjvhjkubju';

// Le nom est historique : ce fichier configure désormais le backend beta
// officiel. Le renommer demanderait de modifier tous les outils opérateur.
const ENV_PATH = '.env.staging.local';
const OUTPUT_ROOT = 'backups/community';
const PAGE_SIZE = 1000;

// `orderBy` reprend la clé primaire de chaque table. Deux raisons : la
// pagination par `Range` n'est fiable que sur un ordre total et déterministe
// — sans lui, deux pages peuvent répéter ou sauter des lignes ; et
// `dispatch_topics` comme `reactions` sont des tables d'association sans
// colonne `id`, où trier par `id` renvoie une erreur 42703.
const TABLES = [
  { name: 'profiles', optional: false, orderBy: 'id.asc' },
  { name: 'dispatches', optional: false, orderBy: 'id.asc' },
  { name: 'dispatch_topics', optional: false, orderBy: 'dispatch_id.asc,topic.asc' },
  { name: 'reactions', optional: false, orderBy: 'dispatch_id.asc,user_id.asc,type.asc' },
  { name: 'dispatch_reports', optional: true, orderBy: 'id.asc' },
];

function fail(message, remedy) {
  console.error(`\nSauvegarde impossible : ${message}\n`);
  if (remedy) console.error(`${remedy}\n`);
  process.exit(1);
}

function readEnvFile(path) {
  if (!existsSync(path)) return null;
  const values = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
    const index = line.indexOf('=');
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}

function refOf(url) {
  return (String(url || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[1] || '';
}

/**
 * Une clé publiable/anon renverrait un sous-ensemble filtré par la RLS : une
 * sauvegarde incomplète qui ressemble à une sauvegarde complète est pire que
 * pas de sauvegarde du tout. On refuse plutôt que de deviner.
 */
function looksLikeServiceRole(key) {
  if (!key) return false;
  if (key.startsWith('sb_publishable_')) return false;
  if (key.startsWith('sb_secret_')) return true;
  const [, payload] = key.split('.');
  if (!payload) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims.role === 'service_role';
  } catch {
    return false;
  }
}

const env = readEnvFile(ENV_PATH);
if (!env) {
  fail(
    `${ENV_PATH} est absent — aucun identifiant du backend beta n'est disponible localement.`,
    [
      `Une clé publiable est filtrée par la RLS et ne peut pas produire une`,
      `sauvegarde fidèle.`,
      ``,
      `Pour activer la commande, créer ${ENV_PATH} (ignoré par Git) avec :`,
      `  STAGING_SUPABASE_REF=${BETA_REF}`,
      `  STAGING_SUPABASE_URL=https://${BETA_REF}.supabase.co`,
      `  STAGING_SUPABASE_SERVICE_ROLE_KEY=<clé service_role du backend beta>`,
      ``,
      `La clé se récupère dans Supabase > Project Settings > API. Ne jamais la coller`,
      `dans un fichier suivi par Git, ni dans le code de l'app.`,
    ].join('\n'),
  );
}

const url = env.STAGING_SUPABASE_URL;
const key = env.STAGING_SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  fail(`${ENV_PATH} doit définir STAGING_SUPABASE_URL et STAGING_SUPABASE_SERVICE_ROLE_KEY.`);
}

const ref = refOf(url);
if (ref !== BETA_REF || env.STAGING_SUPABASE_REF !== BETA_REF) {
  fail(
    `la configuration pointe sur « ${ref || url} », pas sur le backend beta attendu.`,
    `Cette commande ne sauvegarde que ${BETA_REF}.`,
  );
}

if (ref === LEGACY_REF) {
  fail(
    `la configuration désigne le projet historique ${LEGACY_REF}.`,
    `Le backend historique est une archive et ne doit plus recevoir les opérations courantes.`,
  );
}

if (!looksLikeServiceRole(key)) {
  fail(
    `STAGING_SUPABASE_SERVICE_ROLE_KEY n'est pas une clé service_role.`,
    `Une clé anon/publiable est filtrée par la RLS : la sauvegarde serait silencieusement incomplète.`,
  );
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

/** Uniquement des GET. Aucun autre verbe HTTP n'est utilisé par ce script. */
async function fetchPage(table, orderBy, from, to) {
  const response = await fetch(
    `${url}/rest/v1/${table}?select=*&order=${encodeURIComponent(orderBy)}`,
    {
      method: 'GET',
      headers: { ...headers, Range: `${from}-${to}`, Prefer: 'count=exact' },
    },
  );
  return response;
}

async function dumpTable({ name, optional, orderBy }) {
  const rows = [];
  let from = 0;
  let total = null;

  for (;;) {
    const response = await fetchPage(name, orderBy, from, from + PAGE_SIZE - 1);

    if (response.status === 404 && optional) {
      return { table: name, present: false, rows: null, count: 0 };
    }
    if (!response.ok && response.status !== 206) {
      const detail = await response.text().catch(() => '');
      throw new Error(`${name}: HTTP ${response.status} ${detail.slice(0, 200)}`);
    }

    const page = await response.json();
    rows.push(...page);

    const range = response.headers.get('content-range') || '';
    total = Number(range.split('/')[1]);
    if (page.length < PAGE_SIZE || rows.length >= (Number.isFinite(total) ? total : 0)) break;
    from += PAGE_SIZE;
  }

  return { table: name, present: true, rows, count: rows.length };
}

async function main() {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const directory = join(OUTPUT_ROOT, stamp);

  // 0700 : l'instantané contient les e-mails et les écrits des membres. Il ne
  // doit pas être lisible par les autres comptes de la machine.
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  const entries = [];
  for (const table of TABLES) {
    const result = await dumpTable(table);

    if (!result.present) {
      console.log(`  —     ${table.name} : absente du backend beta`);
      entries.push({ table: table.name, present: false, rows: 0, file: null, sha256: null });
      continue;
    }

    const file = `${table.name}.json`;
    const body = `${JSON.stringify(result.rows, null, 2)}\n`;
    const path = join(directory, file);
    writeFileSync(path, body, { mode: 0o600 });
    chmodSync(path, 0o600);

    console.log(`  OK    ${table.name} : ${result.count} ligne(s)`);
    entries.push({
      table: table.name,
      present: true,
      rows: result.count,
      file,
      sha256: createHash('sha256').update(body).digest('hex'),
    });
  }

  const manifest = {
    createdAt: startedAt.toISOString(),
    sourceProjectRef: ref,
    sourceKind: 'official-beta',
    readOnly: true,
    tool: 'scripts/backup_community_data.mjs',
    tables: entries,
  };
  const manifestPath = join(directory, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  chmodSync(manifestPath, 0o600);

  const latestPath = join(OUTPUT_ROOT, 'LATEST');
  writeFileSync(latestPath, `${stamp}\n`, { mode: 0o600 });
  chmodSync(latestPath, 0o600);

  const totalRows = entries.reduce((sum, entry) => sum + entry.rows, 0);
  console.log(`\nInstantané : ${directory} (${totalRows} ligne(s), permissions 0600)`);
}

main().catch((error) => fail(error.message));
