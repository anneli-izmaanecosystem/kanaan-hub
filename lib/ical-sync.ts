import { db, bookings, rooms, bookingRooms } from '@/lib/db'
import { and, eq, gte, notInArray } from 'drizzle-orm'

type IcalEvent = {
  uid: string
  start: string   // YYYY-MM-DD
  end: string     // YYYY-MM-DD (checkout, exclusive — same convention as bookings.checkOut)
  summary: string
  cancelled: boolean
}

// Unfold CRLF/LF continuation lines (a leading space/tab means "join with previous line").
function unfold(ics: string): string {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '')
}

function toIsoDate(raw: string): string {
  // Handles YYYYMMDD and YYYYMMDDTHHMMSSZ — Booking.com sends all-day (date-only) values.
  const digits = raw.replace(/[^0-9]/g, '')
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

export function parseIcs(ics: string): IcalEvent[] {
  const lines = unfold(ics).split('\n').map(l => l.trim()).filter(Boolean)
  const events: IcalEvent[] = []
  let cur: Partial<IcalEvent> | null = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue }
    if (line === 'END:VEVENT') {
      if (cur?.uid && cur.start && cur.end) {
        events.push({ uid: cur.uid, start: cur.start, end: cur.end, summary: cur.summary ?? '', cancelled: cur.cancelled ?? false })
      }
      cur = null
      continue
    }
    if (!cur) continue

    const sep = line.indexOf(':')
    if (sep === -1) continue
    const key = line.slice(0, sep).split(';')[0].toUpperCase()
    const value = line.slice(sep + 1)

    if (key === 'UID') cur.uid = value
    else if (key === 'DTSTART') cur.start = toIsoDate(value)
    else if (key === 'DTEND') cur.end = toIsoDate(value)
    else if (key === 'SUMMARY') cur.summary = value
    else if (key === 'STATUS') cur.cancelled = value.toUpperCase() === 'CANCELLED'
  }

  return events
}

type RoomSyncResult = { roomId: number; roomName: string; created: number; updated: number; cancelled: number; error?: string }

async function syncRoom(room: { id: number; name: string; icalUrl: string }): Promise<RoomSyncResult> {
  const result: RoomSyncResult = { roomId: room.id, roomName: room.name, created: 0, updated: 0, cancelled: 0 }

  let events: IcalEvent[]
  try {
    const res = await fetch(room.icalUrl, { headers: { 'User-Agent': 'kanaan-hub-ical-sync' } })
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
    events = parseIcs(await res.text()).filter(e => !e.cancelled)
  } catch (err: any) {
    result.error = err.message ?? 'Failed to fetch/parse calendar'
    return result
  }

  const existing = await db
    .select({ id: bookings.id, externalId: bookings.externalId })
    .from(bookings)
    .where(and(eq(bookings.roomId, room.id), eq(bookings.source, 'Booking.com')))

  const existingByUid = new Map(existing.map(b => [b.externalId, b.id]))
  const seenUids = events.map(e => e.uid)

  for (const event of events) {
    const existingId = existingByUid.get(event.uid)
    if (existingId) {
      await db.update(bookings).set({
        checkIn: event.start, checkOut: event.end, notes: event.summary || null, updatedAt: new Date(),
      }).where(eq(bookings.id, existingId))
      result.updated++
    } else {
      const nights = Math.max(1, Math.ceil((new Date(event.end).getTime() - new Date(event.start).getTime()) / 86_400_000))
      const [created] = await db.insert(bookings).values({
        roomId: room.id,
        guestName: 'Booking.com Guest',
        contact: 'Booking.com',
        checkIn: event.start,
        checkOut: event.end,
        adults: 1,
        children: 0,
        nights,
        totalAmount: '0',
        depositPaid: '0',
        balanceDue: '0',
        status: 'confirmed',
        source: 'Booking.com',
        notes: event.summary || null,
        externalId: event.uid,
      }).returning()
      await db.insert(bookingRooms).values({ bookingId: created.id, roomId: room.id })
      result.created++
    }
  }

  // Bookings that disappeared from the feed (guest cancelled on Booking.com). Only touch
  // future/current stays — the feed's rolling window can legitimately omit past dates.
  const today = new Date().toISOString().split('T')[0]
  const stale = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(
      eq(bookings.roomId, room.id),
      eq(bookings.source, 'Booking.com'),
      gte(bookings.checkOut, today),
      seenUids.length > 0 ? notInArray(bookings.externalId, seenUids) : undefined,
    ))

  for (const row of stale) {
    await db.update(bookings).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(bookings.id, row.id))
    result.cancelled++
  }

  return result
}

export async function syncAllRoomCalendars() {
  const roomsWithFeeds = await db
    .select({ id: rooms.id, name: rooms.name, icalUrl: rooms.icalUrl })
    .from(rooms)
    .where(and(eq(rooms.active, true)))

  const withUrl = roomsWithFeeds.filter((r): r is { id: number; name: string; icalUrl: string } => !!r.icalUrl)

  const results: RoomSyncResult[] = []
  for (const room of withUrl) {
    results.push(await syncRoom(room))
  }

  return { syncedAt: new Date().toISOString(), rooms: results }
}
