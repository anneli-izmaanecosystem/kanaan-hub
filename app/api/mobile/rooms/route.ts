import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { db, rooms } from '@/lib/db'
import { eq } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const rows = await db.select().from(rooms).where(eq(rooms.active, true)).orderBy(rooms.name)
  return NextResponse.json(rows)
}
