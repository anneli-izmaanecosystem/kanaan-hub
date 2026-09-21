// The driver's side. He only ever taps: Noted / I cannot take it on the trip card, then
// I have left / I have arrived / Arrived at drop on the day. Nothing moves past "arrived"
// until the guest confirms, which is handled on the guest side.

import { eq } from 'drizzle-orm'
import { db, drivers } from '@/lib/db'
import { readReply, said, type WaMessage } from './types'
import { sendText } from './client'
import { toWaId } from './config'
import { formatDayName, formatTime } from './when'
import {
  DRIVER_BTN, type Trip,
  tripForReply, record, driverDeclined, driverLeft, driverArrived, driverAtDrop,
} from './trip'

export async function handleDriverMessage(phone: string, message: WaMessage): Promise<void> {
  const to = toWaId(phone)
  const reply = readReply(message)
  const [driver] = await db.select().from(drivers).where(eq(drivers.phone, phone))
  if (!driver) return

  const trip = await tripForReply(phone, 'driver', message.context?.id)
  if (!trip) {
    await sendText(to, 'You have no trip on the go right now. Anneli will send the next one here.')
    return
  }
  if (trip.driverId !== driver.id) {
    await sendText(to, `Trip ${trip.ref} has been reassigned - nothing needed from you.`)
    return
  }

  if (said(reply, DRIVER_BTN.noted)) {
    await record(trip.id, 'driver', 'driver_acknowledged')
    await sendText(to, `Thank you. You will get a reminder ${reminderWording(trip)}.`)
    return
  }

  if (said(reply, DRIVER_BTN.cannotTake, DRIVER_BTN.cannotMake)) {
    if (trip.status !== 'allocated') {
      await sendText(to, `Trip ${trip.ref} is already under way - please call Anneli.`)
      return
    }
    await driverDeclined(trip.id, driver)
    return
  }

  if (said(reply, DRIVER_BTN.left)) {
    if (trip.status !== 'allocated') {
      await sendText(to, `Trip ${trip.ref} is already marked as ${trip.status.replace('_', ' ')}.`)
      return
    }
    await driverLeft(trip.id, driver)
    return
  }

  if (reply.replyId === 'driver:arrived' || said(reply, DRIVER_BTN.arrived)) {
    if (trip.status !== 'driver_en_route' && trip.status !== 'allocated') {
      await sendText(to, `Trip ${trip.ref} is already marked as ${trip.status.replace('_', ' ')}.`)
      return
    }
    await driverArrived(trip.id, driver)
    return
  }

  if (reply.replyId === 'driver:at_drop' || said(reply, DRIVER_BTN.atDrop)) {
    if (trip.status !== 'in_progress') {
      await sendText(to, 'The guest has not confirmed the pickup yet, so the trip has not started.')
      return
    }
    await driverAtDrop(trip.id, driver)
    return
  }

  await sendText(to, `Use the buttons for trip ${trip.ref}, or call Anneli if something is wrong.`)
}

/** "shortly before 05:30 on Saturday" — when kn_driver_trip_reminder goes out. */
function reminderWording(trip: Trip): string {
  const at = trip.scheduledAt!
  const today = formatDayName(at) === formatDayName(new Date()) && at.getTime() - Date.now() < 86_400_000
  return `shortly before ${formatTime(at)}${today ? '' : ` on ${formatDayName(at)}`}`
}
