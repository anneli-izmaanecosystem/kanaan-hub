// Runs before `next dev` (package.json) and starts the local WhatsApp simulator when the
// dashboard is pointed at it and it is not running.
//
// Locally the Transportation and WhatsApp tabs read through KANAAN_BOT_URL, which in
// .env.local is the simulator (http://127.0.0.1:8765, whatsapp-backend/sim/run.sh). Like
// the local database it is a process of its own, gone after a restart, and every one of
// those pages then says "WhatsApp service unreachable".
//
// It opens in its own window, the same as double-clicking run-simulator.cmd, so it can be
// watched and closed there; it keeps running after the dev server stops. It starts with an
// empty database (by design) and takes about a minute; the pages pick it up on their next
// refresh. A KANAAN_BOT_URL that is not on this machine is left alone.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const LAUNCHER = path.join(ROOT, 'whatsapp-backend', 'sim', 'run-simulator.cmd')

/** KANAAN_BOT_URL as Next will see it: the environment first, then .env.local. */
function botUrl() {
  if (process.env.KANAAN_BOT_URL) return process.env.KANAAN_BOT_URL
  const file = path.join(ROOT, '.env.local')
  if (!existsSync(file)) return null
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find(l => /^\s*KANAAN_BOT_URL\s*=/.test(l))
  return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '') : null
}

const raw = botUrl()
let url = null
try { url = raw ? new URL(raw) : null } catch { /* not a URL: not ours to start */ }
if (!url || !['127.0.0.1', 'localhost'].includes(url.hostname)) process.exit(0)

const health = new URL('health', raw.endsWith('/') ? raw : `${raw}/`)
const up = await fetch(health, { signal: AbortSignal.timeout(3000) }).then(r => r.ok, () => false)
if (up) process.exit(0)

if (process.platform !== 'win32' || !existsSync(LAUNCHER)) {
  console.warn(`\n  The WhatsApp simulator is not running at ${raw}. Start it with: sh whatsapp-backend/sim/run.sh\n`)
  process.exit(0)
}

// `start` gives it a console window of its own; the first quoted argument is the title.
spawn('cmd.exe', ['/c', 'start', 'Kanaan WhatsApp Simulator', LAUNCHER], {
  cwd: ROOT, detached: true, stdio: 'ignore',
}).unref()
console.log(`  WhatsApp simulator starting in its own window (${url.origin}/sim) - the WhatsApp and`)
console.log('  Transportation tabs load once it is up, in about a minute.')
