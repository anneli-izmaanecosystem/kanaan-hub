import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, workers, entities } from '@/lib/db'
import { eq, and } from 'drizzle-orm'

// Route keeps [employeeId] segment name for URL compat — it now means workerId
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string; employeeId: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, employeeId } = await params

  const [run] = await db
    .select({ run: payrollRuns, entity: entities })
    .from(payrollRuns)
    .innerJoin(entities, eq(payrollRuns.entityId, entities.id))
    .where(eq(payrollRuns.id, parseInt(runId)))

  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [row] = await db
    .select({ entry: payrollEntries, worker: workers })
    .from(payrollEntries)
    .innerJoin(workers, eq(payrollEntries.workerId, workers.id))
    .where(and(
      eq(payrollEntries.runId,    parseInt(runId)),
      eq(payrollEntries.workerId, parseInt(employeeId)),
    ))

  if (!row) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

  return NextResponse.json({
    run:    run.run,
    entity: run.entity,
    worker: row.worker,
    entry:  row.entry,
  })
}
