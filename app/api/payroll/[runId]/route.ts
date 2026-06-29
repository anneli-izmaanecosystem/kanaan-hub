import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, workers, attendanceDays, advances, entities } from '@/lib/db'
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

  const [entity] = await db.select().from(entities).where(eq(entities.id, run.entityId))

  const rawEntries = await db
    .select({ entry: payrollEntries, worker: workers })
    .from(payrollEntries)
    .innerJoin(workers, eq(payrollEntries.workerId, workers.id))
    .where(eq(payrollEntries.runId, id))

  // Deduplicate: keep lowest entry id per worker (guards against double-inserts)
  const seen = new Set<number>()
  const entries = rawEntries.filter(e => {
    if (seen.has(e.worker.id)) return false
    seen.add(e.worker.id)
    return true
  })

  return NextResponse.json({ run, entity: entity ?? null, entries })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId } = await params
  const id = parseInt(runId)

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id))
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (run.status === 'finalised') return NextResponse.json({ error: 'Cannot delete a finalised run' }, { status: 403 })

  await db.delete(advances).where(eq(advances.runId, id))
  await db.delete(attendanceDays).where(eq(attendanceDays.runId, id))
  await db.delete(payrollEntries).where(eq(payrollEntries.runId, id))
  await db.delete(payrollRuns).where(eq(payrollRuns.id, id))

  return NextResponse.json({ ok: true })
}
