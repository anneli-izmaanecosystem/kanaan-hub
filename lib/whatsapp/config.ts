// Every number the car-booking conversation depends on, in one file.
//
// These are policy, not code. The workbook flags three of them as unresolved — the 50 km
// chat cutoff, how long a driver waits, and whether a no-show is charged — so they are
// env-overridable and the defaults below are placeholders until someone decides.

function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const config = {
  /** Shown to guests when the bot hands off. */
  opsPhone: process.env.KANAAN_OPS_PHONE || '063 794 3880',
  /** E.164, for sending Anneli her own WhatsApp messages. */
  opsWhatsApp: process.env.KANAAN_OPS_WHATSAPP || '',

  pickupName: process.env.KANAAN_PICKUP_NAME || 'Kanaan Guest Farm',
  pickupAddress: process.env.KANAAN_PICKUP_ADDRESS || 'Kanaan Guest Farm, R40 Hazyview',
  pickupLat: num('KANAAN_PICKUP_LAT', -25.0448),
  pickupLng: num('KANAAN_PICKUP_LNG', 31.1194),

  // Per km on the whole round trip the car drives, with a minimum. The WhatsApp service
  // (whatsapp-backend) quotes the fares; these are what the dashboard shows until the
  // owner saves their own.
  farePerKm: num('KANAAN_FARE_PER_KM', 10),
  fareMinimum: num('KANAAN_FARE_MINIMUM', 20),

  /** Past this, the bot refuses and refers the guest to Anneli. Flagged for review. */
  maxChatKm: num('KANAAN_MAX_CHAT_KM', 50),

  /** How long the driver waits before Anneli is asked what to do. Undecided. */
  noShowWaitMinutes: num('KANAAN_NO_SHOW_WAIT_MIN', 12),
  /** How long Anneli has to answer a request before she is chased. */
  opsResponseMinutes: num('KANAAN_OPS_RESPONSE_MIN', 15),

  /** Offsets driving the scheduled sends, in minutes before pickup. */
  holdBeforeMinutes: num('KANAAN_HOLD_BEFORE_MIN', 60),
  driverNudgeBeforeMinutes: num('KANAAN_DRIVER_NUDGE_BEFORE_MIN', 25),
}

export function withinChatLimit(distanceKm: number): boolean {
  return distanceKm <= config.maxChatKm
}

/** 'KN-1187'. Sequential per trip id so it stays short and never collides. */
export function tripRef(id: number): string {
  return `KN-${1000 + id}`
}

/** WhatsApp gives numbers without a '+'; everything we store and send back uses E.164. */
export function toE164(waId: string): string {
  return waId.startsWith('+') ? waId : `+${waId}`
}

/** Graph wants the bare digits. */
export function toWaId(phone: string): string {
  return phone.replace(/^\+/, '')
}
