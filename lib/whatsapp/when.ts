// Turning "saturday 05:30" into an instant.
//
// Guests type departure times in whatever shape comes naturally, so this accepts the
// handful of forms that actually turn up and returns null for everything else — the
// conversation then asks again rather than guessing at a 05:30 airport run.
//
// South Africa is UTC+2 year round with no DST, so a fixed offset is correct here and
// avoids pulling in a timezone library.

const SA_OFFSET_MIN = 120

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** Wall-clock fields in Johannesburg for a given instant. */
function saParts(at: Date) {
  const shifted = new Date(at.getTime() + SA_OFFSET_MIN * 60_000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  }
}

/** The instant at which Johannesburg wall-clock reads these fields. */
function fromSA(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month, day, hour, minute) - SA_OFFSET_MIN * 60_000)
}

function findTime(text: string): { hour: number; minute: number } | null {
  // 05:30, 5.30, 0530h, "5 30". Also "5pm" / "5 pm".
  const hm = text.match(/\b(\d{1,2})[:.h ]\s?(\d{2})\b/)
  const ampm = text.match(/\b(\d{1,2})\s?(am|pm)\b/)

  let hour: number, minute: number
  if (hm) {
    hour = Number(hm[1]); minute = Number(hm[2])
  } else if (ampm) {
    hour = Number(ampm[1]); minute = 0
  } else {
    return null
  }

  if (/pm\b/.test(text) && hour < 12) hour += 12
  if (/am\b/.test(text) && hour === 12) hour = 0

  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

/**
 * Parses a departure time. `now` is injectable so this is testable without freezing the
 * clock, and defaults to the real one.
 *
 * Ambiguity always resolves forward: a time that has already passed today means
 * tomorrow, and a weekday that has passed this week means next week. Someone booking a
 * car is asking for the next such moment, never the one that has been and gone.
 */
export function parseWhen(input: string, now: Date = new Date()): Date | null {
  const text = input.toLowerCase().trim()
  if (!text) return null

  // "now" — give the driver a few minutes rather than a time already in the past.
  if (/^(now|asap|right now|immediately)\b/.test(text)) {
    return new Date(now.getTime() + 15 * 60_000)
  }

  const time = findTime(text)
  const here = saParts(now)

  // ISO-ish: 2026-09-12 05:30
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso && time) {
    return fromSA(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), time.hour, time.minute)
  }

  // "12 september" or "september 12", with optional ordinal suffix
  const monthIdx = MONTHS.findIndex(m => text.includes(m.slice(0, 3)))
  if (monthIdx >= 0 && time) {
    const dayMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b(?!\s?[:.h])/)
    if (dayMatch) {
      const day = Number(dayMatch[1])
      // A month earlier than the current one means next year.
      const year = monthIdx < here.month ? here.year + 1 : here.year
      return fromSA(year, monthIdx, day, time.hour, time.minute)
    }
  }

  if (!time) return null

  // "tomorrow 05:30"
  if (text.includes('tomorrow')) {
    return fromSA(here.year, here.month, here.day + 1, time.hour, time.minute)
  }
  if (text.includes('today') || text.includes('tonight')) {
    return fromSA(here.year, here.month, here.day, time.hour, time.minute)
  }

  // "saturday 05:30" — the next such weekday, today included if the time is still ahead.
  const dayIdx = DAYS.findIndex(d => text.includes(d.slice(0, 3)))
  if (dayIdx >= 0) {
    let delta = (dayIdx - here.weekday + 7) % 7
    const candidate = fromSA(here.year, here.month, here.day + delta, time.hour, time.minute)
    if (delta === 0 && candidate.getTime() <= now.getTime()) delta = 7
    return delta === 0 ? candidate : fromSA(here.year, here.month, here.day + delta, time.hour, time.minute)
  }

  // Bare time: today if it is still ahead, otherwise tomorrow.
  const todayAt = fromSA(here.year, here.month, here.day, time.hour, time.minute)
  return todayAt.getTime() > now.getTime()
    ? todayAt
    : fromSA(here.year, here.month, here.day + 1, time.hour, time.minute)
}

/** 'Saturday 12 September, 05:30' — how a departure is quoted back to the guest. */
export function formatWhenLong(at: Date): string {
  return at.toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).replace(/,([^,]*)$/, ',$1')
}

/** 'Sat 12 Sep, 05:30' — the compact form used on the ops and driver cards. */
export function formatWhenShort(at: Date): string {
  return at.toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** '05:30' */
export function formatTime(at: Date): string {
  return at.toLocaleTimeString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** 'Saturday' */
export function formatDayName(at: Date): string {
  return at.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'long' })
}
