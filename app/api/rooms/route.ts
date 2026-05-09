import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, rooms } from '@/lib/db'
import { eq } from 'drizzle-orm'

export async function GET(_req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  return NextResponse.json(await db.select().from(rooms).where(eq(rooms.active, true)).orderBy(rooms.id))
}
