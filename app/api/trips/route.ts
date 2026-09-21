import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, trips, drivers } from '@/lib/db'
import { desc, eq, gte, lt, and, inArray, type SQL } from 'drizzle-orm'

/**
 * GET /api/trips
 *   ?scope=today   — anything departing today, plus anything still open (default)
 *   ?scope=open    — not yet finished, whatever the date
 *   ?scope=all     — everything, newest first
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const scope = req.nextUrl.searchParams.get('scope') ?? 'today'
  const open = ['requested', 'allocated', 'driver_en_route', 'driver_waiting', 'in_progress'] as const

  let where: SQL | undefined
  if (scope === 'today') {
    // Day boundaries in SAST (UTC+2, no DST), so "today" means the owner's today.
    const now = new Date()
    const sast = new Date(now.getTime() + 2 * 3600_000)
    const start = new Date(Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate()) - 2 * 3600_000)
    const end = new Date(start.getTime() + 86_400_000)

    // End is exclusive so a trip exactly at midnight belongs to tomorrow only.
    where = and(gte(trips.scheduledAt, start), lt(trips.scheduledAt, end))
  } else if (scope === 'open') {
    where = inArray(trips.status, [...open])
  }

  const rows = await db
    .select({
      trip: trips,
      driverName: drivers.name,
      driverPhone: drivers.phone,
      driverPlate: drivers.plate,
      driverVehicle: drivers.vehicle,
    })
    .from(trips)
    .leftJoin(drivers, eq(trips.driverId, drivers.id))
    .where(where)
    .orderBy(desc(trips.scheduledAt))
    .limit(200)

  // A draft is a guest who abandoned the chat part-way. Real, but not something the
  // board should present as a booking.
  return NextResponse.json(
    rows
      .filter(r => r.trip.status !== 'draft' || scope === 'all')
      .map(r => ({ ...r.trip, driver: r.driverName ? {
        name: r.driverName, phone: r.driverPhone, plate: r.driverPlate, vehicle: r.driverVehicle,
      } : null })),
  )
}
