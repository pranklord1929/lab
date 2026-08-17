import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const port = Number(process.env.DASHBOARD_PORT || 4173)
const dashboard = resolve('data/exports/dashboard.html')

async function reachable(url, timeout = 1200) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(timeout) }); return response.ok } catch { return false }
}
async function processRunning(pattern) {
  try { const { stdout } = await exec('pgrep', ['-f', pattern]); return Boolean(stdout.trim()) } catch { return false }
}
async function health() {
  const [web, ollama, telegram] = await Promise.all([
    reachable('http://127.0.0.1:3000'), reachable('http://127.0.0.1:11434/api/tags'), processRunning('scripts/telegram_bot.js'),
  ])
  return { services: {
    dashboard: { ok: true, detail: `running · localhost:${port}` },
    web: { ok: web, detail: web ? 'concierge running · localhost:3000' : 'stopped · run npm run dev in web/' },
    ollama: { ok: ollama, detail: ollama ? 'local engine available' : 'stopped · start Ollama' },
    telegram: { ok: telegram, detail: telegram ? '@conciergeCDMXbot running' : 'bot stopped · npm run telegram:bot' },
  }}
}

createServer(async (req, res) => {
  try {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      return res.end(JSON.stringify(await health()))
    }
    if (req.url !== '/' && req.url !== '/dashboard.html') { res.writeHead(404); return res.end('Not found') }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(await readFile(dashboard))
  } catch (error) { res.writeHead(500); res.end(error.message) }
}).listen(port, '127.0.0.1', () => console.log(`CDMX Control Room: http://localhost:${port}`))
