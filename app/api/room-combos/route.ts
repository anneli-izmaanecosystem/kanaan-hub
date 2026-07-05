import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, roomCombos, roomComboMembers } from '@/lib/db'
import { eq, inArray } from 'drizzle-orm'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const combos  = await db.select().from(roomCombos)
  const members = combos.length
    ? await db.select().from(roomComboMembers).where(inArray(roomComboMembers.comboId, combos.map(c => c.id)))
    : []

  const result = combos.map(combo => ({
    ...combo,
    roomIds: members.filter(m => m.comboId === combo.id).map(m => m.roomId),
  }))
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const { name, capacity, rate, pricingMode, roomIds } = body

    if (!name || !rate || !Array.isArray(roomIds) || roomIds.length < 2)
      return NextResponse.json({ error: 'Name, rate and at least two room IDs are required' }, { status: 400 })

    const [combo] = await db.insert(roomCombos).values({
      name,
      capacity:    parseInt(capacity ?? String(roomIds.length)),
      rate:        String(rate),
      pricingMode: pricingMode ?? 'per_pax',
    }).returning()

    await db.insert(roomComboMembers).values(
      roomIds.map((roomId: number) => ({ comboId: combo.id, roomId }))
    )

    return NextResponse.json({ ...combo, roomIds }, { status: 201 })
  } catch (err: any) {
    console.error('[room-combos POST]', err)
    return NextResponse.json({ error: 'Failed to create room combo' }, { status: 500 })
  }
}
