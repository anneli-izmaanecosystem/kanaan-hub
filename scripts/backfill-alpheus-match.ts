// One-off: re-run the Alpheus fill<->day matching against existing data now that the
// window covers {dayDate, dayDate+1} instead of an exact-date-only match. Idempotent —
// only touches allocations that are still unmatched (dayId is null).
import { config } from 'dotenv'
config({ path: '.env.local' })
import { db, alpheusDays } from '../lib/db'
import { matchFillsToDay } from '../lib/alpheus-match'

async function main() {
  const days = await db.select().from(alpheusDays)
  for (const d of days) {
    await matchFillsToDay(d.id, d.dayDate)
  }
  console.log(`Re-ran matching for ${days.length} Alpheus day(s).`)
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1) })
