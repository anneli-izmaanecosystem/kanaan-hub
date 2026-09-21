// The sends nobody triggers by hand: the evening reminder, the driver's "I have left"
// card, the card hold, the chaser when Anneli has not answered, and the no-show question
// when the driver has waited too long.
//
// Runs from /api/whatsapp/cron every few minutes. Everything is idempotent through
// trip_events: each send writes a marker event first and skips trips that already
// carry it, so a tick that overlaps or repeats cannot message anyone twice.

import { inArray } from 'drizzle-orm'
import { db, trips } from '@/lib/db'
import { loadSettings } from './settings'
import {
  driverFor, eventsFor, sendEveningReminder, sendDriverReminder, placeHold,
  askAboutNoShow, notify, record,
} from './trip'
import { formatWhenShort } from './when'

const MIN = 60_000

export interface TickReport {
  eveningReminders: string[]
  driverReminders: string[]
  holds: string[]
  opsChased: string[]
  noShowsAsked: string[]
  errors: string[]
}

export async function tick(now = new Date()): Promise<TickReport> {
  const report: TickReport = { eveningReminders: [], driverReminders: [], holds: [], opsChased: [], noShowsAsked: [], errors: [] }
  const settings = await loadSettings()

  const open = await db
    .select()
    .from(trips)
    .where(inArray(trips.status, ['requested', 'allocated', 'driver_en_route', 'driver_waiting']))

  for (const trip of open) {
    try {
      const events = await eventsFor(trip.id)
      const has = (name: string) => events.some(e => e.event === name)
      const latest = (...names: string[]) =>
        events.filter(e => names.includes(e.event)).map(e => e.at.getTime()).reduce((a, b) => Math.max(a, b), 0)
      const untilPickup = trip.scheduledAt!.getTime() - now.getTime()

      // 3.x — Anneli has not answered.
      if (trip.status === 'requested' && !has('ops_chased')) {
        const sentAt = latest('sent_to_ops', 'time_accepted')
        if (sentAt && now.getTime() - sentAt >= settings.opsResponseMin * MIN) {
          await record(trip.id, 'system', 'ops_chased')
          const minutes = Math.round((now.getTime() - sentAt) / MIN)
          if (settings.opsWhatsapp) {
            await notify('ops', settings.opsWhatsapp, trip.id, 'kn_ops_request_unanswered', [trip.ref, String(minutes)])
          }
          await notify('guest', trip.guestPhone, trip.id, 'kn_guest_still_waiting', [formatWhenShort(trip.scheduledAt!)])
          report.opsChased.push(trip.ref)
        }
        continue
      }

      const driver = await driverFor(trip)
      if (!driver) continue

      // 2.01 — the evening before, from 20:00 South African time.
      if (trip.status === 'allocated' && !has('guest_reminder_sent') && isTomorrow(trip.scheduledAt!, now) && saHour(now) >= 20) {
        await sendEveningReminder(trip, driver)
        report.eveningReminders.push(trip.ref)
      }

      // 2.02 — the hold, an hour before.
      if (trip.status === 'allocated' && !has('hold_attempted') && untilPickup <= settings.holdBeforeMin * MIN) {
        await record(trip.id, 'system', 'hold_attempted')
        await placeHold(trip)
        report.holds.push(trip.ref)
      }

      // 2.03 — the driver's "I have left" card, shortly before pickup. Not for trips
      // that are hours overdue: that is a wedged booking for the board, not a nudge.
      if (
        trip.status === 'allocated' && !has('driver_reminder_sent') &&
        untilPickup <= settings.driverNudgeMin * MIN && untilPickup > -3 * 60 * MIN
      ) {
        await sendDriverReminder(trip, driver)
        report.driverReminders.push(trip.ref)
      }

      // 3.06 — the guest has not appeared. Measured from the driver's arrival, or from
      // the last time Anneli said to keep waiting.
      if (trip.status === 'driver_waiting') {
        const since = latest('driver_arrived', 'keep_waiting', 'guest_coming')
        const asked = latest('no_show_asked')
        if (since && asked < since && now.getTime() - since >= settings.noShowWaitMin * MIN) {
          await askAboutNoShow(trip, driver, Math.round((now.getTime() - since) / MIN))
          report.noShowsAsked.push(trip.ref)
        }
      }
    } catch (err) {
      console.error('[whatsapp scheduler]', trip.ref, err)
      report.errors.push(`${trip.ref}: ${(err as Error).message}`)
    }
  }

  return report
}

function saDate(at: Date): string {
  return at.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' })
}

function saHour(at: Date): number {
  return Number(at.toLocaleTimeString('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', hour12: false }).slice(0, 2))
}

function isTomorrow(at: Date, now: Date): boolean {
  return saDate(at) === saDate(new Date(now.getTime() + 86_400_000))
}

