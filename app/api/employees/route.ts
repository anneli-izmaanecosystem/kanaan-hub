import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db, employees } from '@/lib/db'
import { eq } from 'drizzle-orm'

export async function GET(_req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  return NextResponse.json(await db.select().from(employees).orderBy(employees.name))
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  try {
    const body = await req.json()
    const { name, idNumber, bankAccount, bankName, payType, hoursType,
            monthlySalary, hourlyRate, fixedHours, department, position, startDate } = body

    if (!name || !payType || !hoursType)
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    if (payType === 'hourly' && !hourlyRate)
      return NextResponse.json({ error: 'Hourly rate required for hourly employees' }, { status: 400 })
    if (payType === 'fixed_salary' && !monthlySalary)
      return NextResponse.json({ error: 'Monthly salary required for salaried employees' }, { status: 400 })

    const { overtimeHourlyRate, transportAllowance, housingAllowance, otherAllowance } = body
    const [emp] = await db.insert(employees).values({
      name, idNumber: idNumber || null, bankAccount: bankAccount || null, bankName: bankName || null,
      payType, hoursType,
      monthlySalary:      monthlySalary      ? String(monthlySalary)      : null,
      hourlyRate:         hourlyRate         ? String(hourlyRate)         : null,
      fixedHours:         fixedHours         ? String(fixedHours)         : null,
      overtimeHourlyRate: overtimeHourlyRate ? String(overtimeHourlyRate) : null,
      transportAllowance: transportAllowance ? String(transportAllowance) : null,
      housingAllowance:   housingAllowance   ? String(housingAllowance)   : null,
      otherAllowance:     otherAllowance     ? String(otherAllowance)     : null,
      department: department || null, position: position || null,
      startDate: startDate || null,
    }).returning()

    return NextResponse.json(emp, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to create employee' }, { status: 500 })
  }
}
