import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, leaveBalances } from '@/lib/db'
import { eq, and } from 'drizzle-orm'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params
  const id = parseInt(runId)

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id))
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (run.status === 'finalised') return NextResponse.json({ error: 'Already finalised' }, { status: 400 })

  const entries = await db.select().from(payrollEntries).where(eq(payrollEntries.runId, id))
  const year = new Date(run.periodEnd).getFullYear()

  for (const entry of entries) {
    if (parseFloat(entry.leaveDaysTaken) > 0) {
      const [existing] = await db
        .select()
        .from(leaveBalances)
        .where(and(eq(leaveBalances.employeeId, entry.employeeId), eq(leaveBalances.year, year)))

      if (existing) {
        await db
          .update(leaveBalances)
          .set({ annualDaysTaken: String(parseFloat(existing.annualDaysTaken) + parseFloat(entry.leaveDaysTaken)) })
          .where(eq(leaveBalances.id, existing.id))
      } else {
        await db.insert(leaveBalances).values({
          employeeId: entry.employeeId,
          year,
          annualDaysTaken: entry.leaveDaysTaken,
        })
      }
    }
  }

  const [updated] = await db
    .update(payrollRuns)
    .set({ status: 'finalised' })
    .where(eq(payrollRuns.id, id))
    .returning()

  return NextResponse.json(updated)
}
