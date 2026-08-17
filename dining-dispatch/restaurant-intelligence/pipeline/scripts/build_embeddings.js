#!/usr/bin/env node
/**
 * Construit l'index sémantique du moteur « recherche par envie » du front web.
 *
 * Lit le snapshot local (data/local_db/cdmx_local.sqlite), vectorise chaque
 * plat et chaque fiche resto du périmètre enrichi via Ollama (bge-m3, local,
 * gratuit), et écrit le tout dans data/local_db/embeddings.sqlite — un fichier
 * SÉPARÉ du snapshot, car `npm run export:local` réécrit ce dernier.
 *
 * Incrémental : chaque document est haché ; un texte inchangé n'est pas
 * revectorisé. Relancer après chaque export:local suffit donc (quelques
 * secondes si rien n'a bougé).
 *
 * Usage : node scripts/build_embeddings.js
 *         OLLAMA_URL=http://localhost:11434 par défaut.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = path.join(ROOT, 'data', 'local_db', 'cdmx_local.sqlite');
const INDEX = path.join(ROOT, 'data', 'local_db', 'embeddings.sqlite');
const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const MODEL = 'bge-m3';
const BATCH = 64;

function sha(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Vecteurs normalisés → la similarité cosinus devient un simple produit scalaire. */
function normalize(vec) {
  let n = 0;
  for (const x of vec) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(vec, (x) => x / n);
}

async function embedBatch(texts) {
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`Ollama /api/embed: HTTP ${res.status} ${await res.text()}`);
  const { embeddings } = await res.json();
  return embeddings.map(normalize);
}

function collectDocs(snap) {
  const docs = [];

  // Périmètre recommandable = toutes les fiches enrichies. Les restos avec
  // menus profitent en plus de leurs documents plats ; les autres restent
  // découvrables par cuisine, quartier, distinctions et ambiance.
  const restos = snap
    .prepare(
      `SELECT id, name, cuisine_key, michelin_cuisine, opentable_cuisine, summary,
              colonia, alcaldia, michelin_distinction, in_worlds_50_best, price_level
       FROM restaurant_search_mv
       WHERE is_enriched = 1`
    )
    .all();
  const restoById = new Map(restos.map((r) => [r.id, r]));

  for (const r of restos) {
    const text = [
      r.name,
      r.cuisine_key?.replace(/_/g, ' '),
      r.michelin_cuisine,
      r.opentable_cuisine,
      r.michelin_distinction,
      r.in_worlds_50_best ? "World's 50 Best" : null,
      r.price_level === 1 ? 'économique, barato, petit budget' : null,
      r.price_level === 2 ? 'prix modéré, casual' : null,
      r.price_level === 3 ? 'haut de gamme, occasion spéciale' : null,
      r.price_level >= 4 ? 'gastronomique, luxe, fine dining' : null,
      r.colonia,
      r.alcaldia,
      r.summary,
    ]
      .filter(Boolean)
      .join('. ');
    docs.push({ id: `resto:${r.id}`, kind: 'resto', restaurant_id: r.id, text, payload: null });
  }

  // Plats : menu_items d'abord, menu_items_local_extracted en repli (mêmes règles
  // que le site). On n'indexe que les restos du périmètre enrichi.
  const dishes = snap
    .prepare(
      `SELECT id, restaurant_id, nom, description, prix, devise, categorie
       FROM menu_items WHERE restaurant_id IN (SELECT id FROM restaurant_search_mv WHERE is_enriched=1)`
    )
    .all();
  const covered = new Set(dishes.map((d) => d.restaurant_id));
  const fallback = snap
    .prepare(
      `SELECT id, restaurant_id, nom, NULL AS description, prix, devise, NULL AS categorie
       FROM menu_items_local_extracted
       WHERE restaurant_id IN (SELECT id FROM restaurant_search_mv WHERE is_enriched=1)`
    )
    .all()
    .filter((d) => !covered.has(d.restaurant_id));

  const seen = new Set();
  for (const d of [...dishes, ...fallback]) {
    const r = restoById.get(d.restaurant_id);
    if (!r) continue;
    const dupKey = `${d.restaurant_id}|${d.nom}|${d.prix}`; // doublons promo UberEats
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);

    // Le contexte resto (cuisine, quartier) entre dans le texte vectorisé pour
    // que « mole à Coyoacán » retrouve les plats du bon quartier.
    const text = [
      d.nom,
      d.description,
      d.categorie,
      r.cuisine_key?.replace(/_/g, ' '),
      r.name,
      r.colonia,
      r.alcaldia,
    ]
      .filter(Boolean)
      .join('. ');
    docs.push({
      id: `dish:${d.id}`,
      kind: 'dish',
      restaurant_id: d.restaurant_id,
      text,
      payload: JSON.stringify({ nom: d.nom, prix: d.prix, devise: d.devise }),
    });
  }
  return docs;
}

async function main() {
  const snap = new DatabaseSync(SNAPSHOT, { readOnly: true });
  const idx = new DatabaseSync(INDEX);
  idx.exec(`
    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      restaurant_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      payload TEXT,
      vec BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  idx.prepare(`INSERT OR REPLACE INTO meta VALUES ('model', ?)`).run(MODEL);

  const docs = collectDocs(snap);
  const known = new Map(
    idx.prepare('SELECT id, hash FROM docs').all().map((r) => [r.id, r.hash])
  );

  // Purge des documents disparus (resto passé « fermé », menu retiré…).
  const wanted = new Set(docs.map((d) => d.id));
  const stale = [...known.keys()].filter((id) => !wanted.has(id));
  const del = idx.prepare('DELETE FROM docs WHERE id = ?');
  for (const id of stale) del.run(id);

  const todo = docs.filter((d) => known.get(d.id) !== sha(d.text));
  console.log(
    `${docs.length} documents (${docs.filter((d) => d.kind === 'dish').length} plats, ` +
      `${docs.filter((d) => d.kind === 'resto').length} restos) — ` +
      `${todo.length} à vectoriser, ${stale.length} purgés`
  );

  const upsert = idx.prepare(
    'INSERT OR REPLACE INTO docs (id, kind, restaurant_id, hash, payload, vec) VALUES (?,?,?,?,?,?)'
  );
  const t0 = Date.now();
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const vecs = await embedBatch(batch.map((d) => d.text));
    idx.exec('BEGIN');
    batch.forEach((d, j) => {
      upsert.run(d.id, d.kind, d.restaurant_id, sha(d.text), d.payload, Buffer.from(vecs[j].buffer));
    });
    idx.exec('COMMIT');
    idx.prepare(`INSERT OR REPLACE INTO meta VALUES ('dim', ?)`).run(String(vecs[0].length));
    const done = Math.min(i + BATCH, todo.length);
    process.stdout.write(`\r${done}/${todo.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  if (todo.length) process.stdout.write('\n');
  console.log(`Index à jour : ${INDEX}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
