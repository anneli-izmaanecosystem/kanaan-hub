import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollEntries, workers, payrollRuns, advances } from '@/lib/db'
import { round2 } from '@/lib/payroll'

// TEMPORARY — read-only audit for the stale-netPay bug fixed in
// attendance/[workerId]/sync/route.ts (advances not summed before the
// floor/fuel-log branch's early return). Delete once the affected runs
// have been re-synced. Lists floor-structure workers whose stored netPay
// doesn't match gross - salaryAdvance - shopDeductions - otherDeductions - uifEmployee.
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const [entries, allWorkers, allRuns, allAdvances] = await Promise.all([
    db.select().from(payrollEntries),
    db.select().from(workers),
    db.select().from(payrollRuns),
    db.select().from(advances),
  ])

  const workerById = new Map(allWorkers.map(w => [w.id, w]))
  const runById = new Map(allRuns.map(r => [r.id, r]))

  const mismatches: Array<{
    workerId: number; workerName: string; runId: number;
    periodStart: string; periodEnd: string; runStatus: string;
    storedNetPay: number; expectedNetPay: number;
    grossPay: number; salaryAdvance: number; shopDeductions: number;
    otherDeductions: number; uifEmployee: number;
  }> = []

  for (const e of entries) {
    const w = workerById.get(e.workerId)
    if (!w || w.payStructure !== 'floor') continue

    const advRows = allAdvances.filter(a => a.workerId === e.workerId && a.runId === e.runId)
    if (advRows.length === 0) continue

    const salaryAdvance = round2(advRows.filter(a => a.advanceType === 'cash_advance').reduce((s, a) => s + parseFloat(a.amount), 0))
    const shopDeductions = round2(advRows.filter(a => a.advanceType === 'shop_deduction').reduce((s, a) => s + parseFloat(a.amount), 0))
    const otherDeductions = parseFloat(e.otherDeductions ?? '0')
    const uifEmployee = parseFloat(e.uifEmployee ?? '0')
    const grossPay = parseFloat(e.grossPay ?? '0')

    const expectedNetPay = round2(grossPay - salaryAdvance - shopDeductions - otherDeductions - uifEmployee)
    const storedNetPay = round2(parseFloat(e.netPay ?? '0'))

    if (Math.abs(expectedNetPay - storedNetPay) > 0.01) {
      const run = runById.get(e.runId)
      mismatches.push({
        workerId: w.id, workerName: w.name, runId: e.runId,
        periodStart: String(run?.periodStart ?? ''), periodEnd: String(run?.periodEnd ?? ''),
        runStatus: run?.status ?? '',
        storedNetPay, expectedNetPay,
        grossPay, salaryAdvance, shopDeductions, otherDeductions, uifEmployee,
      })
    }
  }

  return NextResponse.json({ count: mismatches.length, mismatches })
}
