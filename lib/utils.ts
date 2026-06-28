import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmt(n: number | string) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(Number(n))
}

export function fmtDate(d: string | null | undefined) {
  if (!d) return ''
  // Parse as local date to avoid UTC-to-local timezone shift
  const [y, m, day] = d.split('T')[0].split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}
