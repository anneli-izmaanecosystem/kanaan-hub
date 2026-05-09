import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, bookings, rooms } from '@/lib/db'
import { eq, and, gte, lte, sql } from 'drizzle-orm'
import { ratelimit } from '@/lib/ratelimit'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const month = req.nextUrl.searchParams.get('month') // YYYY-MM
  let query = db
    .select({ booking: bookings, room: rooms })
    .from(bookings)
    .innerJoin(rooms, eq(bookings.roomId, rooms.id))

  if (month) {
    const start = `${month}-01`
    const end   = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0).toISOString().split('T')[0]
    query = query.where(and(
      lte(bookings.checkIn, end),
      gte(bookings.checkOut, start),
    )) as typeof query
  }

  const rows = await (query as any).orderBy(bookings.checkIn)
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { success } = await ratelimit.limit(userId)
  if (!success) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  try {
    const body = await req.json()
    const { roomId, guestName, contact, idNumber, checkIn, checkOut, adults, children,
            totalAmount, depositPaid, specialRequests, source, notes } = body

    if (!roomId || !guestName || !contact || !checkIn || !checkOut)
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

    // Conflict check
    const conflict = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(
        eq(bookings.roomId, roomId),
        lte(bookings.checkIn, checkOut),
        gte(bookings.checkOut, checkIn),
        sql`${bookings.status} != 'cancelled'`,
      ))
      .limit(1)

    if (conflict.length > 0)
      return NextResponse.json({ error: 'Room is not available for those dates' }, { status: 409 })

    const nights = Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000)
    const deposit = parseFloat(depositPaid ?? '0')
    const total   = parseFloat(totalAmount)

    const [booking] = await db.insert(bookings).values({
      roomId, guestName, contact, idNumber,
      checkIn, checkOut,
      adults:   parseInt(adults ?? '1'),
      children: parseInt(children ?? '0'),
      nights,
      totalAmount:  String(total),
      depositPaid:  String(deposit),
      balanceDue:   String(total - deposit),
      specialRequests, source, notes,
    }).returning()

    return NextResponse.json(booking, { status: 201 })
  } catch (err: any) {
    console.error('[bookings POST]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
