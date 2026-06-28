import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, workers } from '@/lib/db'
import { eq } from 'drizzle-orm'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params
  const id = parseInt(runId)

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id))
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const entries = await db
    .select({ entry: payrollEntries, worker: workers })
    .from(payrollEntries)
    .innerJoin(workers, eq(payrollEntries.workerId, workers.id))
    .where(eq(payrollEntries.runId, id))

  return NextResponse.json({ run, entries })
}
