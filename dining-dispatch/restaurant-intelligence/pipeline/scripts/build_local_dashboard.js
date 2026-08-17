import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const ROOT = resolve('.')
const db = new DatabaseSync(resolve(ROOT, 'data/local_db/cdmx_local.sqlite'), { readOnly: true })
const output = resolve(ROOT, 'data/exports/dashboard.html')
const one = sql => db.prepare(sql).get()
const all = sql => db.prepare(sql).all()
const hasTable = name => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
const fmt = value => Number(value || 0).toLocaleString('en-GB')
const pct = (value, total) => total ? `${(100 * Number(value) / Number(total)).toFixed(1)}%` : '0%'
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const shortDate = value => value ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'

const totals = one(`SELECT
  (SELECT COUNT(*) FROM restaurants) restaurants,
  (SELECT COUNT(*) FROM source_records) source_records,
  (SELECT COUNT(*) FROM source_records WHERE matched_restaurant_id IS NOT NULL) matched,
  (SELECT COUNT(*) FROM restaurant_candidate_pool) candidates,
  (SELECT COUNT(*) FROM restaurant_field_conflicts WHERE resolution='open') open_conflicts`)
const coverage = one(`SELECT COUNT(*) total, SUM(phone IS NOT NULL) phone, SUM(website IS NOT NULL) website,
  SUM(instagram IS NOT NULL) instagram, SUM(opening_hours IS NOT NULL) hours, SUM(rating IS NOT NULL) rating,
  SUM(photo_count>0) photos, SUM(source_count>0) external FROM restaurant_golden_record`)
const top = one(`SELECT COUNT(*) total, SUM(has_phone) phone, SUM(has_website) website, SUM(has_instagram) instagram,
  SUM(has_hours) hours, SUM(has_rating) rating, SUM(has_photos) photos, SUM(has_quality_menu) menus,
  SUM(has_menu_items) menu_items, SUM(high_conflicts>0) conflicts FROM top500_enrichment_status`)
const premium = hasTable('premium_enrichment_queue') ? one(`SELECT COUNT(*) total, SUM(status='golden') golden,
  SUM(status='menu_ready') menu_ready, SUM(status='website_needed') website_needed FROM premium_enrichment_queue`) : {}
const sources = all(`SELECT source, COUNT(*) records, COUNT(DISTINCT source_id) identities,
  SUM(matched_restaurant_id IS NOT NULL) matched, MAX(scraped_at) latest
  FROM source_records GROUP BY source ORDER BY latest DESC`)

function tableCount(path, table) {
  try { const x = new DatabaseSync(resolve(ROOT, path), { readOnly: true }); const n = x.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n; x.close(); return n } catch { return 0 }
}
const embeddings = tableCount('data/local_db/embeddings.sqlite', 'docs')
const telegramEvents = tableCount('data/local_db/telegram_bot.sqlite', 'events')
const packageScripts = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts || {}
const commandCategory = name => name.startsWith('src:') ? 'scraping'
  : name.startsWith('menus:') || name.startsWith('links:') || name.startsWith('instagram:') || name.startsWith('web:') ? 'enrichment'
  : name.startsWith('audit') || name.startsWith('dedupe:') || name.startsWith('resolve:') || name.startsWith('fix:') ? 'quality'
  : name.startsWith('candidate') || name.startsWith('golden:') || name.startsWith('search:') || name.startsWith('enrichment:') ? 'pipeline'
  : name.startsWith('_legacy:') ? 'legacy' : 'operations'
const commandCards = Object.keys(packageScripts).filter(name => !name.startsWith('_legacy:')).map(name =>
  `<article class="command" data-command="${esc(name)}" data-category="${commandCategory(name)}"><div><span class="cmd-category">${commandCategory(name)}</span><strong>${esc(name)}</strong></div><button type="button" data-copy="npm run ${esc(name)}">copy</button><code>npm run ${esc(name)}</code></article>`
).join('')

function coverageRows(data, fields) {
  return fields.map(([key, label]) => {
    const value = Number(data[key] || 0), total = Number(data.total || 0), width = Math.min(100, 100 * value / Math.max(1, total))
    return `<div class="cov"><span>${esc(label)}</span><div class="bar"><i style="width:${width}%"></i></div><b>${fmt(value)}</b><small>${pct(value, total)}</small></div>`
  }).join('')
}

const generated = new Date().toLocaleString('en-GB', { timeZone: 'Europe/Paris' })
const sourceRows = sources.map(row => {
  const rate = 100 * Number(row.matched) / Math.max(1, Number(row.records))
  const tone = rate >= 80 ? 'good' : rate >= 40 ? 'warn' : 'low'
  return `<tr><td><span class="source-dot ${tone}"></span>${esc(row.source)}</td><td class="num">${fmt(row.records)}</td><td class="num">${fmt(row.matched)}</td><td><div class="mini"><i class="${tone}" style="width:${Math.min(100, rate)}%"></i></div></td><td class="num">${pct(row.matched,row.records)}</td><td class="date">${shortDate(row.latest)}</td></tr>`
}).join('')

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CDMX — Pipeline Control Room</title><style>
:root{--bg:#07110f;--panel:#0d1916;--panel2:#101e1a;--line:#203b33;--ink:#edf8f2;--muted:#82a69a;--green:#55f6a0;--mint:#a2ffd0;--blue:#6cb6ff;--amber:#ffc861;--red:#ff7575}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -10%,#17382b 0,transparent 35%),var(--bg);color:var(--ink);font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}main{max-width:1380px;margin:auto;padding:26px 22px 56px}header{display:flex;align-items:center;gap:14px;padding-bottom:18px;border-bottom:1px solid var(--line)}h1{font-size:19px;letter-spacing:-.03em;margin:0}h1 em{color:var(--green);font-style:normal}.eyebrow,.muted{color:var(--muted)}.live{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--muted);font-size:11px}.pulse{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 14px var(--green)}.hero{display:grid;grid-template-columns:1.2fr .8fr;gap:14px;margin-top:18px}.panel,.stat{background:linear-gradient(145deg,rgba(17,31,26,.96),rgba(9,19,16,.97));border:1px solid var(--line);border-radius:10px}.panel{padding:18px}.panel-title{display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.13em;margin-bottom:14px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.stat{padding:15px}.stat label{display:block;color:var(--muted);font-size:10px;text-transform:uppercase}.stat strong{display:block;color:var(--mint);font-size:25px;font-weight:550;margin:3px 0}.stat small{color:var(--muted)}.section{margin-top:14px}.two{display:grid;grid-template-columns:1.1fr .9fr;gap:14px}.architecture{overflow-x:auto;padding-bottom:4px}.arch-flow{display:grid;grid-template-columns:1fr 34px 1.1fr 34px 1.1fr 34px 1fr;align-items:stretch;min-width:900px}.node{border:1px solid var(--line);background:#0a1613;border-radius:8px;padding:13px}.node.active{border-color:#357458;box-shadow:inset 0 0 26px rgba(85,246,160,.04)}.node .icon{font-size:19px;margin-bottom:10px}.node h3{font-size:12px;margin:0 0 5px;color:var(--green)}.node p{font:11px/1.55 ui-monospace,monospace;color:var(--muted);margin:0}.arrow{display:flex;align-items:center;justify-content:center;color:#3f6b5b;font-size:18px}.branch{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:9px}.chip{border:1px solid var(--line);border-radius:6px;padding:7px;color:var(--muted);font-size:10px}.health-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.health{border:1px solid var(--line);border-radius:7px;padding:10px}.health span{display:flex;align-items:center;gap:7px;font-size:11px}.health i,.source-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--muted)}.health i.ok{background:var(--green);box-shadow:0 0 9px rgba(85,246,160,.6)}.health i.off{background:var(--red)}.health small{display:block;color:var(--muted);margin-top:5px}.cov{display:grid;grid-template-columns:135px 1fr 60px 50px;gap:9px;align-items:center;padding:6px 0;border-bottom:1px dotted var(--line)}.cov:last-child{border:0}.cov b,.cov small{text-align:right}.cov small{color:var(--muted)}.bar,.mini{height:7px;background:#172a24;border-radius:99px;overflow:hidden}.bar i,.mini i{display:block;height:100%;background:var(--green);border-radius:99px}.mini{width:100%;min-width:70px;height:5px}.mini i.good,.source-dot.good{background:var(--green)}.mini i.warn,.source-dot.warn{background:var(--amber)}.mini i.low,.source-dot.low{background:var(--red)}table{width:100%;border-collapse:collapse}th,td{padding:7px 8px;border-bottom:1px dotted var(--line);text-align:left}th{position:sticky;top:0;background:var(--panel);color:var(--muted);font-size:9px;text-transform:uppercase;letter-spacing:.08em}.num{text-align:right;font-variant-numeric:tabular-nums}.date{color:var(--muted);white-space:nowrap}.source-dot{margin-right:8px}.table-wrap{max-height:420px;overflow:auto}.funnel{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.step{flex:1;min-width:105px;border:1px solid var(--line);border-radius:7px;padding:10px}.step strong{display:block;color:var(--green);font-size:18px}.step span{color:var(--muted);font-size:10px}.chev{color:#466d5f}.callout{margin-top:12px;padding:10px 12px;border-left:2px solid var(--amber);background:#211c10;color:#d9c392;font-size:11px}.quick-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.recipe{position:relative;border:1px solid var(--line);border-radius:8px;background:#091512;padding:12px}.recipe h3{margin:0 0 5px;font-size:11px;color:var(--green)}.recipe p{margin:0 0 10px;color:var(--muted);font-size:10px;min-height:30px}.recipe pre{margin:0;padding:10px;background:#050c0a;border-radius:6px;color:var(--mint);font:10px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.recipe button,.command button{position:absolute;right:9px;top:9px;border:1px solid var(--line);border-radius:5px;background:#10231c;color:var(--muted);font:9px ui-monospace,monospace;padding:5px 8px;cursor:pointer}.recipe button:hover,.command button:hover{color:var(--green);border-color:#3b775e}.command-tools{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}.command-tools input,.command-tools select{background:#091512;border:1px solid var(--line);border-radius:6px;color:var(--ink);font:11px ui-monospace,monospace;padding:8px 10px}.command-tools input{flex:1;min-width:220px}.command-list{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;max-height:430px;overflow:auto}.command{position:relative;border:1px solid var(--line);border-radius:7px;padding:10px;background:#091512}.command strong{font-size:11px}.command code{display:block;color:var(--mint);margin-top:7px;font-size:10px}.cmd-category{color:var(--muted);font-size:8px;text-transform:uppercase;display:block}.command.hidden{display:none}footer{display:flex;justify-content:space-between;gap:20px;border-top:1px solid var(--line);margin-top:18px;padding-top:13px;color:var(--muted);font-size:10px}@media(max-width:900px){.hero,.two{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.health-grid{grid-template-columns:repeat(2,1fr)}.quick-grid,.command-list{grid-template-columns:1fr 1fr}}@media(max-width:560px){main{padding:18px 12px 40px}.stats{grid-template-columns:1fr 1fr}.stat strong{font-size:21px}.cov{grid-template-columns:105px 1fr 48px}.cov small{display:none}.eyebrow{display:none}.quick-grid,.command-list{grid-template-columns:1fr}footer{display:block}.live{margin-left:auto}}
</style></head><body><main>
<header><h1><em>CDMX</em> / CONTROL ROOM</h1><span class="eyebrow">scraping · data · AI concierge</span><div class="live"><span class="pulse"></span><span id="refresh">snapshot ${esc(generated)}</span></div></header>

<section class="stats section">
 <div class="stat"><label>Restaurants</label><strong>${fmt(totals.restaurants)}</strong><small>canonical foundation</small></div>
 <div class="stat"><label>Evidence collected</label><strong>${fmt(totals.source_records)}</strong><small>${pct(totals.matched,totals.source_records)} matched</small></div>
 <div class="stat"><label>AI corpus</label><strong>${fmt(embeddings)}</strong><small>bge-m3 vectors</small></div>
 <div class="stat"><label>Top 500 menus</label><strong>${fmt(top.menus)} / 500</strong><small>${pct(top.menus,top.total)} usable</small></div>
</section>

<section class="panel section"><div class="panel-title"><span>Product architecture — what we are building</span><span>100% local-first</span></div>
 <div class="architecture"><div class="arch-flow">
  <div class="node active"><div class="icon">◎</div><h3>01 · Collection</h3><p>22 sources<br>scrapers & crawlers<br>immutable raw data</p></div><div class="arrow">→</div>
  <div class="node active"><div class="icon">⌘</div><h3>02 · Data intelligence</h3><p>entity resolution<br>golden record<br>deduplication + QA</p><div class="branch"><span class="chip">SQLite<br>${fmt(totals.restaurants)} records</span><span class="chip">Top 500<br>${fmt(top.menus)} menus</span></div></div><div class="arrow">→</div>
  <div class="node active"><div class="icon">✦</div><h3>03 · AI search</h3><p>bge-m3 · embeddings<br>deterministic retrieval<br>${fmt(embeddings)} vectors</p><div class="branch"><span class="chip">Ollama<br>local</span><span class="chip">Qwen3 8B<br>copywriting</span></div></div><div class="arrow">→</div>
  <div class="node active"><div class="icon">➤</div><h3>04 · Experiences</h3><p>trilingual concierge<br>sourced shortlists<br>real dishes + prices</p><div class="branch"><span class="chip">Telegram<br>@conciergeCDMXbot</span><span class="chip">Web<br>Next.js</span></div></div>
 </div></div>
 <div class="health-grid" style="margin-top:12px">
  <div class="health"><span><i id="h-dashboard"></i>Dashboard</span><small id="d-dashboard">checking…</small></div>
  <div class="health"><span><i id="h-web"></i>Concierge web</span><small id="d-web">localhost:3000</small></div>
  <div class="health"><span><i id="h-ollama"></i>Ollama + Qwen</span><small id="d-ollama">localhost:11434</small></div>
  <div class="health"><span><i id="h-telegram"></i>Telegram</span><small id="d-telegram">${fmt(telegramEvents)} events recorded</small></div>
 </div>
</section>

<section class="two section">
 <div class="panel"><div class="panel-title"><span>Scraping progress by source</span><span>${sources.length} sources ingested</span></div><div class="table-wrap"><table><thead><tr><th>Source</th><th class="num">Records</th><th class="num">Matched</th><th>Coverage</th><th class="num">Rate</th><th>Last run</th></tr></thead><tbody>${sourceRows}</tbody></table></div></div>
 <div><div class="panel"><div class="panel-title"><span>Top 500 coverage</span><span>${fmt(top.conflicts)} high-severity conflicts</span></div>${coverageRows(top,[['phone','Phone'],['website','Official website'],['instagram','Instagram'],['hours','Opening hours'],['rating','Rating'],['photos','Photos'],['menus','Quality menu'],['menu_items','Structured dishes']])}</div>
 <div class="panel section"><div class="panel-title"><span>Next frontier</span><span>premium enrichment</span></div><div class="funnel"><div class="step"><strong>${fmt(premium.total)}</strong><span>product pool</span></div><span class="chev">→</span><div class="step"><strong>${fmt(premium.menu_ready)}</strong><span>website ready / menu missing</span></div><span class="chev">→</span><div class="step"><strong>${fmt(premium.website_needed)}</strong><span>websites to discover</span></div></div><div class="callout">Current priority: increase real menu coverage across the Top 500. Qwen invents neither restaurants nor dishes—it only presents results retrieved from the corpus.</div></div></div>
</section>

<section class="panel section"><div class="panel-title"><span>Transformation funnel</span><span>from noise to product</span></div><div class="funnel">
 <div class="step"><strong>${fmt(totals.source_records)}</strong><span>source evidence</span></div><span class="chev">→</span><div class="step"><strong>${fmt(totals.matched)}</strong><span>matched evidence</span></div><span class="chev">→</span><div class="step"><strong>${fmt(totals.restaurants)}</strong><span>golden records</span></div><span class="chev">→</span><div class="step"><strong>${fmt(premium.total)}</strong><span>premium pool</span></div><span class="chev">→</span><div class="step"><strong>${fmt(top.menus)}</strong><span>Top 500 with menu</span></div><span class="chev">→</span><div class="step"><strong>${fmt(embeddings)}</strong><span>searchable vectors</span></div>
</div></section>

<section class="panel section"><div class="panel-title"><span>Command Center — essential recipes</span><span>copy → paste into Terminal</span></div><div class="quick-grid">
 <article class="recipe"><button data-copy="cd /Users/thediningdispatch/Desktop/004_DEV/CDMX_RESTAURANTS\nnpm run dashboard:serve">copy</button><h3>Dashboard only</h3><p>Rebuilds the metrics and opens the control room.</p><pre>cd /Users/thediningdispatch/Desktop/004_DEV/CDMX_RESTAURANTS
npm run dashboard:serve</pre></article>
 <article class="recipe"><button data-copy="cd /Users/thediningdispatch/Desktop/004_DEV/CDMX_RESTAURANTS\n./scripts/start_telegram_stack.command">copy</button><h3>Full Telegram stack</h3><p>Starts the web concierge and @conciergeCDMXbot together.</p><pre>cd /Users/thediningdispatch/Desktop/004_DEV/CDMX_RESTAURANTS
./scripts/start_telegram_stack.command</pre></article>
 <article class="recipe"><button data-copy="ollama serve">copy</button><h3>Local AI engine</h3><p>Run this when Ollama / Qwen is shown in red.</p><pre>ollama serve</pre></article>
 <article class="recipe"><button data-copy="cd /Users/thediningdispatch/Desktop/004_DEV/CDMX_RESTAURANTS/web\nnpm run dev">copy</button><h3>Web concierge only</h3><p>Next.js interface on localhost:3000.</p><pre>cd /Users/thediningdispatch/Desktop/004_DEV/CDMX_RESTAURANTS/web
npm run dev</pre></article>
 <article class="recipe"><button data-copy="cd /Users/thediningdispatch/Desktop/004_DEV/CDMX_RESTAURANTS\nnpm run search:refresh\nnpm run export:local\nnpm run golden:local\nnpm run embed\nnpm run dashboard:local">copy</button><h3>After a data collection</h3><p>Propagates new data into the AI corpus and dashboard.</p><pre>cd /Users/thediningdispatch/Desktop/004_DEV/CDMX_RESTAURANTS
npm run search:refresh
npm run export:local
npm run golden:local
npm run embed
npm run dashboard:local</pre></article>
 <article class="recipe"><button data-copy="cd /Users/thediningdispatch/Desktop/004_DEV/CDMX_RESTAURANTS\nnpm run audit:top500-local\nnpm run audit:menus-local\nnpm run audit:conflicts-local\nnpm run dashboard:local">copy</button><h3>Full quality audit</h3><p>Recalculates menus, conflicts, and Top 500 coverage.</p><pre>cd /Users/thediningdispatch/Desktop/004_DEV/CDMX_RESTAURANTS
npm run audit:top500-local
npm run audit:menus-local
npm run audit:conflicts-local
npm run dashboard:local</pre></article>
</div></section>

<section class="panel section"><div class="panel-title"><span>Complete npm command catalogue</span><span>${Object.keys(packageScripts).filter(name => !name.startsWith('_legacy:')).length} commands available</span></div>
 <div class="command-tools"><input id="command-search" type="search" placeholder="Search: telegram, menu, scrape, audit…"><select id="command-category"><option value="all">all categories</option><option>operations</option><option>scraping</option><option>pipeline</option><option>enrichment</option><option>quality</option></select></div>
 <div class="command-list" id="command-list">${commandCards}</div>
</section>
<footer><span>Local SQLite · Google spending locked · raw data preserved</span><span>health refresh: 10 s · rebuild: npm run dashboard:local</span></footer>
<script>
async function health(){try{const r=await fetch('/api/health',{cache:'no-store'});const x=await r.json();for(const [key,value] of Object.entries(x.services)){const dot=document.getElementById('h-'+key),detail=document.getElementById('d-'+key);if(dot)dot.className=value.ok?'ok':'off';if(detail&&value.detail)detail.textContent=value.detail}document.getElementById('refresh').textContent='live · '+new Date().toLocaleTimeString('en-GB')}catch{document.getElementById('h-dashboard').className='off'}}health();setInterval(health,10000)
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{await navigator.clipboard.writeText(button.dataset.copy);const before=button.textContent;button.textContent='copied ✓';setTimeout(()=>button.textContent=before,1400)}))
const search=document.getElementById('command-search'),category=document.getElementById('command-category');function filterCommands(){const query=search.value.toLowerCase(),selected=category.value;document.querySelectorAll('.command').forEach(card=>card.classList.toggle('hidden',!card.dataset.command.includes(query)||(selected!=='all'&&card.dataset.category!==selected)))}search.addEventListener('input',filterCommands);category.addEventListener('change',filterCommands)
</script></main></body></html>`

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, html)
console.log(output)
db.close()
