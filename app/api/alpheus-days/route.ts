import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, alpheusDays, alpheusDayClients, fuelAllocations } from '@/lib/db'
import { desc, eq } from 'drizzle-orm'

// GET /api/alpheus-days — list all days with clients + linked fill allocations
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const days = await db.select().from(alpheusDays).orderBy(desc(alpheusDays.dayDate))
  const clients = await db.select().from(alpheusDayClients)
  const allocs = await db.select().from(fuelAllocations)

  const result = days.map(d => ({
    ...d,
    clients: clients.filter(c => c.dayId === d.id),
    // fills matched to this day (auto-matched allocations)
    linkedAllocations: allocs.filter(a => a.dayId === d.id),
  }))

  return NextResponse.json(result)
}

// POST /api/alpheus-days — log a day (with optional client blocks)
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const { dayDate, dayType, onsiteHours, notes, clients: clientBlocks, createdBy } = body

    if (!dayDate)  return NextResponse.json({ error: 'dayDate required' },  { status: 400 })
    if (!dayType)  return NextResponse.json({ error: 'dayType required' },  { status: 400 })

    const [day] = await db.insert(alpheusDays).values({
      dayDate,
      dayType,
      onsiteHours: onsiteHours != null ? String(onsiteHours) : null,
      notes:     notes ?? null,
      status:    'draft',
      createdBy: createdBy ?? null,
    }).returning()

    // Insert client blocks if provided
    const insertedClients = []
    if (clientBlocks?.length) {
      for (const c of clientBlocks) {
        if (!c.clientName || !c.hoursWorked)
          return NextResponse.json({ error: 'clientName and hoursWorked required per client block' }, { status: 400 })

        const [cl] = await db.insert(alpheusDayClients).values({
          dayId:       day.id,
          clientName:  c.clientName,
          billingInfo: c.billingInfo ?? null,
          hoursWorked: String(c.hoursWorked),
        }).returning()

        insertedClients.push(cl)
      }
    }

    // Auto-match: link unmatched offsite allocations whose fill_date = this day
    // We do this in JS to avoid a complex subquery — volume is always small
    const { fuelFills } = await import('@/lib/db')
    const { isNull, inArray } = await import('drizzle-orm')

    const fillsOnDate = await db
      .select({ id: fuelFills.id })
      .from(fuelFills)
      .where(eq(fuelFills.fillDate, dayDate))

    if (fillsOnDate.length) {
      const fillIds = fillsOnDate.map(f => f.id)
      await db
        .update(fuelAllocations)
        .set({ dayId: day.id })
        .where(
          inArray(fuelAllocations.fillId, fillIds)
        )
    }

    return NextResponse.json({ day, clients: insertedClients }, { status: 201 })
  } catch (err: any) {
    console.error('[alpheus-days POST]', err)
    return NextResponse.json({ error: 'Failed to save day' }, { status: 500 })
  }
}
