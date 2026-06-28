import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { db, bookings, rooms } from '@/lib/db'
import { eq, and, lte, gte, gt, sql } from 'drizzle-orm'

// GET /api/mobile/bookings?days=3  — upcoming check-ins
export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '3')
  const today = new Date()
  const future = new Date(today)
  future.setDate(today.getDate() + days)

  const toDateStr = (d: Date) => d.toISOString().split('T')[0]

  const rows = await db
    .select({ booking: bookings, room: rooms })
    .from(bookings)
    .innerJoin(rooms, eq(bookings.roomId, rooms.id))
    .where(and(
      gte(bookings.checkIn, toDateStr(today)),
      lte(bookings.checkIn, toDateStr(future)),
      sql`${bookings.status} != 'cancelled'`,
    ))
    .orderBy(bookings.checkIn)

  return NextResponse.json(rows)
}

// POST /api/mobile/bookings
export async function POST(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const { roomId, guestName, contact, checkIn, checkOut, adults, children,
            totalAmount, depositPaid, specialRequests, status, source, notes } = body

    if (!guestName || !checkIn)
      return NextResponse.json({ error: 'Guest name and check-in date are required' }, { status: 400 })

    const conflict = roomId && checkOut ? await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(
        eq(bookings.roomId, roomId),
        lte(bookings.checkIn, checkOut),
        gt(bookings.checkOut, checkIn),
        sql`${bookings.status} != 'cancelled'`,
      ))
      .limit(1) : []

    if (conflict.length > 0)
      return NextResponse.json({ error: 'Room not available for those dates' }, { status: 409 })

    const nights  = checkOut ? Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000) : 0
    const deposit = parseFloat(depositPaid ?? '0')
    const total   = parseFloat(totalAmount ?? '0')

    const [booking] = await db.insert(bookings).values({
      roomId:   roomId ?? null,
      guestName,
      contact:  contact || guestName,
      checkIn,
      checkOut: checkOut ?? checkIn,
      adults:   parseInt(adults ?? '1'),
      children: parseInt(children ?? '0'),
      nights,
      totalAmount:  String(total),
      depositPaid:  String(deposit),
      balanceDue:   String(total - deposit),
      specialRequests, source: source ?? 'mobile', notes,
      status: status ?? 'confirmed',
    }).returning()

    return NextResponse.json(booking, { status: 201 })
  } catch (err: any) {
    console.error('[mobile/bookings POST]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
