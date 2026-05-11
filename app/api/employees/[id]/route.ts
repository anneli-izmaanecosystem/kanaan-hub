import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, employees } from '@/lib/db'
import { eq } from 'drizzle-orm'

const NUMERIC = ['monthlySalary','hourlyRate','fixedHours','overtimeHourlyRate','transportAllowance','housingAllowance','otherAllowance']

function sanitise(body: Record<string, any>) {
  const out: Record<string, any> = { ...body }
  for (const f of NUMERIC) {
    if (f in out) out[f] = out[f] === '' || out[f] == null ? null : String(out[f])
  }
  if ('startDate' in out && out.startDate === '') out.startDate = null
  return out
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  try {
    const body = sanitise(await req.json())
    const [updated] = await db
      .update(employees)
      .set(body)
      .where(eq(employees.id, parseInt(id)))
      .returning()
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (err: any) {
    console.error('[employee PATCH]', err.message)
    return NextResponse.json({ error: 'Failed to update employee' }, { status: 500 })
  }
}
