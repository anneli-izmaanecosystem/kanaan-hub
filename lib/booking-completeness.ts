import { addDaysSA } from './date-sa'

export type CompletenessCheck = {
  status: string
  checkOut: string
  paymentMethod: string | null
  source: string | null
  invoiceNumber: string | null
}

export const FIELD_LABELS = {
  paymentMethod: 'Payment Method',
  source:        'Source',
  invoiceNumber: 'Invoice',
} as const

// A booking needs staff follow-up once its stay is over (checkout + 2 days) and it's still
// missing payment method, source, or an invoice number — 'N/A' counts as a deliberate "No
// Invoice" answer, not a gap, so only a genuinely blank invoiceNumber counts as missing.
export function missingBookingFields(b: CompletenessCheck): (keyof typeof FIELD_LABELS)[] {
  const missing: (keyof typeof FIELD_LABELS)[] = []
  if (!b.paymentMethod) missing.push('paymentMethod')
  if (!b.source) missing.push('source')
  if (!b.invoiceNumber) missing.push('invoiceNumber')
  return missing
}

export function isBookingIncomplete(b: CompletenessCheck, today: string): boolean {
  if (b.status === 'cancelled') return false
  if (addDaysSA(b.checkOut, 2) > today) return false // not yet 2 days past checkout
  return missingBookingFields(b).length > 0
}
