// ── Alpheus day-rate constants ────────────────────────────────────────────────
export const ALPHEUS_ONSITE_RATE  = 300   // R/day on-site at Kanaan
export const ALPHEUS_OFFSITE_RATE = 500   // R/day off-site with client
export const ALPHEUS_MIN_MONTHLY  = 8000  // guaranteed floor for all weekdays in month

export interface AlpheusDayInput {
  dayType:      'onsite' | 'offsite' | 'partial'
  onsiteHours:  string | null  // for partial days — hours at Kanaan
  offsiteHours: number         // sum of client hours (partial) or 0
}

export interface AlpheusSalaryResult {
  onsiteDays:  number
  offsiteDays: number
  partialDays: number
  onsitePay:   number
  offsitePay:  number
  partialPay:  number
  subtotal:    number
  guaranteed:  number
  finalPay:    number
  floorApplied: boolean
}

export function calculateAlpheusSalary(days: AlpheusDayInput[]): AlpheusSalaryResult {
  let onsitePay  = 0
  let offsitePay = 0
  let partialPay = 0
  let onsiteDays  = 0
  let offsiteDays = 0
  let partialDays = 0

  for (const d of days) {
    if (d.dayType === 'onsite') {
      onsiteDays++
      onsitePay += ALPHEUS_ONSITE_RATE
    } else if (d.dayType === 'offsite') {
      offsiteDays++
      offsitePay += ALPHEUS_OFFSITE_RATE
    } else {
      // partial — apportion between onsite and offsite rates by hours
      partialDays++
      const onHrs  = parseFloat(d.onsiteHours ?? '0') || 0
      const offHrs = d.offsiteHours
      const total  = onHrs + offHrs
      if (total > 0) {
        partialPay += round2((onHrs / total) * ALPHEUS_ONSITE_RATE + (offHrs / total) * ALPHEUS_OFFSITE_RATE)
      }
    }
  }

  const subtotal    = round2(onsitePay + offsitePay + partialPay)
  const finalPay    = Math.max(subtotal, ALPHEUS_MIN_MONTHLY)
  const floorApplied = finalPay > subtotal

  return { onsiteDays, offsiteDays, partialDays, onsitePay, offsitePay, partialPay: round2(partialPay), subtotal, guaranteed: ALPHEUS_MIN_MONTHLY, finalPay, floorApplied }
}

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
    saturdayPay = entry.saturdayHours * rate   // normal rate — hours within 45h/week average
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
