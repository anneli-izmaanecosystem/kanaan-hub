import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, rooms } from '@/lib/db'
import { eq } from 'drizzle-orm'

export async function GET(_req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const result = await db.select().from(rooms).where(eq(rooms.active, true))
  result.sort((a, b) => {
    const na = parseInt(a.name.match(/\d+/)?.[0] ?? '0')
    const nb = parseInt(b.name.match(/\d+/)?.[0] ?? '0')
    return na !== nb ? na - nb : a.name.localeCompare(b.name)
  })
  return NextResponse.json(result)
}
