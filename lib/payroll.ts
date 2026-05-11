// SA BCEA: OT = 1.5×, Sunday/PH = 2×. UIF capped at R177.12/month (ceiling wage R17,712).
const UIF_RATE = 0.01
const UIF_CAP  = 177.12
// Standard BCEA monthly hours for 40hr/week employees (used to derive hourly from salary)
const STD_MONTHLY_HOURS = 173.33

export interface EmployeeForPayroll {
  payType:            'fixed_salary' | 'hourly'
  hoursType:          'fixed_monthly' | 'variable'
  monthlySalary:      string | null
  hourlyRate:         string | null
  fixedHours:         string | null
  overtimeHourlyRate: string | null
  transportAllowance: string | null
  housingAllowance:   string | null
  otherAllowance:     string | null
}

export interface EntryInput {
  ordinaryHours:  number
  overtimeHours:  number
  sundayPhHours:  number
  bonus:          number
  otherAdditions: number
  leaveDeduction: number
  otherDeductions: number
  leaveDaysTaken: number
}

export interface PayrollResult {
  basicPay:           number
  overtimePay:        number
  allowances:         number
  grossPay:           number
  uifEmployee:        number
  uifEmployer:        number
  netPay:             number
}

export function calculatePayroll(emp: EmployeeForPayroll, entry: EntryInput): PayrollResult {
  let basicPay   = 0
  let overtimePay = 0

  const fixedAllowances =
    parseFloat(emp.transportAllowance ?? '0') +
    parseFloat(emp.housingAllowance   ?? '0') +
    parseFloat(emp.otherAllowance     ?? '0')

  if (emp.payType === 'fixed_salary') {
    basicPay = parseFloat(emp.monthlySalary ?? '0') - entry.leaveDeduction

    // Derive OT hourly rate: explicit rate first, else salary / std monthly hours
    const salary = parseFloat(emp.monthlySalary ?? '0')
    const otRate = emp.overtimeHourlyRate
      ? parseFloat(emp.overtimeHourlyRate)
      : salary > 0 ? salary / STD_MONTHLY_HOURS : 0

    overtimePay = entry.overtimeHours * otRate * 1.5
                + entry.sundayPhHours * otRate * 2
  } else {
    const rate   = parseFloat(emp.hourlyRate ?? '0')
    const otRate = emp.overtimeHourlyRate
      ? parseFloat(emp.overtimeHourlyRate)
      : rate

    const ordHrs = emp.hoursType === 'fixed_monthly'
      ? parseFloat(emp.fixedHours ?? '0')
      : entry.ordinaryHours

    basicPay    = ordHrs * rate
    overtimePay = entry.overtimeHours * otRate * 1.5
                + entry.sundayPhHours * otRate * 2
  }

  const grossPay    = basicPay + overtimePay + fixedAllowances + entry.bonus + entry.otherAdditions
  const uifEmployee = Math.min(grossPay * UIF_RATE, UIF_CAP)
  const uifEmployer = Math.min(grossPay * UIF_RATE, UIF_CAP)
  const netPay      = grossPay - uifEmployee - entry.otherDeductions

  return {
    basicPay:    round2(basicPay),
    overtimePay: round2(overtimePay),
    allowances:  round2(fixedAllowances),
    grossPay:    round2(grossPay),
    uifEmployee: round2(uifEmployee),
    uifEmployer: round2(uifEmployer),
    netPay:      round2(netPay),
  }
}

export function defaultEntryForEmployee(emp: EmployeeForPayroll): EntryInput {
  return {
    ordinaryHours:   parseFloat(emp.fixedHours ?? '0'),
    overtimeHours:   0,
    sundayPhHours:   0,
    bonus:           0,
    otherAdditions:  0,
    leaveDeduction:  0,
    otherDeductions: 0,
    leaveDaysTaken:  0,
  }
}

function round2(n: number) { return Math.round(n * 100) / 100 }
