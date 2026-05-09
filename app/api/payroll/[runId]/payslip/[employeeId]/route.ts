import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, employees } from '@/lib/db'
import { eq, and } from 'drizzle-orm'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string; employeeId: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, employeeId } = await params

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, parseInt(runId)))
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [row] = await db
    .select({ entry: payrollEntries, employee: employees })
    .from(payrollEntries)
    .innerJoin(employees, eq(payrollEntries.employeeId, employees.id))
    .where(and(
      eq(payrollEntries.runId, parseInt(runId)),
      eq(payrollEntries.employeeId, parseInt(employeeId)),
    ))

  if (!row) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

  return NextResponse.json({ run, ...row })
}
