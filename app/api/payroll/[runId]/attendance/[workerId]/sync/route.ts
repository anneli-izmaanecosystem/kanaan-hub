import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, workers, attendanceDays, advances, publicHolidays } from '@/lib/db'
import { eq, and, between } from 'drizzle-orm'
import { calculatePayroll, defaultEntry } from '@/lib/payroll'

type Params = { params: Promise<{ runId: string; workerId: string }> }

// POST — recalculate payrollEntry from saved attendance + advances, server-side
export async function POST(_req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, workerId } = await params
  const rid = parseInt(runId)
  const wid = parseInt(workerId)

  const [[run], [worker], savedDays, advRows, [entry]] = await Promise.all([
    db.select().from(payrollRuns).where(eq(payrollRuns.id, rid)),
    db.select().from(workers).where(eq(workers.id, wid)),
    db.select().from(attendanceDays).where(and(eq(attendanceDays.runId, rid), eq(attendanceDays.workerId, wid))),
    db.select().from(advances).where(and(eq(advances.runId, rid), eq(advances.workerId, wid))),
    db.select().from(payrollEntries).where(and(eq(payrollEntries.runId, rid), eq(payrollEntries.workerId, wid))),
  ])

  if (!run)    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (!worker) return NextResponse.json({ error: 'Worker not found' }, { status: 404 })
  if (!entry)  return NextResponse.json({ error: 'No payroll entry for this worker in this run' }, { status: 404 })

  // Build full period calendar — same logic as the attendance GET route
  // so that unsaved days (default: present, stdHoursPerDay) are included
  // Normalise a date value that may be a Date object or ISO/YYYY-MM-DD string → YYYY-MM-DD
  const toDateStr = (v: unknown): string =>
    v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)

  const holidays = await db.select().from(publicHolidays)
    .where(between(publicHolidays.date, run.periodStart, run.periodEnd))
  const holidayDates = new Set(holidays.map(h => toDateStr(h.date)))

  const allDays: {
    date: string; dayType: string; absent: boolean; absenceReason: string | null;
    hoursWorked: string | null; phDoubleConfirmed: boolean | null;
  }[] = []

  const periodStart = toDateStr(run.periodStart)
  const periodEnd   = toDateStr(run.periodEnd)

  for (let d = new Date(periodStart); d <= new Date(periodEnd); d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0]
    const dow     = d.getUTCDay()
    const dayType = holidayDates.has(dateStr) ? 'public_holiday'
      : dow === 0 ? 'sunday'
      : dow === 6 ? 'saturday'
      : 'weekday'

    const saved = savedDays.find(s => toDateStr(s.date) === dateStr)
    allDays.push({
      date:               dateStr,
      dayType,
      absent:             saved?.absent ?? false,
      absenceReason:      saved?.absenceReason ?? null,
      hoursWorked:        saved?.hoursWorked ?? null,
      phDoubleConfirmed:  saved?.phDoubleConfirmed ?? null,
    })
  }

  // Build EntryInput from full calendar — preserve manually-entered bonus/additions
  const ei = defaultEntry()
  ei.bonus          = parseFloat(entry.bonus          ?? '0')
  ei.otherAdditions = parseFloat(entry.otherAdditions ?? '0')
  ei.otherDeductions= parseFloat(entry.otherDeductions ?? '0')

  // If any day was imported from a photo timesheet, that timesheet is the source of truth.
  // Only count explicitly saved days — unsaved days contribute 0 (not stdHoursPerDay default).
  const timesheetMode = savedDays.some(d => d.source === 'photo_timesheet')
  const savedDates    = new Set(savedDays.map(s => toDateStr(s.date)))

  for (const d of allDays) {
    // In timesheet mode, skip days not saved to DB — they were not on the timesheet
    if (timesheetMode && !savedDates.has(d.date)) continue

    if (d.absent) {
      if (d.absenceReason === 'unpaid')       ei.unpaidLeaveDays      += 1
      if (d.absenceReason === 'annual_leave') ei.annualLeaveDaysTaken += 1
      if (d.absenceReason === 'sick')         ei.sickLeaveDaysTaken   += 1
      continue
    }

    // Sundays: skip unless saved with hours (explicit override)
    if (d.dayType === 'sunday' && d.hoursWorked === null) continue

    if (worker.payStructure === 'hourly') {
      const hrs = parseFloat(d.hoursWorked ?? worker.stdHoursPerDay ?? '0')
      if      (d.dayType === 'saturday')       ei.saturdayHours += hrs
      else if (d.dayType === 'public_holiday') {
        // Only accumulate in phHours (×2) when user confirmed double pay
        if (d.phDoubleConfirmed) ei.phHours       += hrs
        else                     ei.ordinaryHours += hrs
      }
      else                                     ei.ordinaryHours += hrs

    } else if (worker.payStructure === 'daily') {
      if      (d.dayType === 'saturday')       ei.saturdayDays += 1
      else if (d.dayType === 'sunday')         { /* no pay */ }
      else if (d.dayType === 'public_holiday') ei.daysWorked   += 1
      else                                     ei.daysWorked   += 1

    } else if (worker.payStructure === 'floor') {
      if (d.dayType === 'saturday') ei.saturdayDays += 1
    }
  }

  // Advances
  for (const a of advRows) {
    const amt = parseFloat(a.amount ?? '0')
    if (a.advanceType === 'cash_advance')   ei.salaryAdvance  += amt
    if (a.advanceType === 'shop_deduction') ei.shopDeductions += amt
  }

  const calc = calculatePayroll(worker, ei)

  const [updated] = await db
    .update(payrollEntries)
    .set({
      ordinaryHours:        String(ei.ordinaryHours),
      saturdayHours:        String(ei.saturdayHours),
      phHours:              String(ei.phHours),
      daysWorked:           String(ei.daysWorked),
      saturdayDays:         String(ei.saturdayDays),
      salaryAdvance:        String(ei.salaryAdvance),
      shopDeductions:       String(ei.shopDeductions),
      otherDeductions:      String(ei.otherDeductions),
      annualLeaveDaysTaken: String(ei.annualLeaveDaysTaken),
      sickLeaveDaysTaken:   String(ei.sickLeaveDaysTaken),
      basicPay:             String(calc.basicPay),
      saturdayPay:          String(calc.saturdayPay),
      phPay:                String(calc.phPay),
      grossPay:             String(calc.grossPay),
      uifEmployee:          String(calc.uifEmployee),
      uifEmployer:          String(calc.uifEmployer),
      netPay:               String(calc.netPay),
      payeTaxableAmount:    calc.payeThresholdFlag ? String(calc.grossPay) : null,
    })
    .where(eq(payrollEntries.id, entry.id))
    .returning()

  return NextResponse.json({ ok: true, grossPay: calc.grossPay, netPay: calc.netPay })
}
