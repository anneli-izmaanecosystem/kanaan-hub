import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, advances, payrollRuns } from '@/lib/db'
import { eq, and, isNull } from 'drizzle-orm'

type Params = { params: Promise<{ runId: string; workerId: string }> }

async function assertNotFinalised(runId: number) {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId))
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.status === 'finalised')
    return NextResponse.json({ error: 'Run is finalised — advances can no longer change' }, { status: 403 })
  return null
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, workerId } = await params
  const rows = await db
    .select()
    .from(advances)
    .where(and(eq(advances.workerId, parseInt(workerId)), eq(advances.runId, parseInt(runId))))
    .orderBy(advances.date)

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, workerId } = await params
  const rid = parseInt(runId)
  const wid = parseInt(workerId)

  const lockError = await assertNotFinalised(rid)
  if (lockError) return lockError

  const { date, amount, advanceType, note } = await req.json()

  if (!date || !advanceType || !(parseFloat(String(amount)) > 0))
    return NextResponse.json({ error: 'Missing fields or invalid amount' }, { status: 400 })

  // Dedup: an identical row for this worker/run/date/amount/type/note already exists —
  // most likely a re-upload of the same timesheet/bulk-import. Return it instead of
  // inserting a second copy that would double-count the deduction/advance.
  const [existing] = await db.select().from(advances).where(and(
    eq(advances.workerId, wid),
    eq(advances.runId, rid),
    eq(advances.date, date),
    eq(advances.amount, String(amount)),
    eq(advances.advanceType, advanceType),
    note ? eq(advances.note, note) : isNull(advances.note),
  ))
  if (existing) return NextResponse.json(existing, { status: 200 })

  const [row] = await db.insert(advances).values({
    workerId:    wid,
    runId:       rid,
    date,
    amount:      String(amount),
    advanceType,
    note:        note ?? null,
    source:      'manual',
  }).returning()

  return NextResponse.json(row, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, workerId } = await params
  const rid = parseInt(runId)
  const wid = parseInt(workerId)

  const lockError = await assertNotFinalised(rid)
  if (lockError) return lockError

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const [deleted] = await db.delete(advances)
    .where(and(eq(advances.id, parseInt(id)), eq(advances.runId, rid), eq(advances.workerId, wid)))
    .returning()
  if (!deleted) return NextResponse.json({ error: 'Not found for this run/worker' }, { status: 404 })

  return NextResponse.json({ ok: true })
}
