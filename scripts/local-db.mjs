// Runs before `next dev` (package.json) and starts the local development database when
// there is one to start.
//
// POSTGRES_URL in .env.local can point at a PGlite server on this machine, serving
// .pglite/kanaan_hub. That server is a process of its own: nothing brought it back after a
// restart, and every page then failed with "Failed query: ..." (ECONNREFUSED underneath).
// It also has to allow several connections - lib/db opens a pool of 5, and with PGlite's
// default of one, parallel queries on a page were reset at random.
//
// So: if POSTGRES_URL is on this machine, no database answers there yet, and the PGlite
// data folder exists, start the server in the background and wait for it. It keeps
// running between dev-server restarts (its log is .pglite/server.log). Any other database
// - Neon, a real local Postgres that is already up - is left alone.
import { spawn } from 'node:child_process'
import { existsSync, openSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import pg from 'pg'

const ROOT = process.cwd()
const DATA = path.join('.pglite', 'kanaan_hub')
const LOG = path.join(ROOT, '.pglite', 'server.log')
// lib/db's pool of 5, plus room for a drizzle-kit, psql or seed script alongside it.
const MAX_CONNECTIONS = 10

/** POSTGRES_URL as Next will see it: the environment first, then .env.local. */
function postgresUrl() {
  if (process.env.POSTGRES_URL) return process.env.POSTGRES_URL
  const file = path.join(ROOT, '.env.local')
  if (!existsSync(file)) return null
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find(l => /^\s*POSTGRES_URL\s*=/.test(l))
  return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : null
}

function listening(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => { socket.destroy(); resolve(true) })
    socket.on('error', () => resolve(false))
  })
}

/**
 * Whether the database answers a query. This is the check to use once something is on the
 * port: PGlite's server never frees the slot of a bare TCP connection that closes without
 * speaking Postgres, so probing it with `listening` would leave it one connection short
 * for good.
 */
async function answers(url) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 })
  try {
    await client.connect()
    await client.query('select 1')
    return true
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const raw = postgresUrl()
let url = null
try { url = raw ? new URL(raw) : null } catch { /* not a URL: not ours to start */ }
const local = url && ['127.0.0.1', 'localhost'].includes(url.hostname)
const port = url ? Number(url.port || 5432) : 0

if (!local) process.exit(0)
if (await answers(raw)) process.exit(0)
if (await listening(port)) {
  // Taken, but not by a database that answers: starting PGlite would fail to bind.
  console.warn(`\n  Something is on port ${port} but does not answer as the database in POSTGRES_URL.\n`)
  process.exit(0)
}
if (!existsSync(path.join(ROOT, DATA))) {
  console.warn(`\n  POSTGRES_URL points at port ${port} on this machine, but nothing is listening there`)
  console.warn(`  and there is no ${DATA} to serve. Start your database before using the dashboard.\n`)
  process.exit(0)
}

const pkg = path.join(ROOT, 'node_modules', '@electric-sql', 'pglite-socket')
const server = path.join(pkg, JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).bin['pglite-server'])
const log = openSync(LOG, 'a')
spawn(process.execPath, [server, `--db=${DATA}`, `--port=${port}`, `--max-connections=${MAX_CONNECTIONS}`], {
  cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', log, log],
}).unref()

// Opening an existing PGlite database takes a few seconds.
for (let waited = 0; waited < 60_000; waited += 500) {
  if (await answers(raw)) {
    console.log(`  Local database started on port ${port} (${DATA}, log: .pglite/server.log)`)
    process.exit(0)
  }
  await new Promise(r => setTimeout(r, 500))
}
console.warn(`\n  The local database did not start on port ${port} within a minute - see .pglite/server.log\n`)
