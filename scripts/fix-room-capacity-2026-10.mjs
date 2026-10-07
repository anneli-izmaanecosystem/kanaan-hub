// One-off prod fix (2026-10-03): bring budget rooms back to the July 2026 rate card
// (lib/db/seed-room-pricelist.ts) — 7 twin rooms x 2 = 14 budget beds.
//   Room 4  : type budget -> premium (its rate, category and bed config are already Premium)
//   Room 15 : capacity 4 -> 2 (a 2-sleeper budget room)
// Guarded on the current values, so re-running is a no-op.
//
// Run with: node --env-file=.env.local scripts/fix-room-capacity-2026-10.mjs

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.POSTGRES_URL)

console.table(await sql`update rooms set type = 'premium' where id = 4 and name = 'Room 4' and type = 'budget' returning id, name, type, capacity`)
console.table(await sql`update rooms set capacity = 2 where id = 25 and name = 'Room 15' and capacity = 4 returning id, name, type, capacity`)
console.table(await sql`select type, count(*) as rooms, sum(capacity) as beds from rooms where active and name <> 'Room 8' group by type order by type`)
