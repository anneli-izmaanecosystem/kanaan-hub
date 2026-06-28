import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { db, staffLogEntries, workers } from '@/lib/db'
import { desc, eq } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const workerId = req.nextUrl.searchParams.get('workerId')

  const query = db.select().from(staffLogEntries).orderBy(desc(staffLogEntries.createdAt)).limit(100)
  const rows = workerId
    ? await db.select().from(staffLogEntries).where(eq(staffLogEntries.workerId, parseInt(workerId))).orderBy(desc(staffLogEntries.createdAt)).limit(100)
    : await query

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const { workerName, workerId, logType, logDate, message, amount, createdBy } = body

    if (!workerName || !message)
      return NextResponse.json({ error: 'Worker name and message are required' }, { status: 400 })

    const today = new Date().toISOString().split('T')[0]

    const [row] = await db.insert(staffLogEntries).values({
      workerName,
      workerId:  workerId ?? null,
      logType:   logType ?? 'note',
      logDate:   logDate ?? today,
      message,
      amount:    amount != null ? String(amount) : null,
      createdBy: createdBy ?? null,
    }).returning()

    return NextResponse.json(row, { status: 201 })
  } catch (err: any) {
    console.error('[mobile/staff-log POST]', err)
    return NextResponse.json({ error: 'Failed to save staff log entry' }, { status: 500 })
  }
}
