import { NextRequest, NextResponse } from 'next/server'
import { asc, desc, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db, waMessages, waConversations, trips, tripEvents } from '@/lib/db'
import { toE164 } from '@/lib/whatsapp/config'

// The full thread with one number, oldest first, plus where the conversation currently
// sits and the trips this number has booked.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const phone = toE164(decodeURIComponent((await params).phone).trim())

  const messages = await db
    .select({
      id: waMessages.id,
      waMessageId: waMessages.waMessageId,
      direction: waMessages.direction,
      role: waMessages.role,
      kind: waMessages.kind,
      templateName: waMessages.templateName,
      body: waMessages.body,
      payload: waMessages.payload,
      tripId: waMessages.tripId,
      createdAt: waMessages.createdAt,
    })
    .from(waMessages)
    .where(eq(waMessages.phone, phone))
    .orderBy(asc(waMessages.createdAt), asc(waMessages.id))

  const [conversation] = await db.select().from(waConversations).where(eq(waConversations.phone, phone))

  const guestTrips = await db.select().from(trips).where(eq(trips.guestPhone, phone)).orderBy(desc(trips.id)).limit(10)
  const tripsWithEvents = await Promise.all(guestTrips.map(async t => ({
    ...t,
    events: await db.select().from(tripEvents).where(eq(tripEvents.tripId, t.id)).orderBy(asc(tripEvents.at)),
  })))

  return NextResponse.json({ phone, messages, conversation: conversation ?? null, trips: tripsWithEvents })
}
