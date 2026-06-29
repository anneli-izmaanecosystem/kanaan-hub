import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, advances } from '@/lib/db'
import { eq, and } from 'drizzle-orm'

type Params = { params: Promise<{ runId: string; workerId: string }> }

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
  const { date, amount, advanceType, note } = await req.json()

  if (!date || !advanceType || !(parseFloat(String(amount)) > 0))
    return NextResponse.json({ error: 'Missing fields or invalid amount' }, { status: 400 })

  const [row] = await db.insert(advances).values({
    workerId:    parseInt(workerId),
    runId:       parseInt(runId),
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

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  await db.delete(advances).where(eq(advances.id, parseInt(id)))
  return NextResponse.json({ ok: true })
}
