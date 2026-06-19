import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, bookings, rooms } from '@/lib/db'
import { eq, and, gt, gte, lte, sql } from 'drizzle-orm'
import { ratelimit } from '@/lib/ratelimit'
import { monthEndDate } from '@/lib/date-sa'

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
    const end   = monthEndDate(month)
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
            totalAmount, depositPaid, specialRequests, status, source,
            paymentMethod, invoiceNumber, payDate, notes } = body

    if (!guestName || !checkIn)
      return NextResponse.json({ error: 'Guest name and check-in date are required' }, { status: 400 })

    // Conflict check (only if room + checkout provided)
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
      return NextResponse.json({ error: 'Room is not available for those dates' }, { status: 409 })

    const nights  = checkOut ? Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000) : 0
    const deposit = parseFloat(depositPaid ?? '0')
    const total   = parseFloat(totalAmount ?? '0')

    const [booking] = await db.insert(bookings).values({
      roomId:   roomId ?? null,
      guestName,
      contact:  contact || guestName,
      idNumber: idNumber ?? null,
      checkIn,
      checkOut: checkOut ?? checkIn,
      adults:   parseInt(adults ?? '1'),
      children: parseInt(children ?? '0'),
      nights,
      totalAmount:  String(total),
      depositPaid:  String(deposit),
      balanceDue:   String(total - deposit),
      specialRequests, source, notes,
      status:        status ?? 'confirmed',
      paymentMethod: paymentMethod ?? null,
      invoiceNumber: invoiceNumber ?? null,
      payDate:       payDate ?? null,
    }).returning()

    return NextResponse.json(booking, { status: 201 })
  } catch (err: any) {
    console.error('[bookings POST]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
