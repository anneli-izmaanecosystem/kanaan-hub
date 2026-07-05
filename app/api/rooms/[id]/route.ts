import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, rooms, bookingRooms, roomComboMembers } from '@/lib/db'
import { eq, sql } from 'drizzle-orm'

const EDITABLE_FIELDS = [
  'name', 'type', 'capacity', 'ratePp', 'rateSolo', 'pricingMode',
  'category', 'bedConfig', 'active', 'icalUrl',
] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const body = await req.json()

  const patch: Record<string, unknown> = {}
  for (const key of EDITABLE_FIELDS) {
    if (!(key in body)) continue
    if (key === 'capacity') patch[key] = parseInt(body[key])
    else if (key === 'ratePp') patch[key] = String(body[key])
    else if (key === 'rateSolo') patch[key] = body[key] === '' || body[key] == null ? null : String(body[key])
    else if (key === 'icalUrl') patch[key] = body[key] || null
    else patch[key] = body[key]
  }

  if (Object.keys(patch).length === 0)
    return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 })

  try {
    const [updated] = await db
      .update(rooms)
      .set(patch)
      .where(eq(rooms.id, parseInt(id)))
      .returning()
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (err: any) {
    console.error('[rooms PATCH]', err)
    return NextResponse.json({ error: 'Failed to update room' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const roomId = parseInt(id)

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookingRooms)
    .where(eq(bookingRooms.roomId, roomId))

  if (count > 0) {
    return NextResponse.json(
      { error: `Cannot delete — ${count} booking(s) still reference this room. Deactivate it instead.` },
      { status: 409 },
    )
  }

  try {
    await db.delete(roomComboMembers).where(eq(roomComboMembers.roomId, roomId))
    const [deleted] = await db.delete(rooms).where(eq(rooms.id, roomId)).returning()
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[rooms DELETE]', err)
    return NextResponse.json({ error: 'Failed to delete room' }, { status: 500 })
  }
}
