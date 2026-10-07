// One-off prod fix (2026-10-03): Rooms 1, 3, 5, 6 never received the July 2026 rate card
// (lib/db/seed-room-pricelist.ts) — still on the R650 / 2-sleeper default. Anneli confirmed
// the rate card rates, Room 5 = 4 pax, Room 6 = 3 pax. Room 1's capacity is left as-is
// pending confirmation (rate card says 4).
//
// Run with: node --env-file=.env.local scripts/fix-premium-rate-card-2026-10.mjs

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.POSTGRES_URL)
const PREMIUM = 'Premium (Self Catering)'

console.table(await sql`update rooms set rate_pp = 1200, rate_solo = null, category = ${PREMIUM}, bed_config = '1 Double, 2 Twin' where id = 1 and name = 'Room 1' returning id, name, capacity, rate_pp`)
console.table(await sql`update rooms set rate_pp = 600, rate_solo = null, category = ${PREMIUM}, bed_config = '2 Twin' where id = 3 and name = 'Room 3' returning id, name, capacity, rate_pp`)
console.table(await sql`update rooms set rate_pp = 1200, rate_solo = null, capacity = 4, category = ${PREMIUM}, bed_config = '1 Double, 2 Twin' where id = 5 and name = 'Room 5' returning id, name, capacity, rate_pp`)
console.table(await sql`update rooms set rate_pp = 750, rate_solo = null, capacity = 3, category = ${PREMIUM}, bed_config = '3 Twin' where id = 6 and name = 'Room 6' returning id, name, capacity, rate_pp`)
