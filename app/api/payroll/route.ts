import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollRuns, payrollEntries, employees } from '@/lib/db'
import { eq, desc } from 'drizzle-orm'
import { calculatePayroll, defaultEntryForEmployee } from '@/lib/payroll'

export async function GET(_req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const runs = await db.select().from(payrollRuns).orderBy(desc(payrollRuns.periodStart))
  return NextResponse.json(runs)
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const { periodStart, periodEnd } = await req.json()
    if (!periodStart || !periodEnd)
      return NextResponse.json({ error: 'Missing period dates' }, { status: 400 })

    const activeEmployees = await db.select().from(employees).where(eq(employees.active, true))

    const [run] = await db.insert(payrollRuns).values({ periodStart, periodEnd }).returning()

    if (activeEmployees.length > 0) {
      const entries = activeEmployees.map(emp => {
        const entryInput = defaultEntryForEmployee(emp)
        const calc = calculatePayroll(emp, entryInput)
        return {
          runId:          run.id,
          employeeId:     emp.id,
          ordinaryHours:  String(entryInput.ordinaryHours),
          overtimeHours:  '0',
          sundayPhHours:  '0',
          basicPay:       String(calc.basicPay),
          overtimePay:    String(calc.overtimePay),
          bonus:          '0',
          otherAdditions: '0',
          uifEmployee:    String(calc.uifEmployee),
          uifEmployer:    String(calc.uifEmployer),
          leaveDeduction: '0',
          otherDeductions:'0',
          grossPay:       String(calc.grossPay),
          netPay:         String(calc.netPay),
          leaveDaysTaken: '0',
        }
      })
      await db.insert(payrollEntries).values(entries)
    }

    return NextResponse.json(run, { status: 201 })
  } catch (err: any) {
    console.error('[payroll POST]', err)
    return NextResponse.json({ error: 'Failed to create payroll run' }, { status: 500 })
  }
}
