#!/usr/bin/env node
/*
 * Vérification de la frontière du catalogue public (Phase 1B).
 *
 * À exécuter contre une BRANCHE Supabase, jamais contre la production.
 * Le script refuse de tourner sur la référence de production.
 *
 *   node scripts/verify_catalogue_boundary.mjs \
 *     --ref <branch_ref> --anon <publishable_key> --secret <service_key>
 *
 * La clé secrète sert uniquement à poser puis retirer un enregistrement témoin
 * (fixture) : elle n'est jamais utilisée pour prouver un accès public.
 */

const PRODUCTION_REF = 'enknwdpjjkpjvhjkubju';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
    return pairs;
  }, [])
);

const { ref, anon, secret } = args;
if (!ref || !anon || !secret) {
  console.error('usage: --ref <branch_ref> --anon <key> --secret <key>');
  process.exit(2);
}
if (ref === PRODUCTION_REF) {
  console.error('REFUS : cette référence est la production. Utilisez une branche.');
  process.exit(2);
}

const base = `https://${ref}.supabase.co`;
const asAnon = { apikey: anon, Authorization: `Bearer ${anon}` };
const asAdmin = { apikey: secret, Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };

let passed = 0;
let failed = 0;

function check(id, label, ok, detail) {
  const mark = ok ? 'OK  ' : 'ECHEC';
  console.log(`  ${mark} ${String(id).padStart(2)}. ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

const get = (path, headers) => fetch(`${base}/rest/v1/${path}`, { headers });

/** Un refus d'autorisation PostgREST : 401 (pas de droit) ou 404 (objet masqué). */
const isDenied = (status) => status === 401 || status === 403 || status === 404;

async function main() {
  console.log(`\nBranche : ${ref}\n`);

  // --- Fixtures : un publié conforme, un candidat, un rejeté.
  console.log('Préparation des fixtures (clé secrète)…');
  const pool = await (await get(
    'catalogue_membership?select=restaurant_id&status=eq.candidate&limit=3', asAdmin
  )).json();
  if (!Array.isArray(pool) || pool.length < 3) {
    console.error('  Impossible de lire 3 candidats. La migration 1/3 a-t-elle tourné ?');
    process.exit(1);
  }
  const [publishedId, candidateId, rejectedId] = pool.map((row) => row.restaurant_id);

  // Relecteur : le script crée le sien. Un staging vierge n'a aucun profil, et
  // dépendre d'une donnée préexistante rendrait la vérification non
  // reproductible. Le déclencheur `handle_new_user` crée le profil associé.
  const reviewerEmail = `phase1b-verifier-${Date.now()}@example.invalid`;
  const created = await fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    headers: asAdmin,
    body: JSON.stringify({
      email: reviewerEmail,
      password: `verif-${Math.random().toString(36).slice(2)}-Aa1!`,
      email_confirm: true,
      user_metadata: { username: `verifier${Date.now().toString().slice(-6)}` },
    }),
  });
  if (!created.ok) {
    console.error(`  Création du relecteur impossible (HTTP ${created.status}).`);
    process.exit(1);
  }
  const reviewer = (await created.json()).id;
  console.log('  relecteur temporaire créé');

  const patch = (id, body) => fetch(`${base}/rest/v1/catalogue_membership?restaurant_id=eq.${id}`, {
    method: 'PATCH', headers: { ...asAdmin, Prefer: 'return=representation' }, body: JSON.stringify(body),
  });

  // Le publié reçoit une correction de coordonnées, pour tester l'override.
  const OVERRIDE = { lat: 19.4326, lng: -99.1332 };
  await patch(publishedId, {
    status: 'published', coordinate_state: 'corrected',
    identity_state: 'verified',
    lat_override: OVERRIDE.lat, lng_override: OVERRIDE.lng,
    reviewed_by: reviewer, reviewed_at: new Date().toISOString(),
    qa_note: 'fixture de vérification',
  });
  await patch(rejectedId, { status: 'rejected', qa_note: 'fixture de vérification' });

  console.log('\nTests :');

  // 1-2. Sources brutes fermées à anon.
  check(1, 'anon ne lit pas restaurant_search_mv',
    isDenied((await get('restaurant_search_mv?select=id&limit=1', asAnon)).status));
  check(2, 'anon ne lit pas menu_items',
    isDenied((await get('menu_items?select=nom&limit=1', asAnon)).status));

  // 3. Catalogue public lisible et limité aux publiés conformes.
  const publicRows = await get('public_catalogue?select=id,lat,lng&limit=100', asAnon);
  const rows = publicRows.ok ? await publicRows.json() : [];
  check(3, 'anon lit public_catalogue', publicRows.status === 200, `${rows.length} ligne(s)`);

  // 4. Gouvernance privée.
  check(4, 'anon ne lit pas catalogue_membership',
    isDenied((await get('catalogue_membership?select=restaurant_id&limit=1', asAnon)).status));

  // 5. La recherche ne renvoie que du publié.
  const named = await (await fetch(`${base}/rest/v1/rpc/search_restaurants`, {
    method: 'POST', headers: { ...asAnon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ search_query: '', max_results: 50 }),
  })).json();
  const searchIds = new Set((Array.isArray(named) ? named : []).map((r) => r.id));
  check(5, 'search_restaurants contient le publié', searchIds.has(publishedId));

  // 6. Aucun candidat ni rejeté ne fuit.
  check(6, 'search_restaurants n\'expose ni candidat ni rejeté',
    !searchIds.has(candidateId) && !searchIds.has(rejectedId));

  // 7. L'override de coordonnées est bien servi.
  const fixture = rows.find((r) => r.id === publishedId);
  check(7, 'la correction de coordonnées prime sur le pipeline',
    fixture && Math.abs(fixture.lat - OVERRIDE.lat) < 1e-9 && Math.abs(fixture.lng - OVERRIDE.lng) < 1e-9,
    fixture ? `${fixture.lat}, ${fixture.lng}` : 'fixture absente');

  // 8. Un rejet disparaît de toutes les surfaces publiques.
  const rejectedVisible = rows.some((r) => r.id === rejectedId);
  const rejectedMenu = await get(`public_menu_items?select=nom&restaurant_id=eq.${rejectedId}`, asAnon);
  const rejectedMenuRows = rejectedMenu.ok ? await rejectedMenu.json() : [];
  check(8, 'un rejeté sort de la vue, de la recherche et des menus',
    !rejectedVisible && rejectedMenuRows.length === 0);

  // 9. Le ré-import du catalogue préserve adhésion et corrections.
  //    `restaurant_search_mv` est une TABLE alimentée en upsert (pas une
  //    matview) : on simule un upsert sur la ligne publiée.
  const before = await (await get(`restaurant_search_mv?select=name&id=eq.${publishedId}`, asAdmin)).json();
  await fetch(`${base}/rest/v1/restaurant_search_mv?id=eq.${publishedId}`, {
    method: 'PATCH', headers: asAdmin, body: JSON.stringify({ name: before[0].name }),
  });
  const afterRows = await (await get(`public_catalogue?select=id,lat&id=eq.${publishedId}`, asAnon)).json();
  check(9, 'un ré-import préserve adhésion et correction',
    afterRows.length === 1 && Math.abs(afterRows[0].lat - OVERRIDE.lat) < 1e-9);

  // 10. La base refuse elle-même une publication non relue.
  const badPublish = await patch(candidateId, { status: 'published' });
  check(10, 'la base rejette un published sans relecture', badPublish.status >= 400,
    `HTTP ${badPublish.status}`);

  // 11. Les menus d'un publié sont accessibles.
  const menu = await get(`public_menu_items?select=nom&restaurant_id=eq.${publishedId}&limit=1`, asAnon);
  check(11, 'les menus d\'un publié restent lisibles', menu.status === 200);

  // 12-13. La saisie de l'utilisateur est du texte, pas un motif ILIKE.
  //        `%` renverrait tout le catalogue publié, `_` n'importe quel
  //        caractère : une recherche qui ment sur ce qu'elle a trouvé.
  const search = async (query) => {
    const response = await fetch(`${base}/rest/v1/rpc/search_restaurants`, {
      method: 'POST', headers: { ...asAnon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ search_query: query, max_results: 50 }),
    });
    const payload = await response.json().catch(() => []);
    return Array.isArray(payload) ? payload : [];
  };

  const wildcard = await search('%');
  check(12, 'le joker % ne ramène pas le catalogue', wildcard.length === 0,
    `${wildcard.length} ligne(s)`);

  const underscore = await search('_');
  check(13, 'le joker _ ne remplace pas un caractère', underscore.length === 0,
    `${underscore.length} ligne(s)`);

  // --- Nettoyage : fixtures rendues à l'état candidat, relecteur supprimé.
  console.log('\nNettoyage des fixtures…');
  for (const id of [publishedId, rejectedId]) {
    await patch(id, {
      status: 'candidate', coordinate_state: 'unreviewed',
      identity_state: 'unreviewed',
      lat_override: null, lng_override: null,
      reviewed_by: null, reviewed_at: null, qa_note: null,
    });
  }
  await fetch(`${base}/auth/v1/admin/users/${reviewer}`, { method: 'DELETE', headers: asAdmin });

  const leftover = await (await get('catalogue_membership?select=status', asAdmin)).json();
  const remaining = leftover.filter((row) => row.status !== 'candidate').length;
  console.log(`  ${remaining === 0 ? 'aucune fixture résiduelle' : `ATTENTION : ${remaining} ligne(s) non nettoyée(s)`}`);

  console.log(`\nRésultat : ${passed} réussis, ${failed} échoués\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
