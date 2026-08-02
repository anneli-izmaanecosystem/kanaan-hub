import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, bookings, bookingRooms } from '@/lib/db'
import { eq, and, gt, lt, sql, inArray, ne } from 'drizzle-orm'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, parseInt(id)))
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const links = await db.select().from(bookingRooms).where(eq(bookingRooms.bookingId, booking.id))
  const roomIds = links.length ? links.map(l => l.roomId) : [booking.roomId]
  return NextResponse.json({ ...booking, roomIds })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const bookingId = parseInt(id)
  try {
    const body = await req.json()
    const { roomIds, ...rest } = body

    if (rest.checkIn && rest.checkOut && rest.checkOut <= rest.checkIn)
      return NextResponse.json({ error: 'Check-out must be after check-in' }, { status: 400 })

    if (Array.isArray(roomIds) && roomIds.length === 0)
      return NextResponse.json({ error: 'At least one room is required' }, { status: 400 })

    // Empty strings from the edit form aren't valid Postgres date literals — treat as "unset".
    if (rest.payDate === '') rest.payDate = null
    // checkOut, totalAmount, depositPaid, balanceDue are NOT NULL columns — mirror the POST
    // route's fallback instead of letting an empty string hit the DB as an invalid literal.
    if (rest.checkOut === '') rest.checkOut = rest.checkIn
    if (rest.totalAmount === '') rest.totalAmount = '0'
    if (rest.depositPaid === '') rest.depositPaid = '0'
    if (rest.balanceDue === '') rest.balanceDue = '0'

    const selectedRoomIds: number[] | undefined = Array.isArray(roomIds) && roomIds.length
      ? roomIds.map((rid: any) => parseInt(rid))
      : undefined

    if (selectedRoomIds && rest.checkIn && rest.checkOut) {
      const conflict = await db
        .select({ id: bookingRooms.bookingId })
        .from(bookingRooms)
        .innerJoin(bookings, eq(bookingRooms.bookingId, bookings.id))
        .where(and(
          inArray(bookingRooms.roomId, selectedRoomIds),
          ne(bookings.id, bookingId),
          lt(bookings.checkIn, rest.checkOut),
          gt(bookings.checkOut, rest.checkIn),
          sql`${bookings.status} != 'cancelled'`,
        ))
        .limit(1)
      if (conflict.length > 0)
        return NextResponse.json({ error: 'One or more rooms are not available for those dates' }, { status: 409 })
    }

    const patch = selectedRoomIds ? { ...rest, roomId: selectedRoomIds[0] } : rest

    const [updated] = await db
      .update(bookings)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(bookings.id, bookingId))
      .returning()
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (selectedRoomIds) {
      await db.delete(bookingRooms).where(eq(bookingRooms.bookingId, bookingId))
      if (selectedRoomIds.length)
        await db.insert(bookingRooms).values(selectedRoomIds.map(rid => ({ bookingId, roomId: rid })))
    }

    return NextResponse.json(updated)
  } catch (err: any) {
    console.error('[bookings PATCH]', err)
    return NextResponse.json({ error: 'Failed to update booking' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const [updated] = await db
    .update(bookings)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(bookings.id, parseInt(id)))
    .returning()
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
