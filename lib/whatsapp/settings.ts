// Reads the tariff and policy numbers, preferring what the owner set in the admin over
// the env defaults in ./config.
//
// config.ts stays the fallback rather than being deleted: it is what the flow runs on
// before anyone has opened the settings screen, and before the database exists at all.

import { asc } from 'drizzle-orm'
import { db, transferSettings } from '@/lib/db'
import { config } from './config'

export interface TransferSettings {
  fareBase: number
  farePerKm: number
  fareMinimum: number
  maxChatKm: number
  opsResponseMin: number
  noShowWaitMin: number
  holdBeforeMin: number
  driverNudgeMin: number
  chargeNoShow: boolean
  noShowFee: number | null
  serviceStart: string | null
  serviceEnd: string | null
  maxLeadDays: number
  opsWhatsapp: string
  opsPhone: string
  opsEscalationWhatsapp: string | null
  muteOpsCommentary: boolean
}

export const defaults: TransferSettings = {
  fareBase: config.fareBase,
  farePerKm: config.farePerKm,
  fareMinimum: config.fareMinimum,
  maxChatKm: config.maxChatKm,
  opsResponseMin: config.opsResponseMinutes,
  noShowWaitMin: config.noShowWaitMinutes,
  holdBeforeMin: config.holdBeforeMinutes,
  driverNudgeMin: config.driverNudgeBeforeMinutes,
  chargeNoShow: false,
  noShowFee: null,
  serviceStart: null,
  serviceEnd: null,
  maxLeadDays: 60,
  opsWhatsapp: config.opsWhatsApp,
  opsPhone: config.opsPhone,
  opsEscalationWhatsapp: null,
  muteOpsCommentary: false,
}

const n = (v: string | null | undefined, fallback: number) => (v == null ? fallback : Number(v))

/**
 * Current settings. Reads the single row, falling back per-field so a column added
 * later does not need a backfill before the flow can run.
 */
export async function loadSettings(): Promise<TransferSettings> {
  const [row] = await db.select().from(transferSettings).orderBy(asc(transferSettings.id)).limit(1)
  if (!row) return defaults

  return {
    fareBase: n(row.fareBase, defaults.fareBase),
    farePerKm: n(row.farePerKm, defaults.farePerKm),
    fareMinimum: n(row.fareMinimum, defaults.fareMinimum),
    maxChatKm: row.maxChatKm ?? defaults.maxChatKm,
    opsResponseMin: row.opsResponseMin ?? defaults.opsResponseMin,
    noShowWaitMin: row.noShowWaitMin ?? defaults.noShowWaitMin,
    holdBeforeMin: row.holdBeforeMin ?? defaults.holdBeforeMin,
    driverNudgeMin: row.driverNudgeMin ?? defaults.driverNudgeMin,
    chargeNoShow: row.chargeNoShow ?? defaults.chargeNoShow,
    noShowFee: row.noShowFee == null ? null : Number(row.noShowFee),
    serviceStart: row.serviceStart,
    serviceEnd: row.serviceEnd,
    maxLeadDays: row.maxLeadDays ?? defaults.maxLeadDays,
    opsWhatsapp: row.opsWhatsapp || defaults.opsWhatsapp,
    opsPhone: row.opsPhone || defaults.opsPhone,
    opsEscalationWhatsapp: row.opsEscalationWhatsapp,
    muteOpsCommentary: row.muteOpsCommentary ?? defaults.muteOpsCommentary,
  }
}

/** Creates the row on first save, updates it thereafter. */
export async function saveSettings(patch: Record<string, unknown>) {
  const [row] = await db.select({ id: transferSettings.id }).from(transferSettings).orderBy(asc(transferSettings.id)).limit(1)

  if (!row) {
    const [created] = await db.insert(transferSettings).values(patch).returning()
    return created
  }

  const { eq } = await import('drizzle-orm')
  const [updated] = await db
    .update(transferSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(transferSettings.id, row.id))
    .returning()
  return updated
}

/** Quoted fare in rand, rounded to the nearest 10 so it reads like a price. */
export function fareFor(distanceKm: number, s: TransferSettings, fixedFare?: number | null): number {
  if (fixedFare != null) return Number(fixedFare)
  const raw = s.fareBase + s.farePerKm * distanceKm
  return Math.max(s.fareMinimum, Math.round(raw / 10) * 10)
}

/**
 * Whether a departure falls inside the service window and lead time. Returns the reason
 * it does not, so the conversation can say which rule it broke rather than a flat no.
 */
export function bookingWindowError(at: Date, s: TransferSettings): string | null {
  const leadDays = (at.getTime() - Date.now()) / 86_400_000
  if (leadDays > s.maxLeadDays) {
    return `We only take bookings up to ${s.maxLeadDays} days ahead.`
  }

  if (!s.serviceStart || !s.serviceEnd) return null

  const hhmm = at.toLocaleTimeString('en-ZA', {
    timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  if (hhmm < s.serviceStart || hhmm > s.serviceEnd) {
    return `We run cars between ${s.serviceStart} and ${s.serviceEnd}. For anything outside that, please call ${s.opsPhone}.`
  }
  return null
}
