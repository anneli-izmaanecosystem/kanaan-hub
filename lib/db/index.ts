import { drizzle } from 'drizzle-orm/neon-http'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { neon } from '@neondatabase/serverless'
import { Pool } from 'pg'
import * as schema from './schema'

let _db: ReturnType<typeof drizzle> | undefined

// Whether a real database is reachable. Lets callers tell "no rows yet" apart from
// "not connected", which otherwise look identical once queries start returning empty.
export const dbConfigured = Boolean(process.env.POSTGRES_URL)

// A neon-http response as returned under `fullResults: true`, which is the only mode
// drizzle's neon-http session asks for (see neon-http/session.js).
type NeonHttpResult = {
  rows: unknown[]
  fields: unknown[]
  rowCount: number
  command: string
  rowAsArray: boolean
}

let warned = false

function warnOnce() {
  if (warned) return
  warned = true
  console.warn('')
  console.warn('  POSTGRES_URL is not set - running against an empty database.')
  console.warn('  Every read returns zero rows and every write is discarded.')
  console.warn('  Set POSTGRES_URL in .env.local to use real data.')
  console.warn('')
}

// Stands in for the client `neon()` returns, so the app still boots with no database.
// Drizzle keeps doing everything it normally does - building SQL, mapping columns,
// applying relations - and only the execution hop comes back empty. Stubbing the
// driver rather than `db` itself keeps this small: there is one call signature to
// honour here, versus the whole drizzle query-builder surface.
function offlineClient() {
  const client = async (
    sql: string,
    _params: unknown[] = [],
    opts: { arrayMode?: boolean } = {},
  ): Promise<NeonHttpResult> => {
    warnOnce()
    return {
      rows: [],
      fields: [],
      rowCount: 0,
      command: sql.trim().split(' ')[0].toUpperCase(),
      rowAsArray: Boolean(opts.arrayMode),
    }
  }

  // `batch()` hands the already-issued query promises to `client.transaction`.
  return Object.assign(client, {
    transaction: (queries: Promise<NeonHttpResult>[]) => Promise.all(queries),
  })
}

function getDb() {
  if (!_db) {
    // `process.env.POSTGRES_URL!` used to be asserted only to TypeScript - the `!` is
    // erased at build time, so a missing value reached `neon()`, which threw about its
    // own argument from inside whichever server component touched `db` first.
    const url = process.env.POSTGRES_URL
    if (url && !isNeonUrl(url)) {
      // Plain Postgres - a local server, or any managed instance that is not Neon. The
      // neon-http client only talks to Neon's HTTP proxy, so anything else goes over a
      // normal TCP pool; TLS comes from the connection string itself, which pg honours.
      // Both drizzle flavours expose the same query builder; the neon-http type stays the
      // nominal one since production runs on Neon.
      // Kept on globalThis so a dev hot-reload of this module reuses the pool instead
      // of opening another one each time and exhausting the server's connection cap.
      const g = globalThis as typeof globalThis & { __kanaanPgPool?: Pool }
      // `timestamp` columns are timezone-less, and defaultNow() writes the session's local
      // time into them. Pin every session to UTC so what is stored never depends on
      // where the database happens to be running. It goes in the connection's startup
      // options rather than a SET on connect: the pool hands a new client to its caller
      // straight away, so a SET would overlap the caller's first query, which pg warns
      // is deprecated and pg 9 will refuse. (PGlite ignores the option; it is UTC anyway.)
      const pool = g.__kanaanPgPool ?? (g.__kanaanPgPool = new Pool({
        connectionString: url, max: 5, options: '-c timezone=UTC',
      }))
      _db = drizzlePg(pool, { schema }) as unknown as ReturnType<typeof drizzle>
    } else {
      const client = url ? neon(url) : (offlineClient() as unknown as ReturnType<typeof neon>)
      _db = drizzle(client, { schema })
    }
  }
  return _db
}

function isNeonUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.neon.tech')
  } catch {
    return false
  }
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as any)[prop]
  },
})

export * from './schema'
