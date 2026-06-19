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
