import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Reads one of this app's JSON routes. A failed request throws the route's `{ error }`
 * message, so a page can say its data did not load instead of rendering an empty list
 * that reads as "there is none".
 */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText}`.trim())
  return body as T
}

/**
 * '+27 64 211 6345' for a South African number, else '+<digits>' - the way the WhatsApp
 * bot writes numbers in its messages (format_phone in whatsapp-backend/app/bot/trip.py).
 */
export function formatPhone(phone: string | null | undefined) {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('27') && digits.length === 11) {
    return `+27 ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
  }
  return `+${digits}`
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
