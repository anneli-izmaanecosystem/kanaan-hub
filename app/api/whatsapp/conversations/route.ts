import { NextResponse } from 'next/server'
import { desc, eq, sql } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, waMessages, waConversations, trips } from '@/lib/db'

// One row per phone number that has ever exchanged a message with the WhatsApp number,
// newest activity first — the chat list on the dashboard's WhatsApp tab.
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const latest = db
    .select({
      phone: waMessages.phone,
      lastAt: sql<string>`max(${waMessages.createdAt})`.as('last_at'),
      count: sql<number>`count(*)::int`.as('count'),
      inbound: sql<number>`count(*) filter (where ${waMessages.direction} = 'inbound')::int`.as('inbound'),
    })
    .from(waMessages)
    .groupBy(waMessages.phone)
    .as('latest')

  const rows = await db
    .select({
      phone: latest.phone,
      lastAt: latest.lastAt,
      count: latest.count,
      inbound: latest.inbound,
      lastBody: sql<string | null>`(select body from wa_messages m where m.phone = ${latest.phone} order by m.created_at desc, m.id desc limit 1)`,
      lastDirection: sql<string | null>`(select direction from wa_messages m where m.phone = ${latest.phone} order by m.created_at desc, m.id desc limit 1)`,
      role: sql<string | null>`(select role from wa_messages m where m.phone = ${latest.phone} order by m.created_at desc, m.id desc limit 1)`,
      step: waConversations.step,
      tripId: waConversations.tripId,
      guestName: sql<string | null>`(select guest_name from trips t where t.guest_phone = ${latest.phone} and guest_name is not null order by t.id desc limit 1)`,
    })
    .from(latest)
    .leftJoin(waConversations, eq(waConversations.phone, latest.phone))
    .orderBy(desc(latest.lastAt))

  const withTrip = await Promise.all(rows.map(async r => {
    const [trip] = r.tripId
      ? await db.select({ ref: trips.ref, status: trips.status }).from(trips).where(eq(trips.id, r.tripId))
      : []
    return { ...r, trip: trip ?? null }
  }))

  return NextResponse.json(withTrip)
}
