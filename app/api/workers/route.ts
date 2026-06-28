import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, workers, entities } from '@/lib/db'
import { eq, and } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const entityId = searchParams.get('entityId')

  const rows = await db
    .select({ worker: workers, entity: entities })
    .from(workers)
    .innerJoin(entities, eq(workers.entityId, entities.id))
    .where(entityId ? eq(workers.entityId, parseInt(entityId)) : undefined)
    .orderBy(workers.name)

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const {
      entityId, name, workerType, payStructure,
      idNumber, bankAccount, bankName,
      hourlyRate, stdHoursPerDay,
      dailyRate,
      floorSalary, saturdayRate,
      department, position, startDate, notes,
    } = body

    if (!entityId || !name || !workerType || !payStructure)
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })

    const n = (v: any) => (v != null && v !== '' ? String(v) : null)

    // Guard against duplicates — return existing worker if same name+entity
    const [existing] = await db.select().from(workers)
      .where(and(eq(workers.entityId, parseInt(entityId)), eq(workers.name, name)))
    if (existing) return NextResponse.json(existing, { status: 200 })

    const [worker] = await db.insert(workers).values({
      entityId:       parseInt(entityId),
      name,
      workerType,
      payStructure,
      idNumber:       n(idNumber),
      bankAccount:    n(bankAccount),
      bankName:       n(bankName),
      hourlyRate:     n(hourlyRate),
      stdHoursPerDay: n(stdHoursPerDay),
      dailyRate:      n(dailyRate),
      floorSalary:    n(floorSalary),
      saturdayRate:   n(saturdayRate),
      department:     n(department),
      position:       n(position),
      startDate:      n(startDate),
      notes:          n(notes),
    }).returning()

    return NextResponse.json(worker, { status: 201 })
  } catch (err) {
    console.error('[workers POST]', err)
    return NextResponse.json({ error: 'Failed to create worker' }, { status: 500 })
  }
}
