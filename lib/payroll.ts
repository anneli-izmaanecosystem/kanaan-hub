const UIF_RATE = 0.01

export interface EmployeeForPayroll {
  payType: 'fixed_salary' | 'hourly'
  hoursType: 'fixed_monthly' | 'variable'
  monthlySalary: string | null
  hourlyRate: string | null
  fixedHours: string | null
}

export interface EntryInput {
  ordinaryHours: number
  overtimeHours: number
  sundayPhHours: number
  bonus: number
  otherAdditions: number
  leaveDeduction: number
  otherDeductions: number
  leaveDaysTaken: number
}

export interface PayrollResult {
  basicPay: number
  overtimePay: number
  grossPay: number
  uifEmployee: number
  uifEmployer: number
  netPay: number
}

export function calculatePayroll(emp: EmployeeForPayroll, entry: EntryInput): PayrollResult {
  let basicPay = 0
  let overtimePay = 0

  if (emp.payType === 'fixed_salary') {
    basicPay = parseFloat(emp.monthlySalary ?? '0') - entry.leaveDeduction
  } else {
    const rate = parseFloat(emp.hourlyRate ?? '0')
    const ordHrs = emp.hoursType === 'fixed_monthly'
      ? parseFloat(emp.fixedHours ?? '0')
      : entry.ordinaryHours
    basicPay   = ordHrs * rate
    overtimePay = entry.overtimeHours * rate * 1.5 + entry.sundayPhHours * rate * 2
  }

  const grossPay    = basicPay + overtimePay + entry.bonus + entry.otherAdditions
  const uifEmployee = Math.min(grossPay * UIF_RATE, 177.12)
  const uifEmployer = Math.min(grossPay * UIF_RATE, 177.12)
  const netPay      = grossPay - uifEmployee - entry.otherDeductions

  return {
    basicPay:    round2(basicPay),
    overtimePay: round2(overtimePay),
    grossPay:    round2(grossPay),
    uifEmployee: round2(uifEmployee),
    uifEmployer: round2(uifEmployer),
    netPay:      round2(netPay),
  }
}

export function defaultEntryForEmployee(emp: EmployeeForPayroll): EntryInput {
  return {
    ordinaryHours: parseFloat(emp.fixedHours ?? '0'),
    overtimeHours: 0,
    sundayPhHours: 0,
    bonus: 0,
    otherAdditions: 0,
    leaveDeduction: 0,
    otherDeductions: 0,
    leaveDaysTaken: 0,
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}
