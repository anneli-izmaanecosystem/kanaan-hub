// SA BCEA compliance constants
const UIF_RATE = 0.01
const UIF_CAP  = 177.12  // 1% of R17,712 ceiling wage
const NMW_HOURLY = 30.23  // effective 1 March 2026
const PAYE_ANNUAL_THRESHOLD = 95750  // 2025/26 tax year

// Saturday multiplier for hourly workers (BCEA s.10)
const SAT_MULTIPLIER = 1.5
// PH multiplier for employees (BCEA s.18)
const PH_MULTIPLIER  = 2.0

export type PayStructure = 'hourly' | 'daily' | 'floor'
export type WorkerType   = 'employee' | 'contractor'

export interface WorkerForPayroll {
  workerType:   WorkerType
  payStructure: PayStructure
  // hourly
  hourlyRate?:     string | null
  stdHoursPerDay?: string | null
  // daily
  dailyRate?: string | null
  // floor (Alpheus)
  floorSalary?:  string | null
  saturdayRate?: string | null
}

export interface EntryInput {
  // hours-based (hourly workers)
  ordinaryHours: number
  saturdayHours: number
  phHours:       number   // public holiday hours — employee only, if confirmed double
  // days-based (daily & floor workers)
  daysWorked:    number
  saturdayDays:  number
  unpaidLeaveDays: number  // floor workers: days to deduct from floor
  // additions
  bonus:          number
  otherAdditions: number
  // deductions
  salaryAdvance:   number
  shopDeductions:  number
  otherDeductions: number
  // leave tracking
  annualLeaveDaysTaken: number
  sickLeaveDaysTaken:   number
}

export interface PayrollResult {
  basicPay:       number
  saturdayPay:    number
  phPay:          number
  grossPay:       number
  uifEmployee:    number
  uifEmployer:    number
  netPay:         number
  // warnings
  belowNmw:           boolean
  payeThresholdFlag:  boolean  // gross × 12 > PAYE_ANNUAL_THRESHOLD
}

export function calculatePayroll(worker: WorkerForPayroll, entry: EntryInput): PayrollResult {
  const isEmployee   = worker.workerType === 'employee'
  let basicPay       = 0
  let saturdayPay    = 0
  let phPay          = 0

  if (worker.payStructure === 'hourly') {
    const rate = parseFloat(worker.hourlyRate ?? '0')
    basicPay    = entry.ordinaryHours * rate
    saturdayPay = entry.saturdayHours * rate * SAT_MULTIPLIER   // BCEA s.10: 1.5× Saturday
    // PH: double pay for employees only, zero for contractors
    phPay = isEmployee ? entry.phHours * rate * PH_MULTIPLIER : 0

  } else if (worker.payStructure === 'daily') {
    const rate = parseFloat(worker.dailyRate ?? '0')
    basicPay    = entry.daysWorked    * rate
    saturdayPay = entry.saturdayDays  * rate  // flat day rate on Saturdays (per actual practice)
    // PH: double for employees, zero for contractors
    phPay = 0  // PH days captured separately via phHours if needed

  } else if (worker.payStructure === 'floor') {
    // Floor absorbs all ordinary weekdays. Deduct unpaid leave at daily equivalent.
    const floor = parseFloat(worker.floorSalary ?? '0')
    const satR  = parseFloat(worker.saturdayRate ?? '0')
    // Use 21.67 as average working days/month for daily equivalent
    const dailyEquiv = floor / 21.67
    basicPay    = floor - entry.unpaidLeaveDays * dailyEquiv
    saturdayPay = entry.saturdayDays * satR
  }

  const grossPay = basicPay + saturdayPay + phPay + entry.bonus + entry.otherAdditions

  // UIF: employees only, 1% each side, capped
  const uifEmployee = isEmployee ? Math.min(grossPay * UIF_RATE, UIF_CAP) : 0
  const uifEmployer = isEmployee ? Math.min(grossPay * UIF_RATE, UIF_CAP) : 0

  const netPay = grossPay - uifEmployee - entry.salaryAdvance - entry.shopDeductions - entry.otherDeductions

  // NMW guard (hourly workers only)
  const effectiveHourly = worker.payStructure === 'hourly'
    ? parseFloat(worker.hourlyRate ?? '0')
    : 0
  const belowNmw = worker.payStructure === 'hourly' && effectiveHourly < NMW_HOURLY

  // PAYE threshold flag (annualised gross)
  const payeThresholdFlag = grossPay * 12 > PAYE_ANNUAL_THRESHOLD

  return {
    basicPay:            round2(basicPay),
    saturdayPay:         round2(saturdayPay),
    phPay:               round2(phPay),
    grossPay:            round2(grossPay),
    uifEmployee:         round2(uifEmployee),
    uifEmployer:         round2(uifEmployer),
    netPay:              round2(netPay),
    belowNmw,
    payeThresholdFlag,
  }
}

export function defaultEntry(): EntryInput {
  return {
    ordinaryHours:        0,
    saturdayHours:        0,
    phHours:              0,
    daysWorked:           0,
    saturdayDays:         0,
    unpaidLeaveDays:      0,
    bonus:                0,
    otherAdditions:       0,
    salaryAdvance:        0,
    shopDeductions:       0,
    otherDeductions:      0,
    annualLeaveDaysTaken: 0,
    sickLeaveDaysTaken:   0,
  }
}

export function round2(n: number) { return Math.round(n * 100) / 100 }
