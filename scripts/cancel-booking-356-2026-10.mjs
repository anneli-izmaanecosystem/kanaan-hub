// One-off prod fix (2026-10-03), per Anneli: cancel booking #356 (Vanessa Feldmann, Room 13,
// 18-19 Dec 2026). Room 13 is inactive; the same guest/dates are booked in Room 4 (#357).
// Cancelled, not deleted. Guarded so re-running is a no-op.
//
// Run with: node --env-file=.env.local scripts/cancel-booking-356-2026-10.mjs

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.POSTGRES_URL)

console.table(await sql`
  update bookings b
     set status = 'cancelled',
         notes = coalesce(b.notes, '') || ' | Cancelled 2026-10-03: duplicate of #357 (Room 4); Room 13 inactive',
         updated_at = now()
    from rooms r
   where b.id = 356 and r.id = b.room_id and r.name = 'Room 13' and b.status <> 'cancelled'
  returning b.id, b.guest_name, b.status`)
console.table(await sql`select b.id, r.name room, b.guest_name, b.check_in::text, b.check_out::text, b.total_amount, b.status from bookings b join rooms r on r.id = b.room_id where b.id in (356, 357)`)
