import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, drivers, trips } from '@/lib/db'
import { eq, and, inArray } from 'drizzle-orm'
import { normalisePhone } from '../route'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const patch: Record<string, unknown> = {}

  if (body.name    !== undefined) patch.name    = String(body.name).trim()
  if (body.plate   !== undefined) patch.plate   = String(body.plate).trim()
  if (body.vehicle !== undefined) patch.vehicle = String(body.vehicle).trim() || null
  if (body.active  !== undefined) patch.active  = Boolean(body.active)
  if (body.onDuty  !== undefined) patch.onDuty  = Boolean(body.onDuty)

  if (body.phone !== undefined) {
    const phone = normalisePhone(body.phone)
    if (!phone) return NextResponse.json({ error: 'A valid WhatsApp number is required' }, { status: 400 })
    patch.phone = phone
  }

  const [row] = await db.update(drivers).set(patch).where(eq(drivers.id, parseInt(id))).returning()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const driverId = parseInt(id)

  // A driver on a live trip cannot be removed — trips.driverId references them, and the
  // guest has been told their name and plate. Deactivating keeps the history readable.
  const live = await db
    .select({ ref: trips.ref })
    .from(trips)
    .where(and(
      eq(trips.driverId, driverId),
      inArray(trips.status, ['allocated', 'driver_en_route', 'driver_waiting', 'in_progress']),
    ))

  if (live.length) {
    return NextResponse.json(
      { error: `Still on ${live.length} live trip(s): ${live.map(t => t.ref).join(', ')}. Set them off duty instead.` },
      { status: 409 },
    )
  }

  const [row] = await db.update(drivers).set({ active: false, onDuty: false }).where(eq(drivers.id, driverId)).returning()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}
