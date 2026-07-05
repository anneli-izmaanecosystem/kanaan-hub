import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, roomCombos, roomComboMembers } from '@/lib/db'
import { eq } from 'drizzle-orm'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const comboId = parseInt(id)
  const body = await req.json()
  const { name, capacity, rate, pricingMode, active, roomIds } = body

  const patch: Record<string, unknown> = {}
  if (name !== undefined)        patch.name = name
  if (capacity !== undefined)    patch.capacity = parseInt(capacity)
  if (rate !== undefined)        patch.rate = String(rate)
  if (pricingMode !== undefined) patch.pricingMode = pricingMode
  if (active !== undefined)      patch.active = active

  try {
    const [updated] = Object.keys(patch).length
      ? await db.update(roomCombos).set(patch).where(eq(roomCombos.id, comboId)).returning()
      : await db.select().from(roomCombos).where(eq(roomCombos.id, comboId))
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (Array.isArray(roomIds)) {
      await db.delete(roomComboMembers).where(eq(roomComboMembers.comboId, comboId))
      if (roomIds.length)
        await db.insert(roomComboMembers).values(roomIds.map((roomId: number) => ({ comboId, roomId })))
    }

    const members = await db.select().from(roomComboMembers).where(eq(roomComboMembers.comboId, comboId))
    return NextResponse.json({ ...updated, roomIds: members.map(m => m.roomId) })
  } catch (err: any) {
    console.error('[room-combos PATCH]', err)
    return NextResponse.json({ error: 'Failed to update room combo' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const [deleted] = await db.delete(roomCombos).where(eq(roomCombos.id, parseInt(id))).returning()
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
