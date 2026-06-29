import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, workers, attendanceDays, alpheusDays, alpheusDayClients, publicHolidays, payrollEntries } from '@/lib/db'
import { eq, and, between } from 'drizzle-orm'

type Params = { params: Promise<{ runId: string; workerId: string }> }

// POST — import Alpheius fuel-log days into attendanceDays for this payroll run
export async function POST(_req: NextRequest, { params }: Params) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, workerId } = await params
  const rid = parseInt(runId)
  const wid = parseInt(workerId)

  const [[run], [worker]] = await Promise.all([
    db.select().from(payrollRuns).where(eq(payrollRuns.id, rid)),
    db.select().from(workers).where(eq(workers.id, wid)),
  ])

  if (!run)    return NextResponse.json({ error: 'Run not found' },    { status: 404 })
  if (!worker) return NextResponse.json({ error: 'Worker not found' }, { status: 404 })
  if (run.status === 'finalised') return NextResponse.json({ error: 'Run is finalised' }, { status: 403 })

  // Fetch alpheus days and client blocks in period
  const fuelDays = await db
    .select()
    .from(alpheusDays)
    .where(between(alpheusDays.dayDate, run.periodStart, run.periodEnd))

  const allClients = await db.select().from(alpheusDayClients)
  const holidays = await db
    .select()
    .from(publicHolidays)
    .where(between(publicHolidays.date, run.periodStart, run.periodEnd))
  const holidayDates = new Set(holidays.map(h => h.date))

  let imported = 0
  let tlbOffSiteHours = 0
  const clientSummary: Record<string, number> = {}

  for (const fd of fuelDays) {
    const dow = new Date(fd.dayDate + 'T12:00:00Z').getUTCDay()
    const dayType = holidayDates.has(fd.dayDate) ? 'public_holiday'
      : dow === 0 ? 'sunday'
      : dow === 6 ? 'saturday'
      : 'weekday'

    const clients = allClients.filter(c => c.dayId === fd.id)
    const offSiteHours = clients.reduce((s, c) => s + parseFloat(c.hoursWorked ?? '0'), 0)
    const onsiteHours  = parseFloat(fd.onsiteHours ?? '0')
    const totalHours   = offSiteHours + onsiteHours

    // Build note
    const parts: string[] = []
    if (fd.dayType === 'offsite' || fd.dayType === 'partial') {
      clients.forEach(c => { parts.push(`${c.clientName} ${c.hoursWorked}h`) })
    }
    if (fd.dayType === 'onsite' || fd.dayType === 'partial') parts.push('Kanaan')
    const note = `[Fuel] ${fd.dayType}${parts.length ? ': ' + parts.join(', ') : ''}`

    const values = {
      workerId:         wid,
      runId:            rid,
      date:             fd.dayDate,
      dayType:          dayType as any,
      hoursWorked:      totalHours > 0 ? String(totalHours) : null,
      absent:           false,
      absenceReason:    null,
      calculatedAmount: null,
      phDoubleConfirmed: null,
      source:           'manual' as any,
      note,
    }

    const [existing] = await db
      .select()
      .from(attendanceDays)
      .where(and(eq(attendanceDays.workerId, wid), eq(attendanceDays.runId, rid), eq(attendanceDays.date, fd.dayDate)))

    if (existing) {
      await db.update(attendanceDays).set(values).where(eq(attendanceDays.id, existing.id))
    } else {
      await db.insert(attendanceDays).values(values)
    }

    imported++
    tlbOffSiteHours += offSiteHours
    clients.forEach(c => {
      clientSummary[c.clientName] = (clientSummary[c.clientName] ?? 0) + parseFloat(c.hoursWorked ?? '0')
    })
  }

  // Update tlbReconSummary on payroll entry
  const [entry] = await db
    .select()
    .from(payrollEntries)
    .where(and(eq(payrollEntries.runId, rid), eq(payrollEntries.workerId, wid)))

  if (entry) {
    await db
      .update(payrollEntries)
      .set({ tlbReconSummary: JSON.stringify({ offSiteHours: tlbOffSiteHours, clients: clientSummary }) })
      .where(eq(payrollEntries.id, entry.id))
  }

  return NextResponse.json({ ok: true, imported })
}
