import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, bookings, rooms, bookingRooms } from '@/lib/db'
import { eq, and, gt, gte, lte, sql, inArray } from 'drizzle-orm'
import { checkRatelimit } from '@/lib/ratelimit'
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

  const bookingIds = rows.map((r: any) => r.booking.id)
  const allRoomLinks = bookingIds.length
    ? await db
        .select({ bookingId: bookingRooms.bookingId, room: rooms })
        .from(bookingRooms)
        .innerJoin(rooms, eq(bookingRooms.roomId, rooms.id))
        .where(inArray(bookingRooms.bookingId, bookingIds))
    : []

  const result = rows.map((r: any) => {
    const linked = allRoomLinks.filter(l => l.bookingId === r.booking.id).map(l => l.room)
    return { ...r, rooms: linked.length ? linked : [r.room] }
  })

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const allowed = await checkRatelimit(userId)
  if (!allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  try {
    const body = await req.json()
    const { roomId, roomIds, guestName, contact, idNumber, checkIn, checkOut, adults, children,
            totalAmount, depositPaid, specialRequests, status, source,
            paymentMethod, invoiceNumber, payDate, notes } = body

    const selectedRoomIds: number[] = Array.isArray(roomIds) && roomIds.length
      ? roomIds.map((id: any) => parseInt(id))
      : roomId ? [parseInt(roomId)] : []

    if (!guestName || !checkIn)
      return NextResponse.json({ error: 'Guest name and check-in date are required' }, { status: 400 })

    if (!selectedRoomIds.length)
      return NextResponse.json({ error: 'At least one room is required' }, { status: 400 })

    if (checkOut && checkOut <= checkIn)
      return NextResponse.json({ error: 'Check-out must be after check-in' }, { status: 400 })

    // Conflict check across every selected room (only if checkout provided)
    const conflict = selectedRoomIds.length && checkOut ? await db
      .select({ id: bookingRooms.bookingId })
      .from(bookingRooms)
      .innerJoin(bookings, eq(bookingRooms.bookingId, bookings.id))
      .where(and(
        inArray(bookingRooms.roomId, selectedRoomIds),
        lte(bookings.checkIn, checkOut),
        gt(bookings.checkOut, checkIn),
        sql`${bookings.status} != 'cancelled'`,
      ))
      .limit(1) : []

    if (conflict.length > 0)
      return NextResponse.json({ error: 'One or more rooms are not available for those dates' }, { status: 409 })

    const nights  = checkOut ? Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86_400_000) : 0
    const deposit = parseFloat(depositPaid ?? '0')
    const total   = parseFloat(totalAmount ?? '0')

    const [booking] = await db.insert(bookings).values({
      roomId:   selectedRoomIds[0] ?? null,
      guestName,
      contact:  contact || guestName,
      idNumber: idNumber ?? null,
      checkIn,
      checkOut: checkOut || checkIn,
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
      payDate:       payDate || null,
    }).returning()

    if (selectedRoomIds.length)
      await db.insert(bookingRooms).values(
        selectedRoomIds.map(rid => ({ bookingId: booking.id, roomId: rid }))
      )

    return NextResponse.json(booking, { status: 201 })
  } catch (err: any) {
    console.error('[bookings POST]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
