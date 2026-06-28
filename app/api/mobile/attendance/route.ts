import { NextRequest, NextResponse } from 'next/server'
import { checkMobileAuth } from '@/lib/mobile-auth'
import { db, attendanceDays, payrollRuns, workers, publicHolidays } from '@/lib/db'
import { eq, and, between } from 'drizzle-orm'

// GET /api/mobile/attendance?runId=X&workerId=Y
// Returns the full day list for the period with saved attendance merged in
export async function GET(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const runId    = req.nextUrl.searchParams.get('runId')
  const workerId = req.nextUrl.searchParams.get('workerId')
  if (!runId || !workerId)
    return NextResponse.json({ error: 'runId and workerId required' }, { status: 400 })

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, parseInt(runId)))
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const [worker] = await db.select().from(workers).where(eq(workers.id, parseInt(workerId)))
  if (!worker) return NextResponse.json({ error: 'Worker not found' }, { status: 404 })

  const saved = await db.select().from(attendanceDays)
    .where(and(eq(attendanceDays.runId, parseInt(runId)), eq(attendanceDays.workerId, parseInt(workerId))))

  const holidays = await db.select().from(publicHolidays)
    .where(between(publicHolidays.date, run.periodStart, run.periodEnd))

  const phSet = new Set(holidays.map(h => h.date))
  const savedMap = new Map(saved.map(d => [d.date, d]))

  // Build full day list for period
  const days = []
  const start = new Date(run.periodStart)
  const end   = new Date(run.periodEnd)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const iso = d.toISOString().split('T')[0]
    const dow = d.getDay() // 0=Sun, 6=Sat
    const dayType = phSet.has(iso) ? 'public_holiday' : dow === 0 ? 'sunday' : dow === 6 ? 'saturday' : 'weekday'
    const saved_ = savedMap.get(iso)
    days.push({
      date: iso,
      dayType,
      saved: saved_ ?? null,
    })
  }

  return NextResponse.json({ run, worker, days })
}

// POST /api/mobile/attendance — upsert a single attendance day
export async function POST(req: NextRequest) {
  if (!checkMobileAuth(req)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const { runId, workerId, date, dayType, hoursWorked, absent, absenceReason, note } = body

    if (!runId || !workerId || !date)
      return NextResponse.json({ error: 'runId, workerId, date required' }, { status: 400 })

    const [existing] = await db.select().from(attendanceDays)
      .where(and(
        eq(attendanceDays.runId,     runId),
        eq(attendanceDays.workerId,  workerId),
        eq(attendanceDays.date,      date),
      ))

    if (existing) {
      const [updated] = await db.update(attendanceDays)
        .set({ dayType, hoursWorked: hoursWorked ?? null, absent: absent ?? false, absenceReason: absenceReason ?? null, note: note ?? null, source: 'manual' })
        .where(eq(attendanceDays.id, existing.id))
        .returning()
      return NextResponse.json(updated)
    } else {
      const [created] = await db.insert(attendanceDays).values({
        runId, workerId, date, dayType: dayType ?? 'weekday',
        hoursWorked: hoursWorked ?? null,
        absent: absent ?? false,
        absenceReason: absenceReason ?? null,
        note: note ?? null,
        source: 'manual',
      }).returning()
      return NextResponse.json(created, { status: 201 })
    }
  } catch (err: any) {
    console.error('[mobile/attendance POST]', err)
    return NextResponse.json({ error: 'Failed to save attendance' }, { status: 500 })
  }
}
