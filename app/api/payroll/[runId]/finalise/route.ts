import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, leaveBalances, workers } from '@/lib/db'
import { eq, and } from 'drizzle-orm'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params
  const id = parseInt(runId)
  const force = new URL(req.url).searchParams.get('force') === 'true'

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id))
  if (!run)                      return NextResponse.json({ error: 'Not found' },        { status: 404 })
  if (run.status === 'finalised') return NextResponse.json({ error: 'Already finalised' }, { status: 400 })

  const entries = await db
    .select({ entry: payrollEntries, worker: workers })
    .from(payrollEntries)
    .innerJoin(workers, eq(payrollEntries.workerId, workers.id))
    .where(eq(payrollEntries.runId, id))

  // Fix 2: warn if any entry has zero/null grossPay (unless ?force=true)
  if (!force) {
    const zeroPay = entries.filter(({ entry }) => {
      const g = parseFloat(entry.grossPay ?? '0')
      return isNaN(g) || g === 0
    })
    if (zeroPay.length > 0) {
      const names = zeroPay.map(({ worker }) => worker.name).join(', ')
      return NextResponse.json(
        { error: `The following workers have R 0 gross pay — check attendance first: ${names}` },
        { status: 422 },
      )
    }
  }

  const year = new Date(run.periodEnd).getFullYear()

  // Update leave balances for employees only
  for (const { entry, worker } of entries) {
    if (worker.workerType !== 'employee') continue

    const annualTaken = parseFloat(entry.annualLeaveDaysTaken ?? '0')
    const sickTaken   = parseFloat(entry.sickLeaveDaysTaken   ?? '0')
    if (annualTaken === 0 && sickTaken === 0) continue

    const [existing] = await db
      .select()
      .from(leaveBalances)
      .where(and(eq(leaveBalances.workerId, entry.workerId), eq(leaveBalances.year, year)))

    if (existing) {
      await db.update(leaveBalances).set({
        annualDaysTaken: String(parseFloat(existing.annualDaysTaken) + annualTaken),
        sickDaysTaken:   String(parseFloat(existing.sickDaysTaken)   + sickTaken),
      }).where(eq(leaveBalances.id, existing.id))
    } else {
      await db.insert(leaveBalances).values({
        workerId: entry.workerId,
        year,
        annualDaysTaken: String(annualTaken),
        sickDaysTaken:   String(sickTaken),
      })
    }
  }

  const [updated] = await db
    .update(payrollRuns)
    .set({ status: 'finalised' })
    .where(eq(payrollRuns.id, id))
    .returning()

  return NextResponse.json(updated)
}
