import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, staffLogEntries, workers, advances, attendanceDays, payrollRuns, workerAliases } from '@/lib/db'
import { eq, and, isNull } from 'drizzle-orm'
import { recalculatePayrollEntry } from '@/lib/payroll-sync'

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
  const { entryId, workerId, action, amount: amountOverride, date: dateOverride, absent, absenceReason } = body
  // action: 'attendance' | 'advance' | 'shop' | 'skip'

  if (!entryId || !action) return NextResponse.json({ error: 'entryId and action required' }, { status: 400 })

  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId))
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  if (run.status === 'finalised' && action !== 'skip')
    return NextResponse.json({ error: 'Run is finalised — it can no longer accept staff-log entries' }, { status: 403 })

  const [entry] = await db.select().from(staffLogEntries).where(eq(staffLogEntries.id, entryId))
  if (!entry) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

  const logDate = dateOverride || entry.logDate
  // Set when an advance/shop entry is only partially applied to this run — the
  // remainder stays pending (not marked processed) so it can be applied to a later run.
  let remaining = 0

  if (action !== 'skip') {
    if (!workerId) return NextResponse.json({ error: 'workerId required for non-skip actions' }, { status: 400 })

    if (action === 'advance' || action === 'shop') {
      const logged = parseFloat(entry.amount ?? '0')
      const applied = amountOverride != null ? parseFloat(amountOverride) : logged
      if (applied > logged + 0.001)
        return NextResponse.json({ error: 'Amount cannot exceed the logged amount' }, { status: 400 })

      await db.insert(advances).values({
        workerId,
        runId,
        date: logDate,
        amount: String(applied),
        advanceType: action === 'shop' ? 'shop_deduction' : 'cash_advance',
        note: entry.message,
        source: 'manual',
      })

      remaining = logged - applied
    }

    if (action === 'note') {
      // Note-only: attach the message to that day's note without touching hours/absence.
      const dayType = dayTypeForDate(logDate)
      const [existing] = await db.select().from(attendanceDays)
        .where(and(eq(attendanceDays.workerId, workerId), eq(attendanceDays.runId, runId), eq(attendanceDays.date, logDate)))

      if (existing) {
        await db.update(attendanceDays)
          .set({ note: entry.message })
          .where(eq(attendanceDays.id, existing.id))
      } else {
        await db.insert(attendanceDays).values({
          workerId, runId, date: logDate,
          dayType,
          note: entry.message,
          source: 'manual',
        })
      }
    }

    if (action === 'attendance') {
      const dayType = dayTypeForDate(logDate)
      const isAbsent = absent ?? false
      const reason = isAbsent ? (absenceReason ?? 'unpaid') : null

      // Hours entry: upsert attendance day
      const [existing] = await db.select().from(attendanceDays)
        .where(and(eq(attendanceDays.workerId, workerId), eq(attendanceDays.runId, runId), eq(attendanceDays.date, logDate)))

      if (existing) {
        await db.update(attendanceDays)
          .set({ hoursWorked: isAbsent ? null : (entry.amount ?? existing.hoursWorked), absent: isAbsent, absenceReason: reason, dayType, note: entry.message, source: 'manual' })
          .where(eq(attendanceDays.id, existing.id))
      } else {
        await db.insert(attendanceDays).values({
          workerId, runId, date: logDate,
          dayType,
          hoursWorked: isAbsent ? null : (entry.amount ?? null),
          absent: isAbsent,
          absenceReason: reason,
          note: entry.message,
          source: 'manual',
        })
      }
    }
  }

  // Mark processed — unless an advance/shop entry was only partially applied, in which
  // case leave it pending with the reduced remaining amount so it can be picked up on a later run.
  if (remaining > 0.001) {
    await db.update(staffLogEntries)
      .set({ amount: String(remaining), workerId: workerId ?? entry.workerId })
      .where(eq(staffLogEntries.id, entryId))
  } else {
    await db.update(staffLogEntries)
      .set({ processedAt: new Date(), workerId: workerId ?? entry.workerId })
      .where(eq(staffLogEntries.id, entryId))
  }

  // Sync payroll entry so advances + attendance are reflected on the payslip immediately —
  // shared with the attendance-sync route so the two paths can't drift out of sync.
  if (action !== 'skip' && workerId) {
    try { await recalculatePayrollEntry(runId, workerId) }
    catch { /* sync is best-effort; don't fail the whole request */ }
  }

  return NextResponse.json({ ok: true, remaining })
}

// 'YYYY-MM-DD' -> weekday | saturday | sunday (no public-holiday lookup here; matches buildPeriodDays in setup/route.ts minus PH)
function dayTypeForDate(dateStr: string): 'weekday' | 'saturday' | 'sunday' {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  if (dow === 0) return 'sunday'
  if (dow === 6) return 'saturday'
  return 'weekday'
}
