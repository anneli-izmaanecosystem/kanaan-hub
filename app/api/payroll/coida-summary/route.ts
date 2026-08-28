import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, workers, entities } from '@/lib/db'
import { eq, and, gte, lte, ne, inArray } from 'drizzle-orm'

// GET /api/payroll/coida-summary?start=YYYY-MM-DD&end=YYYY-MM-DD
// Sums gross pay / deductions / net pay / UIF per employee across every finalised
// run (any entity) whose period falls within [start, end] — the same shape as the
// COIDA Return of Earnings needs, computed live instead of hand-built in a sheet.
// Contractors are excluded — COIDA covers employees.
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const start = searchParams.get('start')
  const end   = searchParams.get('end')
  if (!start || !end) return NextResponse.json({ error: 'Missing start/end date' }, { status: 400 })

  const runs = await db
    .select({ run: payrollRuns, entity: entities })
    .from(payrollRuns)
    .innerJoin(entities, eq(payrollRuns.entityId, entities.id))
    .where(and(
      gte(payrollRuns.periodStart, start),
      lte(payrollRuns.periodEnd, end),
    ))

  const runIds = runs.map(r => r.run.id)
  if (runIds.length === 0) {
    return NextResponse.json({ employees: [], totals: { grossPay: '0', deductions: '0', netPay: '0', uifEmployee: '0' }, runsIncluded: 0 })
  }

  const rows = await db
    .select({ entry: payrollEntries, worker: workers, run: payrollRuns })
    .from(payrollEntries)
    .innerJoin(workers, eq(payrollEntries.workerId, workers.id))
    .innerJoin(payrollRuns, eq(payrollEntries.runId, payrollRuns.id))
    .where(and(
      inArray(payrollEntries.runId, runIds),
      ne(workers.workerType, 'contractor'),
    ))

  // Aggregate per worker
  const byWorker = new Map<number, {
    id: number; name: string; idNumber: string | null
    grossPay: number; deductions: number; netPay: number; uifEmployee: number
  }>()

  for (const { entry, worker } of rows) {
    const gross  = parseFloat(entry.grossPay)
    const net    = parseFloat(entry.netPay)
    const ded    = parseFloat(entry.salaryAdvance) + parseFloat(entry.shopDeductions) + parseFloat(entry.otherDeductions)
    const uif    = parseFloat(entry.uifEmployee)

    const acc = byWorker.get(worker.id) ?? { id: worker.id, name: worker.name, idNumber: worker.idNumber, grossPay: 0, deductions: 0, netPay: 0, uifEmployee: 0 }
    acc.grossPay    += gross
    acc.deductions  += ded
    acc.netPay      += net
    acc.uifEmployee += uif
    byWorker.set(worker.id, acc)
  }

  const employees = Array.from(byWorker.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(e => ({
      ...e,
      grossPay:    e.grossPay.toFixed(2),
      deductions:  e.deductions.toFixed(2),
      netPay:      e.netPay.toFixed(2),
      uifEmployee: e.uifEmployee.toFixed(2),
    }))

  const totals = employees.reduce((acc, e) => ({
    grossPay:    acc.grossPay    + parseFloat(e.grossPay),
    deductions:  acc.deductions  + parseFloat(e.deductions),
    netPay:      acc.netPay      + parseFloat(e.netPay),
    uifEmployee: acc.uifEmployee + parseFloat(e.uifEmployee),
  }), { grossPay: 0, deductions: 0, netPay: 0, uifEmployee: 0 })

  return NextResponse.json({
    employees,
    totals: {
      grossPay:    totals.grossPay.toFixed(2),
      deductions:  totals.deductions.toFixed(2),
      netPay:      totals.netPay.toFixed(2),
      uifEmployee: totals.uifEmployee.toFixed(2),
    },
    runsIncluded: runIds.length,
  })
}
