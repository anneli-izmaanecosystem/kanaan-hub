import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollEntries, workers, payrollRuns } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { calculatePayroll } from '@/lib/payroll'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; entryId: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { runId, entryId } = await params
  try {
    const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, parseInt(runId)))
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
    if (run.status === 'finalised')
      return NextResponse.json({ error: 'Run is finalised — entries can no longer change' }, { status: 403 })

    const body = await req.json()

    const [entry] = await db
      .select()
      .from(payrollEntries)
      .where(eq(payrollEntries.id, parseInt(entryId)))
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [worker] = await db
      .select()
      .from(workers)
      .where(eq(workers.id, entry.workerId))

    const p = (key: string, fallback: string) =>
      parseFloat(body[key] ?? entry[key as keyof typeof entry] ?? fallback)

    const entryInput = {
      ordinaryHours:        p('ordinaryHours',        '0'),
      saturdayHours:        p('saturdayHours',        '0'),
      sundayHours:          p('sundayHours',          '0'),
      phHours:              p('phHours',              '0'),
      daysWorked:           p('daysWorked',           '0'),
      saturdayDays:         p('saturdayDays',         '0'),
      sundayDays:           p('sundayDays',           '0'),
      phDays:               p('phDays',               '0'),
      unpaidLeaveDays:      p('unpaidLeaveDays',      '0'),
      bonus:                p('bonus',                '0'),
      otherAdditions:       p('otherAdditions',       '0'),
      salaryAdvance:        p('salaryAdvance',        '0'),
      shopDeductions:       p('shopDeductions',       '0'),
      otherDeductions:      p('otherDeductions',      '0'),
      annualLeaveDaysTaken: p('annualLeaveDaysTaken', '0'),
      sickLeaveDaysTaken:   p('sickLeaveDaysTaken',   '0'),
    }

    const calc = calculatePayroll(worker, entryInput)

    const [updated] = await db
      .update(payrollEntries)
      .set({
        ordinaryHours:        String(entryInput.ordinaryHours),
        saturdayHours:        String(entryInput.saturdayHours),
        sundayHours:          String(entryInput.sundayHours),
        phHours:              String(entryInput.phHours),
        daysWorked:           String(entryInput.daysWorked),
        saturdayDays:         String(entryInput.saturdayDays),
        sundayDays:           String(entryInput.sundayDays),
        bonus:                String(entryInput.bonus),
        otherAdditions:       String(entryInput.otherAdditions),
        salaryAdvance:        String(entryInput.salaryAdvance),
        shopDeductions:       String(entryInput.shopDeductions),
        otherDeductions:      String(entryInput.otherDeductions),
        annualLeaveDaysTaken: String(entryInput.annualLeaveDaysTaken),
        sickLeaveDaysTaken:   String(entryInput.sickLeaveDaysTaken),
        basicPay:             String(calc.basicPay),
        saturdayPay:          String(calc.saturdayPay),
        sundayPay:            String(calc.sundayPay),
        phPay:                String(calc.phPay),
        grossPay:             String(calc.grossPay),
        uifEmployee:          String(calc.uifEmployee),
        uifEmployer:          String(calc.uifEmployer),
        netPay:               String(calc.netPay),
        payeTaxableAmount:    calc.payeThresholdFlag ? String(calc.grossPay) : null,
        engagementDescription: body.engagementDescription ?? entry.engagementDescription,
        notes:                 body.notes ?? entry.notes,
      })
      .where(eq(payrollEntries.id, parseInt(entryId)))
      .returning()

    return NextResponse.json({ ...updated, warnings: { belowNmw: calc.belowNmw, payeFlag: calc.payeThresholdFlag } })
  } catch (err) {
    console.error('[entry PATCH]', err)
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 })
  }
}
