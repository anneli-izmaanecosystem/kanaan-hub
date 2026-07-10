import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { db, bookings, rooms, bookingRooms } from '@/lib/db'
import { eq, and, or, lte, gte, gt, inArray, sql } from 'drizzle-orm'

// GET /api/mobile/bookings?days=3  — upcoming check-ins within `days`, plus bookings
// currently in-house (checkIn <= today <= checkOut), merged into one list.
export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const days = parseInt(req.nextUrl.searchParams.get('days') ?? '3')
  const today = new Date()
  const future = new Date(today)
  future.setDate(today.getDate() + days)

  const toDateStr = (d: Date) => d.toISOString().split('T')[0]
  const todayStr = toDateStr(today)

  const rows = await db
    .select({ booking: bookings })
    .from(bookings)
    .where(and(
      or(
        // upcoming: check-in falls within the window
        and(gte(bookings.checkIn, todayStr), lte(bookings.checkIn, toDateStr(future))),
        // present: guest is currently in-house
        and(lte(bookings.checkIn, todayStr), gt(bookings.checkOut, todayStr)),
      ),
      sql`${bookings.status} != 'cancelled'`,
    ))
    .orderBy(bookings.checkIn)

  if (rows.length === 0) return NextResponse.json([])

  const bookingIds = rows.map(r => r.booking.id)
  const links = await db.select().from(bookingRooms).where(inArray(bookingRooms.bookingId, bookingIds))
  const roomIds = [...new Set(links.map(l => l.roomId))]
  const allRooms = roomIds.length ? await db.select().from(rooms).where(inArray(rooms.id, roomIds)) : []

  const result = rows.map(({ booking }) => ({
    booking,
    rooms: links
      .filter(l => l.bookingId === booking.id)
      .map(l => allRooms.find(r => r.id === l.roomId))
      .filter(Boolean),
  }))

  return NextResponse.json(result)
}

// POST /api/mobile/bookings
export async function POST(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const { roomIds, guestName, contact, idNumber, checkIn, checkOut, adults, children,
            totalAmount, depositPaid, specialRequests, status, source, paymentMethod,
            invoiceNumber, payDate, notes } = body

    const selectedRoomIds: number[] = Array.isArray(roomIds) ? roomIds.map((rid: any) => parseInt(rid)) : []

    if (!guestName || !checkIn || selectedRoomIds.length === 0)
      return NextResponse.json({ error: 'Guest name, check-in date and at least one room are required' }, { status: 400 })

    if (checkOut && checkOut <= checkIn)
      return NextResponse.json({ error: 'Check-out must be after check-in' }, { status: 400 })

    const conflict = checkOut ? await db
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
      roomId: selectedRoomIds[0],
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
      balanceDue:   String(Math.max(0, total - deposit)),
      specialRequests, source: source || 'mobile', notes,
      status:        status ?? 'confirmed',
      paymentMethod: paymentMethod ?? null,
      invoiceNumber: invoiceNumber ?? null,
      payDate:       payDate || null,
    }).returning()

    await db.insert(bookingRooms).values(selectedRoomIds.map(roomId => ({ bookingId: booking.id, roomId })))

    return NextResponse.json(booking, { status: 201 })
  } catch (err: any) {
    console.error('[mobile/bookings POST]', err)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }
}
