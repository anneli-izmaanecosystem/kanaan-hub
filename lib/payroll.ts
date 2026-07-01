// ── Alpheus day-rate constants ────────────────────────────────────────────────
export const ALPHEUS_ONSITE_RATE   = 300   // R/day on-site at Kanaan
export const ALPHEUS_OFFSITE_RATE  = 500   // R/day off-site with client
export const ALPHEUS_MIN_MONTHLY   = 8000  // guaranteed floor for weekday portion
// Floor applies only when effective days (weekdays + Saturdays) reach this threshold.
// Allows e.g. 20 weekdays + 2 Saturdays in a 22-weekday month to still qualify.
export const ALPHEUS_FLOOR_MIN_DAYS = 20

export interface AlpheusDayInput {
  dayType:      'onsite' | 'offsite' | 'partial'
  onsiteHours:  string | null  // for partial days — hours at Kanaan
  offsiteHours: number         // sum of client hours (partial) or 0
  isSaturday?:  boolean        // Saturday days: paid at face value on top of weekday floor
}

export interface AlpheusSalaryResult {
  onsiteDays:       number
  offsiteDays:      number
  partialDays:      number
  saturdayDays:     number
  weekdayDaysWorked: number
  onsitePay:        number
  offsitePay:       number
  partialPay:       number
  saturdayEarned:   number
  weekdayEarned:    number
  subtotal:         number  // = weekdayEarned (kept for display compat)
  guaranteed:       number
  finalPay:         number  // weekday gross (floor if needed) + saturdayEarned
  floorApplied:     boolean
}

export function calculateAlpheusSalary(days: AlpheusDayInput[]): AlpheusSalaryResult {
  // Type totals (ALL days, including Saturday) — used for display counts
  let onsiteDays  = 0, offsiteDays  = 0, partialDays  = 0
  let onsitePay   = 0, offsitePay   = 0, partialPay   = 0
  // Weekday / Saturday split — used for floor logic
  let saturdayDays = 0, weekdayDaysWorked = 0
  let weekdayEarned = 0, saturdayEarned = 0

  for (const d of days) {
    let dayEarned = 0
    if (d.dayType === 'onsite') {
      dayEarned = ALPHEUS_ONSITE_RATE
      onsiteDays++; onsitePay += dayEarned
    } else if (d.dayType === 'offsite') {
      dayEarned = ALPHEUS_OFFSITE_RATE
      offsiteDays++; offsitePay += dayEarned
    } else {
      // partial — apportion by hours
      const onHrs  = parseFloat(d.onsiteHours ?? '0') || 0
      const offHrs = d.offsiteHours
      const total  = onHrs + offHrs
      if (total > 0) dayEarned = round2((onHrs / total) * ALPHEUS_ONSITE_RATE + (offHrs / total) * ALPHEUS_OFFSITE_RATE)
      partialDays++; partialPay += dayEarned
    }

    // Split weekday vs Saturday for floor calculation
    if (d.isSaturday) { saturdayDays++;      saturdayEarned += dayEarned }
    else              { weekdayDaysWorked++; weekdayEarned  += dayEarned }
  }

  saturdayEarned = round2(saturdayEarned)
  weekdayEarned  = round2(weekdayEarned)

  // Floor applies to weekday portion only. Saturday days count toward the
  // effective-days threshold so a long weekend still qualifies.
  const effectiveDays = weekdayDaysWorked + saturdayDays
  const floorApplied  = effectiveDays >= ALPHEUS_FLOOR_MIN_DAYS && weekdayEarned < ALPHEUS_MIN_MONTHLY
  const weekdayGross  = floorApplied ? ALPHEUS_MIN_MONTHLY : weekdayEarned

  const finalPay = round2(weekdayGross + saturdayEarned)
  const subtotal = weekdayEarned

  return {
    onsiteDays, offsiteDays, partialDays, saturdayDays, weekdayDaysWorked,
    onsitePay:  round2(onsitePay),
    offsitePay: round2(offsitePay),
    partialPay: round2(partialPay),
    saturdayEarned, weekdayEarned, subtotal,
    guaranteed: ALPHEUS_MIN_MONTHLY,
    finalPay, floorApplied,
  }
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
