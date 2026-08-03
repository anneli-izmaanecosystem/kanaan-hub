import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, workers, entities } from '@/lib/db'
import { eq, and, ne } from 'drizzle-orm'

async function employeeRowsForRun(rid: number) {
  // employees only — contractors have no UIF obligation
  const rows = await db
    .select({ entry: payrollEntries, worker: workers })
    .from(payrollEntries)
    .innerJoin(workers, eq(payrollEntries.workerId, workers.id))
    .where(and(
      eq(payrollEntries.runId, rid),
      ne(workers.workerType, 'contractor'),
    ))

  return rows.map(r => ({
    id:           r.worker.id,
    name:         r.worker.name,
    idNumber:     r.worker.idNumber,
    grossPay:     r.entry.grossPay,
    uifEmployee:  r.entry.uifEmployee,
    uifEmployer:  r.entry.uifEmployer,
  }))
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params
  const rid = parseInt(runId)

  const [runRow] = await db
    .select({ run: payrollRuns, entity: entities })
    .from(payrollRuns)
    .innerJoin(entities, eq(payrollRuns.entityId, entities.id))
    .where(eq(payrollRuns.id, rid))

  if (!runRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const employees = await employeeRowsForRun(rid)

  // Plant Hire has no UIF registration of its own yet — its employee(s) ride on
  // Kanaan's UIF schedule for the time being, matched by pay period.
  if (runRow.entity.entityType === 'kanaan') {
    const [plantHireRun] = await db
      .select({ run: payrollRuns, entity: entities })
      .from(payrollRuns)
      .innerJoin(entities, eq(payrollRuns.entityId, entities.id))
      .where(and(
        eq(entities.entityType, 'plant_hire'),
        eq(payrollRuns.periodStart, runRow.run.periodStart),
        eq(payrollRuns.periodEnd, runRow.run.periodEnd),
      ))

    if (plantHireRun) {
      employees.push(...await employeeRowsForRun(plantHireRun.run.id))
    }
  }

  const totals = employees.reduce((acc, e) => ({
    grossPay:    (parseFloat(acc.grossPay)    + parseFloat(e.grossPay   )).toFixed(2),
    uifEmployee: (parseFloat(acc.uifEmployee) + parseFloat(e.uifEmployee)).toFixed(2),
    uifEmployer: (parseFloat(acc.uifEmployer) + parseFloat(e.uifEmployer)).toFixed(2),
  }), { grossPay: '0', uifEmployee: '0', uifEmployer: '0' })

  return NextResponse.json({
    run:       runRow.run,
    entity:    runRow.entity,
    employees,
    totals,
  })
}
