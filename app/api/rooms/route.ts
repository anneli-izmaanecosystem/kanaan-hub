import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, rooms } from '@/lib/db'
import { eq } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const all = req.nextUrl.searchParams.get('all') === '1'
  const result = all
    ? await db.select().from(rooms)
    : await db.select().from(rooms).where(eq(rooms.active, true))

  result.sort((a, b) => {
    const na = parseInt(a.name.match(/\d+/)?.[0] ?? '0')
    const nb = parseInt(b.name.match(/\d+/)?.[0] ?? '0')
    return na !== nb ? na - nb : a.name.localeCompare(b.name)
  })
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const { name, type, capacity, ratePp, rateSolo, pricingMode, category, bedConfig } = body

    if (!name || !type || !ratePp)
      return NextResponse.json({ error: 'Name, type and rate are required' }, { status: 400 })

    const [room] = await db.insert(rooms).values({
      name,
      type,
      capacity:    parseInt(capacity ?? '2'),
      ratePp:      String(ratePp),
      rateSolo:    rateSolo ? String(rateSolo) : null,
      pricingMode: pricingMode ?? 'flat',
      category:    category ?? null,
      bedConfig:   bedConfig ?? null,
    }).returning()

    return NextResponse.json(room, { status: 201 })
  } catch (err: any) {
    console.error('[rooms POST]', err)
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 })
  }
}
