const TZ = 'Africa/Johannesburg'

export function todaySA(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ })
}

export function currentMonthSA(): string {
  return todaySA().slice(0, 7)
}

export function monthEndDate(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const lastDay = new Date(y, m, 0).getDate()
  return `${yearMonth}-${String(lastDay).padStart(2, '0')}`
}

export function addDaysSA(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00Z') // noon anchor avoids DST/UTC rollover edge cases
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}
