import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, leaveBalances, workers } from '@/lib/db'
import { eq, and } from 'drizzle-orm'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params
  const id = parseInt(runId)

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id))
  if (!run)                      return NextResponse.json({ error: 'Not found' },        { status: 404 })
  if (run.status === 'finalised') return NextResponse.json({ error: 'Already finalised' }, { status: 400 })

  const entries = await db
    .select({ entry: payrollEntries, worker: workers })
    .from(payrollEntries)
    .innerJoin(workers, eq(payrollEntries.workerId, workers.id))
    .where(eq(payrollEntries.runId, id))

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
