import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, workers } from '@/lib/db'
import { eq } from 'drizzle-orm'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  try {
    const body = await req.json()
    const n = (v: any) => (v != null && v !== '' ? String(v) : null)

    const [updated] = await db
      .update(workers)
      .set({
        name:           body.name,
        workerType:     body.workerType,
        payStructure:   body.payStructure,
        idNumber:       n(body.idNumber),
        bankAccount:    n(body.bankAccount),
        bankName:       n(body.bankName),
        hourlyRate:     n(body.hourlyRate),
        stdHoursPerDay: n(body.stdHoursPerDay),
        dailyRate:      n(body.dailyRate),
        floorSalary:    n(body.floorSalary),
        saturdayRate:   n(body.saturdayRate),
        department:     n(body.department),
        position:       n(body.position),
        startDate:      n(body.startDate),
        active:         body.active ?? true,
        notes:          n(body.notes),
      })
      .where(eq(workers.id, parseInt(id)))
      .returning()

    return NextResponse.json(updated)
  } catch (err) {
    console.error('[workers PATCH]', err)
    return NextResponse.json({ error: 'Failed to update worker' }, { status: 500 })
  }
}
