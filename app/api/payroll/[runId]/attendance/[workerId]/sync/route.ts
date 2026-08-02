import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { recalculatePayrollEntry } from '@/lib/payroll-sync'

type Params = { params: Promise<{ runId: string; workerId: string }> }

// POST — recalculate payrollEntry from saved attendance + advances, server-side
export async function POST(_req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, workerId } = await params
  const result = await recalculatePayrollEntry(parseInt(runId), parseInt(workerId))

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, grossPay: result.grossPay, netPay: result.netPay })
}
