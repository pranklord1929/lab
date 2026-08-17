#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.CATALOGUE_REVIEW_PORT || 4174);
const BATCH_SIZE = Number(process.env.CATALOGUE_REVIEW_BATCH_SIZE || 100);
const ENV_PATH = '.env.staging.local';
const PRODUCTION_REF = 'enknwdpjjkpjvhjkubju';

function loadEnv() {
  const values = {};
  for (const line of readFileSync(ENV_PATH, 'utf8').split('\n')) {
    if (!line.includes('=') || line.trimStart().startsWith('#')) continue;
    const index = line.indexOf('=');
    values[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return values;
}

const env = loadEnv();
if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY ||
    env.STAGING_SUPABASE_REF === PRODUCTION_REF || env.STAGING_SUPABASE_URL.includes(PRODUCTION_REF)) {
  throw new Error('Staging configuration is missing or points to production.');
}
if (!env.STAGING_CATALOGUE_REVIEWER_ID) {
  throw new Error('Run catalogue:reviewer-provision once before starting the review server.');
}

const apiHeaders = {
  apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
};

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${env.STAGING_SUPABASE_URL}${path}`, {
    method,
    headers: { ...apiHeaders, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Supabase request failed (${response.status}).`);
  return payload;
}

const reply = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

// Écouter sur la boucle locale ne suffit pas. N'importe quelle page ouverte
// dans le navigateur de l'opérateur peut viser http://127.0.0.1:4174, et une
// requête sortante emporte la clé service-role côté serveur : publier ou
// rejeter un restaurant à son insu ne demanderait qu'un onglet malveillant.
// Un domaine repointé sur 127.0.0.1 (DNS rebinding) permettrait en plus de
// lire la file de relecture.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`, `http://[::1]:${PORT}`]);

function originRefusal(req) {
  // Le Host est ce que le navigateur a réellement visé : un nom de domaine
  // rebindé n'est jamais « 127.0.0.1 ».
  if (!ALLOWED_HOSTS.has(req.headers.host || '')) return 'Unexpected Host header.';

  // Envoyé par tous les navigateurs actuels. `none` = barre d'adresse,
  // `same-origin` = la console elle-même. Tout le reste vient d'ailleurs.
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'Cross-site request refused.';

  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return 'Cross-origin request refused.';

  // Un formulaire HTML ne peut pas poser ce type sans déclencher un contrôle
  // préalable, auquel ce serveur ne répond pas. Une requête d'opérateur en
  // ligne de commande, elle, le pose sans difficulté.
  if (req.method !== 'GET') {
    const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') return 'Review actions require an application/json body.';
  }

  return null;
}

async function requestBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 24_000) throw new Error('Request body is too large.');
  }
  return raw ? JSON.parse(raw) : {};
}

function restaurant(row) {
  const raw = Array.isArray(row.restaurant_search_mv) ? row.restaurant_search_mv[0] : row.restaurant_search_mv;
  return { ...row, restaurant: raw || null };
}

async function queue() {
  const select = `restaurant_id,status,coordinate_state,identity_state,qa_note,lat_override,lng_override,
      restaurant_search_mv(id,name,colonia,alcaldia,address,lat,lng,phone,website,instagram,rating,review_count,
        price_level,summary,hours,google_maps_uri,cuisine_key,michelin_distinction,michelin_stars,bib_gourmand,
        in_worlds_50_best,w50_rank,photo_count,score,rank_overall)`.replace(/\s+/g, '');
  const data = await api(`/rest/v1/catalogue_membership?select=${encodeURIComponent(select)}&status=in.(candidate,needs_fix)&limit=900`);
  return (data || []).map(restaurant).filter((row) => row.restaurant).sort((a, b) => {
    const editorialWeight = (row) =>
      Number(row.restaurant.score || 0) +
      (Number(row.restaurant.michelin_stars || 0) * 1000) +
      (row.restaurant.bib_gourmand ? 600 : 0) +
      (row.restaurant.in_worlds_50_best ? 1200 : 0) +
      (row.status === 'needs_fix' ? 2000 : 0);
    const aPriority = editorialWeight(a);
    const bPriority = editorialWeight(b);
    if (aPriority !== bPriority) return bPriority - aPriority;
    return Number(b.restaurant.review_count || 0) - Number(a.restaurant.review_count || 0);
  }).slice(0, Math.min(Math.max(BATCH_SIZE, 1), 900));
}

async function history(restaurantId) {
  return api(`/rest/v1/catalogue_review_events?select=${encodeURIComponent('action,note,state_before,state_after,created_at,profiles(username)')}&restaurant_id=eq.${encodeURIComponent(restaurantId)}&order=created_at.desc`);
}

async function applyReview(body) {
  const allowed = new Set([
    'coordinate_verified', 'coordinate_corrected', 'coordinate_suspect',
    'identity_verified', 'identity_suspect', 'rejected', 'published',
  ]);
  if (!allowed.has(body.action) || typeof body.restaurantId !== 'string') {
    throw new Error('Invalid review action.');
  }
  return api('/rest/v1/rpc/apply_catalogue_review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
    p_restaurant_id: body.restaurantId,
    p_reviewer_id: env.STAGING_CATALOGUE_REVIEWER_ID,
    p_action: body.action,
    p_note: typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : null,
    p_lat: body.lat === '' || body.lat === undefined ? null : Number(body.lat),
    p_lng: body.lng === '' || body.lng === undefined ? null : Number(body.lng),
    },
  });
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dining Dispatch - Catalogue Review</title><style>
:root{color-scheme:light dark;--bg:#f5f2ea;--ink:#17201a;--muted:#667066;--line:#d8d4c8;--card:#fffdf7;--accent:#1e6847;--warn:#a76613;--danger:#a43832}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1100px;margin:auto;padding:24px 20px 64px}header{display:flex;gap:18px;align-items:baseline;justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:16px}h1{font:700 25px/1.1 Georgia,serif;margin:0}header p{margin:0;color:var(--muted)}.toolbar{display:flex;gap:8px;align-items:center;margin:18px 0}.toolbar button,.action{border:1px solid var(--line);background:var(--card);color:var(--ink);padding:9px 12px;border-radius:7px;font:inherit;cursor:pointer}.toolbar button:hover,.action:hover{border-color:var(--accent)}.count{margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums}.grid{display:grid;grid-template-columns:1.45fr .8fr;gap:16px}.panel{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:20px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}h2{font:700 30px/1.1 Georgia,serif;margin:7px 0}h3{margin:22px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted)}.address{color:var(--muted);margin:0}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:18px 0}.fact{border-top:1px solid var(--line);padding-top:8px}.fact b{display:block;font-size:12px;color:var(--muted);font-weight:500}.fact span{font-weight:600}.links{display:flex;gap:10px;flex-wrap:wrap}.links a{color:var(--accent);font-weight:600}.state{display:flex;gap:7px;flex-wrap:wrap}.pill{border:1px solid var(--line);border-radius:99px;padding:4px 8px;font-size:12px}.pill.ok{border-color:var(--accent);color:var(--accent)}.pill.warn{border-color:var(--warn);color:var(--warn)}label{display:block;font-size:13px;font-weight:650;margin:12px 0 5px}textarea,input{width:100%;font:inherit;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;padding:9px}.coords{display:grid;grid-template-columns:1fr 1fr;gap:8px}.actions{display:grid;gap:8px;margin-top:12px}.action{width:100%;text-align:left}.action.primary{background:var(--accent);border-color:var(--accent);color:white}.action.danger{color:var(--danger)}.action:disabled{opacity:.45;cursor:not-allowed}.history{margin:0;padding:0;list-style:none}.history li{border-top:1px solid var(--line);padding:10px 0;font-size:13px}.history time{display:block;color:var(--muted);font-size:12px}.empty{color:var(--muted);padding:38px 0;text-align:center}.notice{margin:14px 0;padding:10px 12px;border-left:3px solid var(--warn);background:#fff7e8;color:#6d4814}.hidden{display:none}@media(max-width:760px){main{padding:18px 14px}.grid{grid-template-columns:1fr}.facts{grid-template-columns:1fr 1fr}header{display:block}header p{margin-top:8px}}
</style></head><body><main><header><div><p class="eyebrow">Staging only · private reviewer</p><h1>Catalogue review</h1></div><p>Coordinates, identity, then publish.</p></header><div id="notice" class="notice hidden"></div><div class="toolbar"><button id="previous">Previous</button><button id="next">Next</button><button id="refresh">Refresh queue</button><span id="count" class="count"></span></div><div id="empty" class="empty">Loading review queue…</div><div id="content" class="grid hidden"><section class="panel"><div id="state" class="state"></div><h2 id="name"></h2><p id="address" class="address"></p><div id="facts" class="facts"></div><div id="links" class="links"></div><h3>Review note</h3><textarea id="note" rows="4" placeholder="What did you check? Record a concrete reason for corrections, doubts or rejection."></textarea><h3>Coordinate correction</h3><div class="coords"><input id="lat" inputmode="decimal" placeholder="Latitude"><input id="lng" inputmode="decimal" placeholder="Longitude"></div><div class="actions"><button class="action" data-action="coordinate_verified">Coordinates are correct</button><button class="action" data-action="coordinate_corrected">Save corrected coordinates</button><button class="action danger" data-action="coordinate_suspect">Coordinates need more work</button></div><h3>Identity and publication</h3><div class="actions"><button class="action" data-action="identity_verified">Restaurant identity is correct</button><button class="action danger" data-action="identity_suspect">Identity needs more work</button><button id="publish" class="action primary" data-action="published">Publish reviewed restaurant</button><button class="action danger" data-action="rejected">Reject from catalogue</button></div></section><aside class="panel"><h3>Review history</h3><ul id="history" class="history"></ul></aside></div></main><script>
let rows=[],index=0;const $=id=>document.getElementById(id);const note=()=>$('note').value;const showNotice=(message,error=false)=>{const n=$('notice');n.textContent=message;n.classList.remove('hidden');n.style.borderColor=error?'var(--danger)':'var(--warn)'};const esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
async function load(){const r=await fetch('/api/queue');const body=await r.json();if(!r.ok)throw new Error(body.error||'Unable to load queue');rows=body.rows;index=Math.min(index,Math.max(0,rows.length-1));render()}async function render(){const row=rows[index];$('count').textContent=rows.length?\`\${index+1} / \${rows.length} candidates\`:'No candidates';$('previous').disabled=index===0;$('next').disabled=index>=rows.length-1;if(!row){$('content').classList.add('hidden');$('empty').classList.remove('hidden');$('empty').textContent='No candidates need review.';return}$('empty').classList.add('hidden');$('content').classList.remove('hidden');const r=row.restaurant;$('name').textContent=r.name;$('address').textContent=[r.address,r.colonia,r.alcaldia].filter(Boolean).join(' · ');$('state').innerHTML=[row.status,row.coordinate_state,row.identity_state].map(s=>\`<span class="pill \${s==='verified'||s==='corrected'?'ok':s==='suspect'||s==='needs_fix'?'warn':''}">\${esc(s.replace('_',' '))}</span>\`).join('');$('facts').innerHTML=[['Rating',r.rating??'—'],['Reviews',r.review_count??'—'],['Cuisine',r.cuisine_key??'—'],['Hours',r.hours?'Known':'—'],['Michelin',r.michelin_stars||r.bib_gourmand||r.michelin_distinction?'Yes':'—'],['Photos',r.photo_count??'—']].map(([k,v])=>\`<div class="fact"><b>\${esc(k)}</b><span>\${esc(v)}</span></div>\`).join('');const map=\`https://www.google.com/maps/search/?api=1&query=\${encodeURIComponent((row.lat_override??r.lat)+','+(row.lng_override??r.lng))}\`;$('links').innerHTML=\`<a target="_blank" rel="noreferrer" href="\${map}">Open coordinates</a>\${r.google_maps_uri?\`<a target="_blank" rel="noreferrer" href="\${esc(r.google_maps_uri)}">Source map</a>\`:''}\${r.website?\`<a target="_blank" rel="noreferrer" href="\${esc(r.website)}">Website</a>\`:''}\`;$('lat').value=row.lat_override??r.lat??'';$('lng').value=row.lng_override??r.lng??'';$('note').value=row.qa_note??'';$('publish').disabled=!(['verified','corrected'].includes(row.coordinate_state)&&row.identity_state==='verified');const h=await fetch('/api/history?id='+encodeURIComponent(row.restaurant_id));const hist=await h.json();$('history').innerHTML=hist.length?hist.map(e=>\`<li><strong>\${esc(e.action.replaceAll('_',' '))}</strong><time>\${new Date(e.created_at).toLocaleString()}</time>\${e.note?\`<span>\${esc(e.note)}</span>\`:''}</li>\`).join(''):'<li>No review events yet.</li>'}
async function action(action){const row=rows[index];if(!row)return;try{const r=await fetch('/api/review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({restaurantId:row.restaurant_id,action,note:note(),lat:$('lat').value,lng:$('lng').value})});const body=await r.json();if(!r.ok)throw new Error(body.error||'Review failed');showNotice('Saved: '+action.replaceAll('_',' '));await load()}catch(error){showNotice(error.message,true)}}$('previous').onclick=()=>{index=Math.max(0,index-1);render()};$('next').onclick=()=>{index=Math.min(rows.length-1,index+1);render()};$('refresh').onclick=load;document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));load().catch(e=>showNotice(e.message,true));
</script></body></html>`;

createServer(async (req, res) => {
  try {
    const refusal = originRefusal(req);
    if (refusal) return reply(res, 403, { error: refusal });

    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/') return reply(res, 200, page, 'text/html');
    if (req.method === 'GET' && url.pathname === '/api/queue') return reply(res, 200, { rows: await queue() });
    if (req.method === 'GET' && url.pathname === '/api/history') {
      const id = url.searchParams.get('id');
      if (!id) return reply(res, 400, { error: 'Missing restaurant id.' });
      return reply(res, 200, await history(id));
    }
    if (req.method === 'POST' && url.pathname === '/api/review') return reply(res, 200, await applyReview(await requestBody(req)));
    return reply(res, 404, { error: 'Not found.' });
  } catch (error) {
    return reply(res, 400, { error: error.message || 'Unexpected review server error.' });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Catalogue review: http://127.0.0.1:${PORT}`));
