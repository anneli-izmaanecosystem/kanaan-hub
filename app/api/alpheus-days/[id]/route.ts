import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, alpheusDays, alpheusDayClients } from '@/lib/db'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// PUT /api/alpheus-days/[id] — replace day + client blocks
export async function PUT(req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const dayId = parseInt(id)

  try {
    const body = await req.json()
    const { dayDate, dayType, onsiteHours, notes, clients: clientBlocks } = body

    if (!dayDate) return NextResponse.json({ error: 'dayDate required' }, { status: 400 })
    if (!dayType) return NextResponse.json({ error: 'dayType required' }, { status: 400 })

    const [day] = await db
      .update(alpheusDays)
      .set({
        dayDate,
        dayType,
        onsiteHours: onsiteHours != null ? String(onsiteHours) : null,
        notes:       notes ?? null,
        updatedAt:   new Date(),
      })
      .where(eq(alpheusDays.id, dayId))
      .returning()

    if (!day) return NextResponse.json({ error: 'Day not found' }, { status: 404 })

    // Replace client blocks
    await db.delete(alpheusDayClients).where(eq(alpheusDayClients.dayId, dayId))

    const insertedClients = []
    if (clientBlocks?.length) {
      for (const c of clientBlocks) {
        if (!c.clientName || !c.hoursWorked)
          return NextResponse.json({ error: 'clientName and hoursWorked required per client block' }, { status: 400 })

        const [cl] = await db.insert(alpheusDayClients).values({
          dayId,
          clientName:  c.clientName,
          billingInfo: c.billingInfo ?? null,
          hoursWorked: String(c.hoursWorked),
        }).returning()

        insertedClients.push(cl)
      }
    }

    return NextResponse.json({ day, clients: insertedClients })
  } catch (err: any) {
    console.error('[alpheus-days PUT]', err)
    return NextResponse.json({ error: 'Failed to update day' }, { status: 500 })
  }
}
