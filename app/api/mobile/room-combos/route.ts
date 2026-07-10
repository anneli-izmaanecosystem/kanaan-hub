import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { db, roomCombos, roomComboMembers } from '@/lib/db'
import { inArray } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

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
