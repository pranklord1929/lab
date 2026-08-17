// Creates a consistent, checksummed SQLite backup. Never uploads anything.
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'

const source = resolve('data/local_db/cdmx_local.sqlite')
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const dir = resolve('data/backups')
const target = resolve(dir, `cdmx_local_${stamp}.sqlite`)
mkdirSync(dir, { recursive: true })

const db = new DatabaseSync(source)
const escaped = target.replaceAll("'", "''")
db.exec(`VACUUM INTO '${escaped}'`)
db.close()

const bytes = readFileSync(target)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const manifest = {
  created_at: new Date().toISOString(),
  source,
  backup: target,
  bytes: bytes.length,
  sha256,
}
writeFileSync(`${target}.json`, `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(resolve(dir, 'LATEST'), `${basename(target)}\n`)
console.log(JSON.stringify(manifest))
