import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, staffLogEntries, workers, advances, attendanceDays, payrollRuns, workerAliases } from '@/lib/db'
import { eq, and, isNull } from 'drizzle-orm'

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
  const { entryId, workerId, action } = body
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
        amount: entry.amount ?? '0',
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

  return NextResponse.json({ ok: true })
}
