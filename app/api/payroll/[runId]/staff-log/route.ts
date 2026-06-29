import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, staffLogEntries, workers, advances, attendanceDays, payrollRuns, workerAliases, payrollEntries } from '@/lib/db'
import { eq, and, isNull } from 'drizzle-orm'
import { calculatePayroll, defaultEntry } from '@/lib/payroll'

// GET — unprocessed staff log entries, with fuzzy worker matching via aliases
export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId: runIdStr } = await params
  const runId = parseInt(runIdStr)
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId))
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })

  // All unprocessed entries (no workerId linked yet OR not yet processed)
  const entries = await db.select().from(staffLogEntries)
    .where(isNull(staffLogEntries.processedAt))
    .orderBy(staffLogEntries.logDate)

  // Load all workers + aliases for matching suggestions
  const allWorkers = await db.select({ worker: workers, alias: workerAliases })
    .from(workers)
    .leftJoin(workerAliases, eq(workerAliases.workerId, workers.id))
    .where(eq(workers.active, true))

  // Build alias → workerId map
  const aliasMap: Record<string, number> = {}
  for (const { worker, alias } of allWorkers) {
    aliasMap[worker.name.toLowerCase()] = worker.id
    if (alias) aliasMap[alias.alias.toLowerCase()] = worker.id
  }

  // Deduplicate workers list
  const workerList = Array.from(
    new Map(allWorkers.map(({ worker }) => [worker.id, worker])).values()
  )

  // Attach suggested workerId to each entry
  const enriched = entries.map(e => ({
    ...e,
    suggestedWorkerId: aliasMap[e.workerName.toLowerCase().trim()] ?? null,
  }))

  return NextResponse.json({ run, entries: enriched, workers: workerList })
}

// POST — process one entry: write to attendanceDays or advances, mark processed
export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId: runIdStr } = await params
  const runId = parseInt(runIdStr)
  const body = await req.json()
  const { entryId, workerId, action, amount: amountOverride } = body
  // action: 'attendance' | 'advance' | 'shop' | 'skip'

  if (!entryId || !action) return NextResponse.json({ error: 'entryId and action required' }, { status: 400 })

  const [entry] = await db.select().from(staffLogEntries).where(eq(staffLogEntries.id, entryId))
  if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

  if (action !== 'skip') {
    if (!workerId) return NextResponse.json({ error: 'workerId required for non-skip actions' }, { status: 400 })

    if (action === 'advance' || action === 'shop') {
      await db.insert(advances).values({
        workerId,
        runId,
        date: entry.logDate,
        amount: amountOverride != null ? String(amountOverride) : (entry.amount ?? '0'),
        advanceType: action === 'shop' ? 'shop_deduction' : 'cash_advance',
        note: entry.message,
        source: 'manual',
      })
    }

    if (action === 'attendance') {
      // Hours entry: upsert attendance day
      const [existing] = await db.select().from(attendanceDays)
        .where(and(eq(attendanceDays.workerId, workerId), eq(attendanceDays.runId, runId), eq(attendanceDays.date, entry.logDate)))

      if (existing) {
        await db.update(attendanceDays)
          .set({ hoursWorked: entry.amount ?? existing.hoursWorked, note: entry.message, source: 'manual' })
          .where(eq(attendanceDays.id, existing.id))
      } else {
        await db.insert(attendanceDays).values({
          workerId, runId, date: entry.logDate,
          dayType: 'weekday',
          hoursWorked: entry.amount ?? null,
          absent: false,
          note: entry.message,
          source: 'manual',
        })
      }
    }
  }

  // Mark processed
  await db.update(staffLogEntries)
    .set({ processedAt: new Date(), workerId: workerId ?? entry.workerId })
    .where(eq(staffLogEntries.id, entryId))

  // Sync payroll entry so advances + attendance are reflected on the payslip immediately
  if (action !== 'skip' && workerId) {
    try {
      const [[worker], days, advRows, [pEntry]] = await Promise.all([
        db.select().from(workers).where(eq(workers.id, workerId)),
        db.select().from(attendanceDays).where(and(eq(attendanceDays.runId, runId), eq(attendanceDays.workerId, workerId))),
        db.select().from(advances).where(and(eq(advances.runId, runId), eq(advances.workerId, workerId))),
        db.select().from(payrollEntries).where(and(eq(payrollEntries.runId, runId), eq(payrollEntries.workerId, workerId))),
      ])

      if (worker && pEntry) {
        const ei = defaultEntry()
        for (const d of days) {
          if (d.absent) {
            if (d.absenceReason === 'unpaid')       ei.unpaidLeaveDays      += 1
            if (d.absenceReason === 'annual_leave') ei.annualLeaveDaysTaken += 1
            if (d.absenceReason === 'sick')         ei.sickLeaveDaysTaken   += 1
            continue
          }
          if (worker.payStructure === 'hourly') {
            const hrs = parseFloat(d.hoursWorked ?? worker.stdHoursPerDay ?? '0')
            if      (d.dayType === 'saturday')       ei.saturdayHours += hrs
            else if (d.dayType === 'public_holiday') ei.phHours       += hrs
            else                                     ei.ordinaryHours += hrs
          } else if (worker.payStructure === 'daily') {
            if (d.dayType !== 'sunday') ei.daysWorked += 1
          } else if (worker.payStructure === 'floor') {
            if (d.dayType === 'saturday') ei.saturdayDays += 1
          }
        }
        for (const a of advRows) {
          const amt = parseFloat(a.amount ?? '0')
          if (a.advanceType === 'cash_advance')   ei.salaryAdvance  += amt
          if (a.advanceType === 'shop_deduction') ei.shopDeductions += amt
        }
        const calc = calculatePayroll(worker, ei)
        await db.update(payrollEntries).set({
          ordinaryHours: String(ei.ordinaryHours), saturdayHours: String(ei.saturdayHours),
          phHours: String(ei.phHours), daysWorked: String(ei.daysWorked), saturdayDays: String(ei.saturdayDays),
          salaryAdvance: String(ei.salaryAdvance), shopDeductions: String(ei.shopDeductions),
          annualLeaveDaysTaken: String(ei.annualLeaveDaysTaken), sickLeaveDaysTaken: String(ei.sickLeaveDaysTaken),
          basicPay: String(calc.basicPay), saturdayPay: String(calc.saturdayPay), phPay: String(calc.phPay),
          grossPay: String(calc.grossPay), uifEmployee: String(calc.uifEmployee), uifEmployer: String(calc.uifEmployer),
          netPay: String(calc.netPay),
        }).where(eq(payrollEntries.id, pEntry.id))
      }
    } catch { /* sync is best-effort; don't fail the whole request */ }
  }

  return NextResponse.json({ ok: true })
}
