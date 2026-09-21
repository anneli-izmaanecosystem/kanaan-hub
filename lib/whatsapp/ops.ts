// Anneli's side of the conversation. Everything she receives is a template card with
// buttons (she may not have written to the number for days), so replies arrive as button
// text plus the wamid of the card, which is how each tap finds its trip. The one typed
// answer is the alternative time after "Offer another time".

import { eq } from 'drizzle-orm'
import { db, trips } from '@/lib/db'
import { readReply, said, type WaMessage } from './types'
import { sendText } from './client'
import { toWaId } from './config'
import { parseWhen, formatWhenShort } from './when'
import { loadConversation, saveConversation } from './conversation'
import {
  OPS_BTN, ACTIVE_STATUSES, type Trip,
  getTrip, tripForOpsReply, sendDriverPicker, allocateDriver, declineTrip, offerNewTime,
  cancelTrip, keepWaiting, resolveNoShow, sendCarAnyway,
} from './trip'

const OPS_STEPS = {
  idle: 'idle',
  driverPick: 'awaiting_driver_pick',
  offerTime: 'awaiting_offer_time',
} as const

export async function handleOpsMessage(phone: string, message: WaMessage): Promise<void> {
  const to = toWaId(phone)
  const reply = readReply(message)
  const convo = await loadConversation(phone)

  // A list pick or a typed time answers the question we asked last; both refer to the
  // trip stored on the conversation, since the list is not a template card.
  if (reply.replyId?.startsWith('driver:')) {
    const trip = convo.tripId ? await getTrip(convo.tripId) : null
    const driverId = Number(reply.replyId.slice('driver:'.length))
    if (!trip || !isOpen(trip)) {
      await sendText(to, 'That request is no longer open.')
      await saveConversation(phone, OPS_STEPS.idle, {}, null, 'ops')
      return
    }
    const reassign = Boolean(trip.driverId)
    await allocateDriver(trip.id, driverId, 'ops', { reassign })
    await saveConversation(phone, OPS_STEPS.idle, {}, null, 'ops')
    return
  }

  if (convo.step === OPS_STEPS.offerTime && !reply.replyId && reply.text) {
    const trip = convo.tripId ? await getTrip(convo.tripId) : null
    if (!trip || trip.status !== 'requested') {
      await sendText(to, 'That request is no longer open.')
      await saveConversation(phone, OPS_STEPS.idle, {}, null, 'ops')
      return
    }
    const at = parseWhen(reply.text)
    if (!at || at.getTime() < Date.now()) {
      await sendText(to, 'I did not catch that time. Try something like "Saturday 08:00" or "tomorrow 14:00".')
      return
    }
    await offerNewTime(trip.id, at)
    await saveConversation(phone, OPS_STEPS.idle, {}, null, 'ops')
    return
  }

  // Everything else is a tap on a card. Without the card's wamid there is nothing to
  // tie the answer to, so fall back to the trip most recently put in front of her.
  const trip =
    (await tripForOpsReply(message.context?.id)) ??
    (convo.tripId ? await getTrip(convo.tripId) : null) ??
    (await onlyCandidate(reply))

  if (!trip) {
    await sendText(to, 'Reply using the buttons on a request card, or use the dashboard.')
    return
  }

  if (said(reply, OPS_BTN.accept)) {
    if (trip.status !== 'requested') {
      await sendText(to, `${trip.ref} is already ${trip.status.replace('_', ' ')}.`)
      return
    }
    const sent = await sendDriverPicker(trip.id)
    await saveConversation(phone, sent ? OPS_STEPS.driverPick : OPS_STEPS.idle, {}, trip.id, 'ops')
    return
  }

  if (said(reply, OPS_BTN.noCar)) {
    if (trip.status !== 'requested') {
      await sendText(to, `${trip.ref} is already ${trip.status.replace('_', ' ')}.`)
      return
    }
    await declineTrip(trip.id)
    await saveConversation(phone, OPS_STEPS.idle, {}, null, 'ops')
    return
  }

  if (said(reply, OPS_BTN.offerTime)) {
    if (trip.status !== 'requested') {
      await sendText(to, `${trip.ref} is already ${trip.status.replace('_', ' ')}.`)
      return
    }
    await sendText(to, `What time can you do for ${trip.ref} instead of ${formatWhenShort(trip.scheduledAt!)}? Type it, for example "Saturday 08:00".`)
    await saveConversation(phone, OPS_STEPS.offerTime, {}, trip.id, 'ops')
    return
  }

  if (said(reply, OPS_BTN.pickAnother)) {
    if (!isOpen(trip)) {
      await sendText(to, `${trip.ref} is ${trip.status.replace('_', ' ')} - nothing to reallocate.`)
      return
    }
    const sent = await sendDriverPicker(trip.id, `Who takes ${trip.ref} instead?`)
    await saveConversation(phone, sent ? OPS_STEPS.driverPick : OPS_STEPS.idle, {}, trip.id, 'ops')
    return
  }

  if (said(reply, OPS_BTN.cancelTrip)) {
    if (!isOpen(trip)) {
      await sendText(to, `${trip.ref} is already ${trip.status.replace('_', ' ')}.`)
      return
    }
    await cancelTrip(trip.id, 'ops', 'cancelled by Anneli from WhatsApp')
    await sendText(to, `${trip.ref} cancelled. The guest${trip.driverId ? ' and the driver have' : ' has'} been told.`)
    await saveConversation(phone, OPS_STEPS.idle, {}, null, 'ops')
    return
  }

  if (said(reply, OPS_BTN.keepWaiting)) {
    await keepWaiting(trip.id)
    return
  }
  if (said(reply, OPS_BTN.releaseHold)) {
    await resolveNoShow(trip.id, false)
    return
  }
  if (said(reply, OPS_BTN.chargeNoShow)) {
    await resolveNoShow(trip.id, true)
    return
  }
  if (said(reply, OPS_BTN.sendAnyway)) {
    await sendCarAnyway(trip.id)
    return
  }

  await sendText(to, `Not sure what to do with that for ${trip.ref}. Use the buttons on the card, or the dashboard.`)
}

/**
 * A tap without its card's wamid can still be unambiguous: "Accept" with one request
 * waiting, or "Keep waiting" with one driver at a gate. Anything else stays null and she
 * is asked to use the card.
 */
async function onlyCandidate(reply: ReturnType<typeof readReply>): Promise<Trip | null> {
  let status: Trip['status'] | null = null
  if (said(reply, OPS_BTN.accept, OPS_BTN.noCar, OPS_BTN.offerTime)) status = 'requested'
  if (said(reply, OPS_BTN.keepWaiting, OPS_BTN.releaseHold, OPS_BTN.chargeNoShow)) status = 'driver_waiting'
  if (!status) return null
  const rows = await db.select().from(trips).where(eq(trips.status, status)).limit(2)
  return rows.length === 1 ? rows[0] : null
}

function isOpen(trip: Trip): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(trip.status)
}
