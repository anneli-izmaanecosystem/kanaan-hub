import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, attendanceDays, publicHolidays, workers, payrollRuns } from '@/lib/db'
import { eq, and, between } from 'drizzle-orm'

type Params = { params: Promise<{ runId: string; workerId: string }> }

// GET — return all attendance days for this worker in this run's period
// Days not yet recorded are synthesised from the period so the UI always has a full calendar
export async function GET(_req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, workerId } = await params
  const rid = parseInt(runId)
  const wid = parseInt(workerId)

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, rid))
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const [worker] = await db.select().from(workers).where(eq(workers.id, wid))
  if (!worker) return NextResponse.json({ error: 'Worker not found' }, { status: 404 })

  // Saved attendance rows
  const saved = await db
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.workerId, wid), eq(attendanceDays.runId, rid)))

  // SA public holidays in period
  const holidays = await db
    .select()
    .from(publicHolidays)
    .where(between(publicHolidays.date, run.periodStart, run.periodEnd))

  const holidayDates = new Set(holidays.map(h => h.date))
  const holidayNames = Object.fromEntries(holidays.map(h => [h.date, h.name]))

  // Build full day list for the period
  const days: any[] = []
  const start = new Date(run.periodStart)
  const end   = new Date(run.periodEnd)

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0]
    const dow     = d.getUTCDay() // 0=Sun,6=Sat — use UTC to avoid server TZ skew

    const dayType = holidayDates.has(dateStr) ? 'public_holiday'
      : dow === 0 ? 'sunday'
      : dow === 6 ? 'saturday'
      : 'weekday'

    const existing = saved.find(s => s.date === dateStr)

    days.push({
      date:              dateStr,
      dayType,
      holidayName:       holidayNames[dateStr] ?? null,
      id:                existing?.id ?? null,
      hoursWorked:       existing?.hoursWorked ?? null,
      absent:            existing?.absent ?? false,
      absenceReason:     existing?.absenceReason ?? null,
      calculatedAmount:  existing?.calculatedAmount ?? null,
      phDoubleConfirmed: existing?.phDoubleConfirmed ?? null,
      source:            existing?.source ?? 'manual',
      note:              existing?.note ?? null,
    })
  }

  return NextResponse.json({ run, worker, days })
}

// POST — upsert a single attendance day
export async function POST(req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, workerId } = await params
  const rid = parseInt(runId)
  const wid = parseInt(workerId)
  const body = await req.json()

  const { date, dayType, hoursWorked, absent, absenceReason,
          calculatedAmount, phDoubleConfirmed, source, note } = body

  // Check if record exists
  const [existing] = await db
    .select()
    .from(attendanceDays)
    .where(and(eq(attendanceDays.workerId, wid), eq(attendanceDays.runId, rid), eq(attendanceDays.date, date)))

  const values = {
    workerId: wid, runId: rid, date, dayType,
    hoursWorked:       hoursWorked != null ? String(hoursWorked) : null,
    absent:            absent ?? false,
    absenceReason:     absenceReason ?? null,
    calculatedAmount:  calculatedAmount != null ? String(calculatedAmount) : null,
    phDoubleConfirmed: phDoubleConfirmed ?? null,
    source:            source ?? 'manual',
    note:              note ?? null,
  }

  if (existing) {
    const [updated] = await db
      .update(attendanceDays)
      .set(values)
      .where(eq(attendanceDays.id, existing.id))
      .returning()
    return NextResponse.json(updated)
  } else {
    const [created] = await db.insert(attendanceDays).values(values).returning()
    return NextResponse.json(created, { status: 201 })
  }
}
