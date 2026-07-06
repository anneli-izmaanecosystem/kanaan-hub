import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, attendanceDays, workers, payrollRuns } from '@/lib/db'
import { eq, and, inArray, ne } from 'drizzle-orm'

// TEMPORARY — one-time cleanup for the Saturday-default-attendance bug fixed in
// setup/route.ts. Before that fix, hourly/daily workers got a full "worked" Saturday
// row pre-created at run setup (note: 'Default (non-timesheet)', absent: false, hours
// set), so Saturdays were paid by default instead of defaulting to absent. This deletes
// those specific rows from every open (non-finalised) run so the fixed default-absent
// logic in the GET/sync routes applies again. After running this, click "Recalculate
// All" on each affected run to correct its stored payroll totals. Delete this route
// once you've run it.
//
// GET works too (not just POST), so this can be triggered by just visiting the URL
// in a browser while logged in — no devtools or API client needed.
export async function GET() {
  return run()
}

export async function POST() {
  return run()
}

async function run() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const rows = await db
    .select({
      id:         attendanceDays.id,
      runId:      attendanceDays.runId,
      workerName: workers.name,
      date:       attendanceDays.date,
    })
    .from(attendanceDays)
    .innerJoin(workers, eq(attendanceDays.workerId, workers.id))
    .innerJoin(payrollRuns, eq(attendanceDays.runId, payrollRuns.id))
    .where(and(
      eq(attendanceDays.dayType, 'saturday'),
      eq(attendanceDays.note, 'Default (non-timesheet)'),
      inArray(workers.payStructure, ['hourly', 'daily']),
      ne(payrollRuns.status, 'finalised'),
    ))

  if (rows.length === 0) {
    return NextResponse.json({ deleted: 0, affectedRuns: [] })
  }

  await db.delete(attendanceDays).where(inArray(attendanceDays.id, rows.map(r => r.id)))

  const affectedRuns = Array.from(new Set(rows.map(r => r.runId))).map(runId => ({
    runId,
    workers: Array.from(new Set(rows.filter(r => r.runId === runId).map(r => r.workerName))),
    datesCleared: rows.filter(r => r.runId === runId).map(r => r.date),
  }))

  return NextResponse.json({ deleted: rows.length, affectedRuns })
}
