/**
 * Rafraîchit la vue matérialisée `restaurant_search_mv` qui alimente le front.
 *
 * À lancer après chaque `npm run ingest` ou script d'enrichissement, sinon le
 * site continue de servir l'ancien instantané.
 *
 *   npm run search:refresh
 *
 * Le REFRESH est CONCURRENTLY : les lecteurs ne sont jamais bloqués.
 * La fonction SQL est réservée au rôle `service_role` — un refresh coûte
 * plusieurs secondes de CPU, on ne l'expose pas à la clé publique.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const key = process.env.SUPABASE_SERVICE_KEY;
if (!process.env.SUPABASE_URL || !key) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_KEY sont requis.');
  process.exit(1);
}

/** Le rôle est encodé dans le JWT : on le lit pour donner une erreur utile. */
function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).role;
  } catch {
    return null;
  }
}

const role = jwtRole(key);
if (role && role !== 'service_role') {
  console.error(
    `SUPABASE_SERVICE_KEY contient une clé de rôle « ${role} », pas « service_role ».\n` +
      'Récupère la clé service_role dans Supabase → Settings → API, puis relance.'
  );
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, key);

const started = Date.now();
console.log('Rafraîchissement de restaurant_search_mv…');

const { error } = await supabase.rpc('refresh_restaurant_search');
if (error) {
  console.error('Échec :', error.message);
  process.exit(1);
}

const { count } = await supabase
  .from('restaurant_search_mv')
  .select('*', { count: 'exact', head: true })
  .eq('is_enriched', true);

console.log(`OK en ${((Date.now() - started) / 1000).toFixed(1)}s — ${count} fiches enrichies.`);
