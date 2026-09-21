import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db, destinations } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { distanceFromFarm } from '@/lib/whatsapp/places'
import { cleanAliases } from '../route'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const patch: Record<string, unknown> = {}

  if (body.name    !== undefined) patch.name    = String(body.name).trim()
  if (body.aliases !== undefined) patch.aliases = cleanAliases(body.aliases)
  if (body.active  !== undefined) patch.active  = Boolean(body.active)
  if (body.fixedFare !== undefined) {
    patch.fixedFare = body.fixedFare === '' || body.fixedFare == null ? null : String(body.fixedFare)
  }

  for (const [key, min, max] of [['lat', -90, 90], ['lng', -180, 180]] as const) {
    if (body[key] === undefined) continue
    const v = Number(body[key])
    if (!Number.isFinite(v) || v < min || v > max) {
      return NextResponse.json({ error: `${key} must be between ${min} and ${max}` }, { status: 400 })
    }
    patch[key] = String(v)
  }

  const [row] = await db.update(destinations).set(patch).where(eq(destinations.id, parseInt(id))).returning()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ ...row, ...distanceFromFarm(Number(row.lat), Number(row.lng)) })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  // Trips store the resolved place as text, not a reference, so removing a destination
  // cannot orphan a past trip.
  const [row] = await db.delete(destinations).where(eq(destinations.id, parseInt(id))).returning()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
