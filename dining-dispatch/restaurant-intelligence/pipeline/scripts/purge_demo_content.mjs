#!/usr/bin/env node
//
// Supprime le contenu de démonstration du backend beta officiel.
//
// Les conversations artificielles servent à se projeter tant que la communauté
// est vide. Elles ne doivent jamais partir en beta externe : présentées comme
// de l'activité réelle, elles mentiraient à un utilisateur sur ce qu'il est en
// train de lire.
//
// Un compte de démonstration se reconnaît à sa colonne `is_demo`. Le marqueur
// était auparavant le préfixe `demo_` du pseudo ; renommer ces comptes pour
// qu'ils se lisent comme de vrais membres l'aurait effacé. `is_demo` survit à
// un renommage et n'est pas modifiable par un client.
//
// Par défaut le script ne supprime rien : il compte et affiche. La suppression
// exige `--confirm`.

import { readFileSync, existsSync } from 'node:fs';

// Backend officiel de l'application. Codé en dur volontairement : la garde n'a
// aucune valeur si la cible peut être redéfinie par la variable qu'elle
// vérifie.
const BETA_REF = 'myqikzsfrzhntekuayjh';
const LEGACY_REF = 'enknwdpjjkpjvhjkubju';
const ENV_PATH = '.env.staging.local';

const confirmed = process.argv.includes('--confirm');

function fail(message, remedy) {
  console.error(`\nPurge impossible : ${message}\n`);
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

/** Une clé anon ne verrait qu'un sous-ensemble filtré par la RLS : elle
 *  laisserait croire à une purge complète tout en laissant des lignes. */
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
    `${ENV_PATH} est absent — aucun identifiant du backend beta n'est disponible.`,
    [
      `Créer ${ENV_PATH} (ignoré par Git) avec :`,
      `  STAGING_SUPABASE_REF=${BETA_REF}`,
      `  STAGING_SUPABASE_URL=https://${BETA_REF}.supabase.co`,
      `  STAGING_SUPABASE_SERVICE_ROLE_KEY=<clé service_role du backend beta>`,
    ].join('\n'),
  );
}

const url = env.STAGING_SUPABASE_URL;
const key = env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  fail(`${ENV_PATH} doit définir STAGING_SUPABASE_URL et STAGING_SUPABASE_SERVICE_ROLE_KEY.`);
}

const ref = refOf(url);
if (ref === LEGACY_REF) {
  fail(`${url} est l'archive héritée, pas le backend beta. Rien ne sera supprimé ici.`);
}
if (ref !== BETA_REF || env.STAGING_SUPABASE_REF !== BETA_REF) {
  fail(
    `la cible ${ref || '(inconnue)'} n'est pas le backend beta ${BETA_REF}.`,
    `Vérifier STAGING_SUPABASE_URL et STAGING_SUPABASE_REF dans ${ENV_PATH}.`,
  );
}
if (!looksLikeServiceRole(key)) {
  fail(
    `STAGING_SUPABASE_SERVICE_ROLE_KEY ne ressemble pas à une clé service_role.`,
    `Avec une clé publiable, la RLS masquerait des lignes et la purge semblerait complète sans l'être.`,
  );
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

async function rest(path, options = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} → ${response.status} ${await response.text()}`);
  }
  return response;
}

async function countRows(table, query) {
  const response = await rest(`${table}?${query}&select=*`, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  return Number((response.headers.get('content-range') || '/0').split('/')[1]) || 0;
}

// 1. Identifier les comptes de démonstration, et eux seuls.
const profilesResponse = await rest(
  `profiles?select=id,username,is_demo&is_demo=is.true&order=username.asc`,
);
const demoProfiles = await profilesResponse.json();

// Le filtre serveur pourrait être ignoré silencieusement si la colonne
// disparaissait : on revérifie le drapeau ligne par ligne avant de supprimer.
const confirmedDemo = demoProfiles.filter((profile) => profile.is_demo === true);
if (confirmedDemo.length !== demoProfiles.length) {
  fail(
    `${demoProfiles.length - confirmedDemo.length} profil(s) renvoyé(s) ne portent pas is_demo.`,
    `Le filtre serveur et la vérification locale divergent : rien n'est supprimé.`,
  );
}

if (confirmedDemo.length === 0) {
  console.log('\nAucun compte de démonstration. Rien à faire.\n');
  process.exit(0);
}

const ids = confirmedDemo.map((profile) => profile.id);
const idFilter = `author_id=in.(${ids.join(',')})`;

const dispatches = await countRows('dispatches', idFilter);
const reactions = await countRows('reactions', `user_id=in.(${ids.join(',')})`);
const totalDispatches = await countRows('dispatches', 'id=not.is.null');

console.log(`\nCible   : ${BETA_REF}`);
console.log(`Comptes : ${confirmedDemo.length} (${confirmedDemo.slice(0, 6).map((p) => p.username).join(', ')}${confirmedDemo.length > 6 ? '…' : ''})`);
console.log(`À supprimer : ${dispatches} publication(s)/réponse(s), ${reactions} réaction(s)`);
console.log(`Le reste de la communauté : ${totalDispatches - dispatches} contribution(s) réelle(s), intactes.`);

if (!confirmed) {
  console.log(`\nRien n'a été supprimé. Relancer avec --confirm pour appliquer :`);
  console.log(`  npm run demo:purge -- --confirm\n`);
  console.log(`Faire une sauvegarde d'abord : npm run backup:community\n`);
  process.exit(0);
}

// 2. Supprimer les profils. `dispatches.author_id` et `reactions.user_id`
//    référencent `profiles` en ON DELETE CASCADE ; les réponses, mentions,
//    topics et signalements suivent par les cascades déjà en place.
console.log(`\nSuppression…`);
await rest(`profiles?id=in.(${ids.join(',')})`, {
  method: 'DELETE',
  headers: { Prefer: 'return=minimal' },
});

// 3. Supprimer les comptes d'authentification correspondants. `profiles.id`
//    référence `auth.users` : sans cette étape, les comptes survivraient à
//    leurs profils et pourraient se reconnecter.
let authDeleted = 0;
for (const profile of confirmedDemo) {
  const response = await fetch(`${url}/auth/v1/admin/users/${profile.id}`, {
    method: 'DELETE',
    headers,
  });
  if (response.ok) authDeleted += 1;
  else if (response.status !== 404) {
    console.warn(`  compte auth ${profile.username} : ${response.status}`);
  }
}

// 4. Vérifier plutôt que supposer.
const remainingProfiles = await countRows('profiles', 'is_demo=is.true');
const remainingDispatches = await countRows('dispatches', idFilter);
const survivors = await countRows('dispatches', 'id=not.is.null');

console.log(`\nProfils de démonstration restants   : ${remainingProfiles}`);
console.log(`Contributions de démonstration restantes : ${remainingDispatches}`);
console.log(`Comptes d'authentification supprimés : ${authDeleted}/${confirmedDemo.length}`);
console.log(`Contributions réelles conservées    : ${survivors}`);

if (remainingProfiles > 0 || remainingDispatches > 0) {
  fail(`la purge est incomplète — ${remainingProfiles} profil(s) et ${remainingDispatches} contribution(s) subsistent.`);
}

console.log(`\nPurge terminée.\n`);
