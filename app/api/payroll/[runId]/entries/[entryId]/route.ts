import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, payrollEntries, employees } from '@/lib/db'
import { eq } from 'drizzle-orm'
import { calculatePayroll } from '@/lib/payroll'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ runId: string; entryId: string }> }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { entryId } = await params
  try {
    const body = await req.json()
    const { ordinaryHours, overtimeHours, sundayPhHours, bonus, otherAdditions,
            leaveDeduction, otherDeductions, leaveDaysTaken, notes } = body

    const [entry] = await db.select().from(payrollEntries).where(eq(payrollEntries.id, parseInt(entryId)))
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [emp] = await db.select().from(employees).where(eq(employees.id, entry.employeeId))

    const entryInput = {
      ordinaryHours:  parseFloat(ordinaryHours  ?? entry.ordinaryHours  ?? '0'),
      overtimeHours:  parseFloat(overtimeHours  ?? entry.overtimeHours  ?? '0'),
      sundayPhHours:  parseFloat(sundayPhHours  ?? entry.sundayPhHours  ?? '0'),
      bonus:          parseFloat(bonus          ?? entry.bonus          ?? '0'),
      otherAdditions: parseFloat(otherAdditions ?? entry.otherAdditions ?? '0'),
      leaveDeduction: parseFloat(leaveDeduction ?? entry.leaveDeduction ?? '0'),
      otherDeductions:parseFloat(otherDeductions?? entry.otherDeductions?? '0'),
      leaveDaysTaken: parseFloat(leaveDaysTaken ?? entry.leaveDaysTaken ?? '0'),
    }

    const calc = calculatePayroll(emp, entryInput)

    const [updated] = await db
      .update(payrollEntries)
      .set({
        ordinaryHours:  String(entryInput.ordinaryHours),
        overtimeHours:  String(entryInput.overtimeHours),
        sundayPhHours:  String(entryInput.sundayPhHours),
        bonus:          String(entryInput.bonus),
        otherAdditions: String(entryInput.otherAdditions),
        leaveDeduction: String(entryInput.leaveDeduction),
        otherDeductions:String(entryInput.otherDeductions),
        leaveDaysTaken: String(entryInput.leaveDaysTaken),
        basicPay:       String(calc.basicPay),
        overtimePay:    String(calc.overtimePay),
        grossPay:       String(calc.grossPay),
        uifEmployee:    String(calc.uifEmployee),
        uifEmployer:    String(calc.uifEmployer),
        netPay:         String(calc.netPay),
        notes,
      })
      .where(eq(payrollEntries.id, parseInt(entryId)))
      .returning()

    return NextResponse.json(updated)
  } catch (err: any) {
    console.error('[entry PATCH]', err)
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 })
  }
}
