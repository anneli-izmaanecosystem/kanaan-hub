import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, workers, entities } from '@/lib/db'
import { eq, desc } from 'drizzle-orm'
import { calculatePayroll, defaultEntry } from '@/lib/payroll'

export async function GET(_req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const runs = await db
    .select({ run: payrollRuns, entity: entities })
    .from(payrollRuns)
    .innerJoin(entities, eq(payrollRuns.entityId, entities.id))
    .orderBy(desc(payrollRuns.periodStart))

  return NextResponse.json(runs)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const { entityId, periodStart, periodEnd } = await req.json()
    if (!entityId || !periodStart || !periodEnd)
      return NextResponse.json({ error: 'Missing entityId or period dates' }, { status: 400 })

    const activeWorkers = await db
      .select()
      .from(workers)
      .where(eq(workers.entityId, parseInt(entityId)))

    const [run] = await db
      .insert(payrollRuns)
      .values({ entityId: parseInt(entityId), periodStart, periodEnd })
      .returning()

    if (activeWorkers.length > 0) {
      const entries = activeWorkers
        .filter(w => w.active)
        .map(w => {
          const entry = defaultEntry()
          const calc  = calculatePayroll(w, entry)
          return {
            runId:         run.id,
            workerId:      w.id,
            grossPay:      String(calc.grossPay),
            netPay:        String(calc.netPay),
            uifEmployee:   String(calc.uifEmployee),
            uifEmployer:   String(calc.uifEmployer),
          }
        })
      if (entries.length > 0) await db.insert(payrollEntries).values(entries)
    }

    return NextResponse.json(run, { status: 201 })
  } catch (err) {
    console.error('[payroll POST]', err)
    return NextResponse.json({ error: 'Failed to create payroll run' }, { status: 500 })
  }
}
