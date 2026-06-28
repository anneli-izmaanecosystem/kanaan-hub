import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, workers, attendanceDays, publicHolidays } from '@/lib/db'
import { eq, and, between } from 'drizzle-orm'
import { defaultEntry, calculatePayroll } from '@/lib/payroll'

// GET — run + all entries with worker info
export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const runId = parseInt(params.runId)
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId))
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const entries = await db
    .select({ entry: payrollEntries, worker: workers })
    .from(payrollEntries)
    .innerJoin(workers, eq(payrollEntries.workerId, workers.id))
    .where(eq(payrollEntries.runId, runId))

  // All active workers for the entity (for adding missing ones)
  const allWorkers = await db.select().from(workers)
    .where(eq(workers.entityId, run.entityId))

  // Count weekdays in the period for default suggestion
  const weekdays = countWeekdays(run.periodStart, run.periodEnd)

  return NextResponse.json({ run, entries, allWorkers, weekdays })
}

// POST — apply setup: update entry settings + generate default attendance
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const runId = parseInt(params.runId)
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId))
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  const body: {
    workerConfigs: {
      entryId: number
      workerId: number
      remove?: boolean
      usesTimesheet: boolean
      defaultHoursPerDay?: number | null
      defaultDaysInPeriod?: number | null
    }[]
    addWorkerIds?: number[]
  } = await req.json()

  const holidays = await db.select().from(publicHolidays)
    .where(between(publicHolidays.date, run.periodStart, run.periodEnd))
  const phSet = new Set(holidays.map(h => h.date))

  for (const cfg of body.workerConfigs) {
    if (cfg.remove) {
      await db.delete(payrollEntries).where(eq(payrollEntries.id, cfg.entryId))
      await db.delete(attendanceDays)
        .where(and(eq(attendanceDays.runId, runId), eq(attendanceDays.workerId, cfg.workerId)))
      continue
    }

    // Update entry timesheet settings
    await db.update(payrollEntries)
      .set({
        usesTimesheet:     cfg.usesTimesheet,
        defaultHoursPerDay:  cfg.defaultHoursPerDay != null ? String(cfg.defaultHoursPerDay) : null,
        defaultDaysInPeriod: cfg.defaultDaysInPeriod ?? null,
        defaultsApplied:   !cfg.usesTimesheet,
      })
      .where(eq(payrollEntries.id, cfg.entryId))

    // Generate default attendance for non-timesheet workers
    if (!cfg.usesTimesheet) {
      const [worker] = await db.select().from(workers).where(eq(workers.id, cfg.workerId))
      if (!worker) continue

      // Delete any previously generated defaults, keep manual entries
      await db.delete(attendanceDays)
        .where(and(
          eq(attendanceDays.runId, runId),
          eq(attendanceDays.workerId, cfg.workerId),
        ))

      const days = buildPeriodDays(run.periodStart, run.periodEnd, phSet)

      for (const { date, dayType } of days) {
        // For floor workers: weekdays are implicit (in floor salary), skip — only Saturdays tracked
        if (worker.payStructure === 'floor' && dayType === 'weekday') continue
        // Skip Sundays by default
        if (dayType === 'sunday') continue
        // Skip public holidays unless employee (PH is paid but attendance is a special day)
        if (dayType === 'public_holiday') continue

        const hours = worker.payStructure === 'hourly'
          ? String(cfg.defaultHoursPerDay ?? worker.stdHoursPerDay ?? '6.5')
          : null

        await db.insert(attendanceDays).values({
          runId, workerId: cfg.workerId, date, dayType,
          hoursWorked: hours,
          absent: false,
          source: 'manual',
          note: 'Default (non-timesheet)',
        }).onConflictDoNothing()
      }
    }
  }

  // Add workers not yet in the run
  if (body.addWorkerIds?.length) {
    for (const wId of body.addWorkerIds) {
      const [existing] = await db.select().from(payrollEntries)
        .where(and(eq(payrollEntries.runId, runId), eq(payrollEntries.workerId, wId)))
      if (existing) continue

      const [w] = await db.select().from(workers).where(eq(workers.id, wId))
      if (!w) continue
      const entry = defaultEntry()
      const calc  = calculatePayroll(w, entry)
      await db.insert(payrollEntries).values({
        runId, workerId: wId,
        grossPay: String(calc.grossPay), netPay: String(calc.netPay),
        uifEmployee: String(calc.uifEmployee), uifEmployer: String(calc.uifEmployer),
        usesTimesheet: true, defaultsApplied: false,
      })
    }
  }

  return NextResponse.json({ ok: true })
}

function countWeekdays(start: string, end: string): number {
  let count = 0
  const d = new Date(start)
  const e = new Date(end)
  while (d <= e) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

function buildPeriodDays(start: string, end: string, phSet: Set<string>) {
  const days: { date: string; dayType: string }[] = []
  const d = new Date(start)
  const e = new Date(end)
  while (d <= e) {
    const iso = d.toISOString().split('T')[0]
    const dow = d.getDay()
    const dayType = phSet.has(iso) ? 'public_holiday'
      : dow === 0 ? 'sunday'
      : dow === 6 ? 'saturday'
      : 'weekday'
    days.push({ date: iso, dayType })
    d.setDate(d.getDate() + 1)
  }
  return days
}
