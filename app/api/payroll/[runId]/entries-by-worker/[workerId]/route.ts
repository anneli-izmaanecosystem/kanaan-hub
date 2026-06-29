import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollEntries } from '@/lib/db'
import { eq, and } from 'drizzle-orm'

type Params = { params: Promise<{ runId: string; workerId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { runId, workerId } = await params
  const [entry] = await db.select().from(payrollEntries)
    .where(and(eq(payrollEntries.runId, parseInt(runId)), eq(payrollEntries.workerId, parseInt(workerId))))
  if (!entry) return NextResponse.json(null)
  return NextResponse.json({ markedReady: entry.markedReady, markedReadyAt: entry.markedReadyAt })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { runId, workerId } = await params
  const { markedReady } = await req.json()
  const [updated] = await db.update(payrollEntries)
    .set({ markedReady, markedReadyAt: markedReady ? new Date() : null })
    .where(and(eq(payrollEntries.runId, parseInt(runId)), eq(payrollEntries.workerId, parseInt(workerId))))
    .returning()
  return NextResponse.json({ markedReady: updated.markedReady, markedReadyAt: updated.markedReadyAt })
}
