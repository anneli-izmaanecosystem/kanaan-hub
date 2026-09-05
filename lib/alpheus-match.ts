import { db, fuelFills, fuelAllocations, alpheusDays } from '@/lib/db'
import { and, eq, inArray, isNull } from 'drizzle-orm'

// Alpheus logs his fuel fills in the morning or the evening, so a fill dated the
// calendar day AFTER a logged workday still belongs to that workday. Every match in
// this file treats {dayDate, dayDate+1} as one matching window.
function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().split('T')[0]
}

// Find the alpheus_days row a fill belongs to — same-day match preferred, falling
// back to the workday before it (i.e. this fill was logged the morning after).
export async function findDayForFill(fillDate: string): Promise<number | null> {
  const [exact] = await db.select({ id: alpheusDays.id }).from(alpheusDays)
    .where(eq(alpheusDays.dayDate, fillDate)).limit(1)
  if (exact) return exact.id

  const [dayBefore] = await db.select({ id: alpheusDays.id }).from(alpheusDays)
    .where(eq(alpheusDays.dayDate, addDays(fillDate, -1))).limit(1)
  return dayBefore?.id ?? null
}

// Link any still-unmatched off-site allocations from Alpheus's fuel fills within this
// day's matching window. Call whenever an alpheus_days row is created or its date changes.
export async function matchFillsToDay(dayId: number, dayDate: string): Promise<void> {
  const window = [dayDate, addDays(dayDate, 1)]

  const fillsInWindow = await db
    .select({ id: fuelFills.id })
    .from(fuelFills)
    .where(and(eq(fuelFills.driverName, 'Alpheus'), inArray(fuelFills.fillDate, window)))

  if (!fillsInWindow.length) return

  await db.update(fuelAllocations)
    .set({ dayId })
    .where(and(
      inArray(fuelAllocations.fillId, fillsInWindow.map(f => f.id)),
      eq(fuelAllocations.allocType, 'offsite'),
      isNull(fuelAllocations.dayId),
    ))
}
