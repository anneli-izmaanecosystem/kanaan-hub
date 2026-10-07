// One-off prod fix (2026-10-03), per Anneli:
//  - Room 1 -> 4 sleepers (rate card: 1 double, 2 twin).
//  - Room 21 reactivated as a Premium room: 3 sleepers, R750/night.
//  - Room 21 was rented to Jindili 1 Mar - 30 Sep 2026 at R6,500/month excl. VAT. Recorded as
//    one booking per calendar month (R7,475 incl. VAT = R6,500 excl.), so each month's
//    revenue is exactly R6,500 rather than a nights-pro-rated share of one long booking.
//  - Booking #72 ("Dieter", Room 21, 1-31 Mar, R7,500) is the same tenancy's March month —
//    cancelled (not deleted) and replaced by the March row below.
// Guarded so re-running is a no-op.
//
// Run with: node --env-file=.env.local scripts/room21-jindili-tenancy-2026-10.mjs

import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.POSTGRES_URL)
const ROOM_21 = 24
const MONTHLY_EXCL_VAT = 6500
const MONTHLY_INCL_VAT = (MONTHLY_EXCL_VAT * 1.15).toFixed(2) // 7475.00

console.table(await sql`update rooms set capacity = 4 where id = 1 and name = 'Room 1' and capacity = 2 returning id, name, capacity`)
console.table(await sql`
  update rooms
     set active = true, type = 'premium', capacity = 3, rate_pp = 750, rate_solo = null,
         pricing_mode = 'flat', category = 'Premium (Self Catering)'
   where id = ${ROOM_21} and name = 'Room 21'
  returning id, name, type, capacity, rate_pp, active`)

console.table(await sql`
  update bookings
     set status = 'cancelled',
         notes = coalesce(notes, '') || ' | Cancelled 2026-10-03: same tenancy as Jindili (Room 21, Mar-Sep 2026) - replaced by the Jindili March booking',
         updated_at = now()
   where id = 72 and room_id = ${ROOM_21} and guest_name = 'Dieter' and status <> 'cancelled'
  returning id, guest_name, status`)

for (let m = 3; m <= 9; m++) {
  const checkIn  = `2026-${String(m).padStart(2, '0')}-01`
  const checkOut = `2026-${String(m + 1).padStart(2, '0')}-01`
  const nights   = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000)
  const existing = await sql`select id from bookings where room_id = ${ROOM_21} and guest_name = 'Jindili' and check_in = ${checkIn} and status <> 'cancelled'`
  if (existing.length) { console.log(`${checkIn}: already recorded (#${existing[0].id})`); continue }
  const [b] = await sql`
    insert into bookings (room_id, guest_name, contact, check_in, check_out, adults, children, nights,
                          total_amount, deposit_paid, balance_due, vat_included, status, source, notes)
    values (${ROOM_21}, 'Jindili', 'Jindili', ${checkIn}, ${checkOut}, 1, 0, ${nights},
            ${MONTHLY_INCL_VAT}, ${MONTHLY_INCL_VAT}, 0, true, 'fully_paid', 'direct_walkin',
            ${`Monthly rental R${MONTHLY_EXCL_VAT} excl. VAT - Jindili tenancy 1 Mar-30 Sep 2026`})
    returning id`
  await sql`insert into booking_rooms (booking_id, room_id) values (${b.id}, ${ROOM_21})`
  console.log(`${checkIn}: booking #${b.id} (${nights} nights, R${MONTHLY_INCL_VAT} incl. VAT)`)
}

console.table(await sql`select type, count(*) as rooms, sum(capacity) as beds from rooms where active and name <> 'Room 8' group by type order by type`)
