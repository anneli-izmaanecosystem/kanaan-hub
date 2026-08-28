import { config } from 'dotenv'
config({ path: '.env.local' })
import XLSX from 'xlsx'
import { db, payrollRuns, payrollEntries, workers } from './index'
import { eq, and } from 'drizzle-orm'

// One-off backfill: brings Aug 2025 – Feb 2026 payroll (paid before Kanaan Hub's payroll
// module existed) into payroll_runs / payroll_entries, so it shows up alongside every run
// made in the app — payslips, UIF schedule, COIDA summary all read from the same table.
// Source: Kanaan_Detailed_Payroll_Report_Aug2025_Feb2026.xlsx, "Payroll Register" tab —
// built for the COIDA Return of Earnings from the HR payroll master + bank Staff Wages report.
const XLSX_PATH = 'C:\\Users\\annel\\Downloads\\Kanaan_Detailed_Payroll_Report_Aug2025_Feb2026.xlsx'

// xlsx employee name → workers.name in the DB (the sheet uses the informal alias for one)
const NAME_MAP: Record<string, string> = {
  'Judith Nozipho':      'Judith Nozipho',
  'Mathabo Makhubela':   'Mathabo Makhubela',
  'Lilian Malumane':     'Lilian Malumane',
  'Florah Masikhanyile': 'Flora Masikhanyile',
  'Joseph Nyathi':       'Joseph Nyathi',
  'Alpheus Mlambo':      'Alpheus Mlambo',
}

const MONTH_BOUNDS: Record<string, { start: string; end: string }> = {
  'Aug 2025': { start: '2025-08-01', end: '2025-08-31' },
  'Sep 2025': { start: '2025-09-01', end: '2025-09-30' },
  'Oct 2025': { start: '2025-10-01', end: '2025-10-31' },
  'Nov 2025': { start: '2025-11-01', end: '2025-11-30' },
  'Dec 2025': { start: '2025-12-01', end: '2025-12-31' },
  'Jan 2026': { start: '2026-01-01', end: '2026-01-31' },
  'Feb 2026': { start: '2026-02-01', end: '2026-02-28' },
}

const num = (v: unknown): string => v === '' || v == null ? '0' : String(parseFloat(String(v)) || 0)

async function main() {
  const wb = XLSX.readFile(XLSX_PATH)
  const ws = wb.Sheets['Payroll Register']
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  const allWorkers = await db.select().from(workers)
  const workerByName = new Map(allWorkers.map(w => [w.name, w]))

  // Cache payroll_runs we create/find during this run, keyed by `${entityId}|${start}|${end}`
  const runCache = new Map<string, number>()

  async function getOrCreateRun(entityId: number, start: string, end: string): Promise<number> {
    const key = `${entityId}|${start}|${end}`
    if (runCache.has(key)) return runCache.get(key)!

    const [existing] = await db.select().from(payrollRuns)
      .where(and(eq(payrollRuns.entityId, entityId), eq(payrollRuns.periodStart, start), eq(payrollRuns.periodEnd, end)))
    if (existing) { runCache.set(key, existing.id); return existing.id }

    const [created] = await db.insert(payrollRuns)
      .values({ entityId, periodStart: start, periodEnd: end, status: 'finalised' })
      .returning()
    runCache.set(key, created.id)
    return created.id
  }

  let inserted = 0, skipped = 0

  for (const row of rows) {
    const [name, , month, ordinaryHours, , grossPay, deductions, netPay, uifEmployee, sheetNote] = row as string[]

    const dbName = NAME_MAP[name?.trim()]
    const bounds = MONTH_BOUNDS[month?.trim()]
    if (!dbName || !bounds) continue // header / subtotal / grand-total / blank rows

    const worker = workerByName.get(dbName)
    if (!worker) { console.warn(`  SKIP — worker not found in DB: "${dbName}"`); skipped++; continue }

    const runId = await getOrCreateRun(worker.entityId, bounds.start, bounds.end)

    const notes = [
      'Backfilled from Kanaan_Detailed_Payroll_Report_Aug2025_Feb2026.xlsx (prepared 27 Aug 2026) — ' +
      'built for the COIDA Return of Earnings from the HR payroll master + bank Staff Wages report. ' +
      'No day-by-day attendance behind this entry; Net Pay is the actual amount paid per bank records ' +
      'and may not equal Gross − Deductions − UIF (UIF here is frequently a retrospective 1% estimate, ' +
      'not an amount actually withheld at the time — see per-row flag below).',
      sheetNote?.trim() || null,
    ].filter(Boolean).join(' | ')

    try {
      await db.insert(payrollEntries).values({
        runId,
        workerId:          worker.id,
        ordinaryHours:     worker.payStructure === 'hourly' || worker.payStructure === 'floor' ? num(ordinaryHours) : '0',
        // Joseph's Nov 2025 row is piece work (10 days x R250) — the sheet leaves Ordinary
        // Hours blank for him; his daily rate is captured via daysWorked instead.
        daysWorked:        worker.payStructure === 'daily' ? '10' : '0',
        basicPay:          num(grossPay),
        grossPay:          num(grossPay),
        otherDeductions:   num(deductions),
        uifEmployee:        num(uifEmployee),
        uifEmployer:        num(uifEmployee), // mirrors the app's existing assumption (1% each side)
        netPay:            num(netPay),
        usesTimesheet:     false,
        markedReady:       true,
        notes,
      }).onConflictDoNothing({ target: [payrollEntries.runId, payrollEntries.workerId] })
      inserted++
    } catch (err: any) {
      console.warn(`  SKIP row — ${name} / ${month}: ${err.message}`)
      skipped++
    }
  }

  console.log(`Done — entries inserted: ${inserted}, skipped: ${skipped}, runs touched: ${runCache.size}`)
  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })
