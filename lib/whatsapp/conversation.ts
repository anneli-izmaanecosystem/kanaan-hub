// The guest side of the conversation — scenario 1 of the workbook (making the booking),
// the guest's confirmations on the morning of the trip (scenario 2), and the refusals
// and cancellations that end it early (scenario 3).
//
// Shape: every inbound message is handled by the function for the step the guest is
// currently on. Each handler does its work, sends the next message, and returns the step
// to move to. State lives in wa_conversations, not in memory, so a restart mid-booking
// loses nothing and a guest can answer an hour later.
//
// Button ids are the contract with WhatsApp: they come back verbatim on the webhook, so
// they are stable strings here and the visible titles can be reworded freely. Buttons on
// templates are the exception — they come back as their text (see trip.ts GUEST_BTN).

import { desc, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { db, trips, waConversations } from '@/lib/db'
import { sendText, sendButtons, sendCtaUrl } from './client'
import { mirrorFlow } from './mirror'
import { readReply, said, type WaMessage, isLocationMessage, type InboundReply } from './types'
import { resolvePlace, resolveSharedLocation, type ResolvedPlace } from './places'
import { parseWhen, formatWhenLong, formatTime, formatDayName } from './when'
import { config, tripRef, toWaId } from './config'
import { bookingWindowError, fareFor, loadSettings, type TransferSettings } from './settings'
import {
  ACTIVE_STATUSES, FARM, GUEST_BTN, type Trip,
  record, tripForReply, submitToOps, cancelTrip, acceptNewTime,
  guestConfirmedPickup, guestCannotSeeDriver, guestConfirmedDrop, guestNotAtDropYet,
  guestFeedback, guestComingNow, paymentsConfigured, toLabel,
} from './trip'

export const STEPS = {
  idle: 'idle',
  start: 'awaiting_start',
  when: 'awaiting_when',
  datetime: 'awaiting_datetime',
  from: 'awaiting_from',
  to: 'awaiting_to',
  placeConfirm: 'awaiting_place_confirm',
  name: 'awaiting_name',
  quoteConfirm: 'awaiting_quote_confirm',
  card: 'awaiting_card',
  ops: 'awaiting_ops',
  booked: 'booked',
  cancelConfirm: 'awaiting_cancel_confirm',
} as const

export type Step = (typeof STEPS)[keyof typeof STEPS]

export const BTN = {
  book: 'book',
  whenNow: 'when:now',
  whenLater: 'when:later',
  atFarm: 'from:farm',
  sendLocation: 'from:location',
  toFarm: 'to:farm',
  comingToFarm: 'end:coming',
  leavingFarm: 'end:leaving',
  placeYes: 'place:yes',
  placeNo: 'place:no',
  placeCloser: 'place:closer',
  placeEnd: 'place:end',
  quoteConfirm: 'quote:confirm',
  quoteWhy: 'quote:why',
  quoteChange: 'quote:change',
  cancelYes: 'cancel:yes',
  cancelNo: 'cancel:no',
} as const

/** Either end of the trip: the farm, or somewhere the guest named or pinned. */
type End = 'farm' | ResolvedPlace

/** Answers gathered before there is a trip row to put them on. */
export interface Draft {
  scheduledAt?: string        // ISO
  from?: End
  to?: End
  /** The end that is not the farm — what gets priced and confirmed. */
  place?: ResolvedPlace
  direction?: 'pickup' | 'drop'
  name?: string
  fare?: number
}

interface Conversation {
  phone: string
  step: string
  draft: Draft
  tripId: number | null
}

// ── state ────────────────────────────────────────────────────────────────────

export async function loadConversation(phone: string): Promise<Conversation> {
  const [row] = await db.select().from(waConversations).where(eq(waConversations.phone, phone))
  if (!row) return { phone, step: STEPS.idle, draft: {}, tripId: null }

  let draft: Draft = {}
  try {
    draft = row.draft ? (JSON.parse(row.draft) as Draft) : {}
  } catch {
    // A malformed draft should restart the booking, not wedge the guest on a step
    // whose handler cannot read its own state.
    console.error('[whatsapp] unreadable draft for', phone, '— starting over')
  }
  return { phone, step: row.step, draft, tripId: row.tripId }
}

export async function saveConversation(
  phone: string,
  step: string,
  draft: object,
  tripId: number | null = null,
  role: 'guest' | 'ops' | 'driver' = 'guest',
) {
  const values = {
    phone,
    role,
    step,
    draft: JSON.stringify(draft),
    tripId,
    lastInboundAt: new Date(),
    updatedAt: new Date(),
  }
  await db
    .insert(waConversations)
    .values(values)
    .onConflictDoUpdate({ target: waConversations.phone, set: values })

  mirrorFlow(phone, step, { ...draft, tripId }, { flowName: role === 'guest' ? 'kanaan_car_booking' : `kanaan_${role}` })
}

// ── steps ────────────────────────────────────────────────────────────────────

/** 1.01 — the opener, sent after any greeting or the printed keyword. */
async function askStart(to: string): Promise<Step> {
  await sendButtons(to, 'Welcome to Kanaan Guest Farm.\nI can arrange a car for you.', [
    { id: BTN.book, title: 'Book a car' },
  ])
  return STEPS.start
}

/** 1.02 */
async function askWhen(to: string): Promise<Step> {
  await sendButtons(to, 'When do you need the car?', [
    { id: BTN.whenNow, title: 'Now' },
    { id: BTN.whenLater, title: 'Pick a day and time' },
  ])
  return STEPS.when
}

/** 1.03 — the screens show a date picker. That needs a published WhatsApp Flow; until
 *  one exists this accepts typed text, which parseWhen handles. */
async function askDatetime(to: string): Promise<Step> {
  await sendText(
    to,
    'When would you like to leave?\nTell me the day and time - for example "Saturday 05:30" or "tomorrow 14:00".',
  )
  return STEPS.datetime
}

/** 1.04 — where the driver collects the guest. */
async function askFrom(to: string): Promise<Step> {
  await sendButtons(to, 'Where should the driver collect you?\nShare your location, or tap below if you are at the farm.', [
    { id: BTN.atFarm, title: 'I am at Kanaan' },
    { id: BTN.sendLocation, title: 'Send location' },
  ])
  return STEPS.from
}

/** 1.05 — the destination. */
async function askTo(to: string, from?: End): Promise<Step> {
  // Worded around what is already known: a guest collected away from the farm is
  // almost always coming to it, and typing the same place twice was the failure mode.
  const collectedAway = from && from !== 'farm'
  await sendButtons(
    to,
    collectedAway
      ? `We collect you at ${from.name}. Where are you going?\nTap below if you are coming to the farm, or type another place.`
      : 'Where are you going?\nType the place - a gate, a hotel, a landmark or an address - or share a location.',
    [{ id: BTN.toFarm, title: 'Kanaan Guest Farm' }],
  )
  return STEPS.to
}

/** 1.06 — quote the resolved place back before pricing against it. */
async function confirmPlace(to: string, place: ResolvedPlace): Promise<Step> {
  await sendButtons(
    to,
    `${place.name}\n${place.distanceKm} km, about ${place.durationMin} minutes\nIs this the right spot?`,
    [
      { id: BTN.placeYes, title: 'Yes, that one' },
      { id: BTN.placeNo, title: 'No, try again' },
    ],
  )
  return STEPS.placeConfirm
}

/** 1.07 */
async function askName(to: string): Promise<Step> {
  await sendText(to, 'What name should the driver ask for?')
  return STEPS.name
}

/** 1.08 — everything the guest is agreeing to, with the fare, before any card is asked for. */
async function confirmQuote(to: string, draft: Draft): Promise<Step> {
  const when = new Date(draft.scheduledAt!)
  const fromName = draft.from === 'farm' ? 'The farm gate' : draft.from!.name
  const toName = draft.to === 'farm' ? 'the farm gate' : draft.to!.name

  await sendButtons(
    to,
    [
      'Please confirm:',
      `${fromName} to ${toName}`,
      draft.name,
      formatWhenLong(when),
      `${draft.place!.distanceKm} km`,
      `Fare: R ${draft.fare}`,
    ].filter(Boolean).join('\n'),
    [
      { id: BTN.quoteConfirm, title: 'Confirm and add card' },
      { id: BTN.quoteWhy, title: 'Why no cash?' },
      { id: BTN.quoteChange, title: 'Change something' },
    ],
  )
  return STEPS.quoteConfirm
}

/** 3.01 — past the chat limit, hand off to Anneli rather than quoting. */
async function refuseTooFar(to: string, place: ResolvedPlace, settings: TransferSettings, step: Step): Promise<Step> {
  await sendButtons(
    to,
    `That is ${place.name} - ${place.distanceKm} km away, past the ${settings.maxChatKm} km limit for booking by chat.\n` +
      `Please call Anneli on ${settings.opsPhone} and she will arrange a transfer.`,
    [
      { id: BTN.placeCloser, title: 'Somewhere closer' },
      { id: BTN.placeEnd, title: 'End' },
    ],
  )
  return step
}

// ── committing the booking ───────────────────────────────────────────────────

/**
 * Writes the trip. The row is created before the card is captured so the reference
 * exists to quote and so an abandoned booking is visible rather than vanishing — an
 * abandoned trip stays `draft` and is never sent to Anneli.
 */
async function createTrip(phone: string, draft: Draft): Promise<number> {
  const [row] = await db
    .insert(trips)
    .values({
      // The final human-readable reference needs the generated id. Keep the temporary
      // value unique as well, otherwise two simultaneous inserts can collide on the
      // unique ref constraint before either gets its KN- reference.
      ref: `pending-${randomUUID()}`,
      direction: draft.direction!,
      status: 'draft',
      guestPhone: phone,
      guestName: draft.name ?? null,
      placeName: draft.place!.name,
      placeLat: String(draft.place!.lat),
      placeLng: String(draft.place!.lng),
      distanceKm: String(draft.place!.distanceKm),
      durationMin: draft.place!.durationMin,
      scheduledAt: new Date(draft.scheduledAt!),
      fare: String(draft.fare),
    })
    .returning({ id: trips.id })

  // The reference is derived from the id, so it needs a second write. Doing it here
  // rather than with a sequence keeps refs readable and gapless per trip.
  const ref = tripRef(row.id)
  await db.update(trips).set({ ref }).where(eq(trips.id, row.id))
  await record(row.id, 'guest', 'trip_created', ref)

  return row.id
}

/**
 * 1.09 — the card link, then Anneli. Stripe is not wired up yet: without a provider the
 * request goes straight to Anneli and the card is left for her to sort, rather than
 * sending a dead button or stalling the booking.
 */
async function askForCard(to: string, tripId: number): Promise<Step> {
  const url = await cardCaptureUrl(tripId)
  if (!url) {
    await record(tripId, 'system', 'card_skipped', 'no payment provider')
    await submitToOps(tripId)
    return STEPS.ops
  }
  await sendCtaUrl(to, 'Tap below to add your card.\nNothing is charged now.', 'Add card', url)
  return STEPS.card
}

/**
 * Where the Stripe Checkout session in `setup` mode will be created. Returns null until
 * that exists, which askForCard handles as a hand-off rather than a broken button.
 */
async function cardCaptureUrl(_tripId: number): Promise<string | null> {
  if (!paymentsConfigured()) return null
  throw new Error('Stripe card capture is not implemented yet — unset STRIPE_SECRET_KEY to fall back to the manual hand-off')
}

// ── an end of the trip from a reply ──────────────────────────────────────────

async function readEnd(message: WaMessage, reply: InboundReply, farmId: string): Promise<End | null | 'too-short'> {
  if (reply.replyId === farmId) return 'farm'
  if (isLocationMessage(message)) {
    return resolveSharedLocation(message.location.latitude, message.location.longitude, message.location.name)
  }
  if (!reply.text || reply.replyId) return 'too-short'
  if (/^(kanaan|the farm|farm|farm gate|kanaan guest farm)$/i.test(reply.text.trim())) return 'farm'
  return resolvePlace(reply.text)
}

// ── router ───────────────────────────────────────────────────────────────────

/**
 * Handles one inbound guest message against the step they are on.
 *
 * Unrecognised input re-asks the current question rather than advancing: a guest who
 * types "?" at the fare should see the fare again, not fall through to the next step.
 */
export async function handleGuestMessage(phone: string, message: WaMessage): Promise<void> {
  const to = toWaId(phone)
  const reply = readReply(message)
  const { replyId, text } = reply
  const convo = await loadConversation(phone)
  const draft = convo.draft

  // Replies about a live trip (the buttons on reminders, the driver-arrived card, the
  // fare) can arrive at any step, days after the booking was made.
  if (await handleTripReply(phone, message, reply, convo)) return

  // "cancel" always works, wherever the guest is. With a live trip it means that trip,
  // and goes through the same yes/no as the button.
  if (!replyId && /^(cancel|stop|start over|restart)\b/i.test(text)) {
    const live = await tripForReply(phone, 'guest', null)
    if (live && (ACTIVE_STATUSES as readonly string[]).includes(live.status) && !/^(start over|restart)/i.test(text)) {
      await askCancel(phone, to, live)
      return
    }
    await sendText(to, 'No problem - that request is cancelled. Say hello whenever you need a car.')
    await saveConversation(phone, STEPS.idle, {})
    return
  }

  switch (convo.step) {
    case STEPS.start: {
      if (replyId !== BTN.book && !said(reply, 'book a car', 'book', 'yes')) {
        await saveConversation(phone, await askStart(to), {})
        return
      }
      await saveConversation(phone, await askWhen(to), {})
      return
    }

    case STEPS.when: {
      if (replyId === BTN.whenNow || said(reply, 'now')) {
        const when = parseWhen('now')!
        const error = bookingWindowError(when, await loadSettings())
        if (error) {
          await sendText(to, `${error}\nPlease choose another time.`)
          await saveConversation(phone, await askWhen(to), draft)
          return
        }
        draft.scheduledAt = when.toISOString()
        await saveConversation(phone, await askFrom(to), draft)
        return
      }
      if (replyId === BTN.whenLater) {
        await saveConversation(phone, await askDatetime(to), draft)
        return
      }
      // A typed time works too — "tomorrow 14:00" without tapping the button first.
      const typed = text && !replyId ? parseWhen(text) : null
      if (typed) return handleDatetime(phone, to, typed, draft)
      await saveConversation(phone, await askWhen(to), draft)
      return
    }

    case STEPS.datetime: {
      const when = parseWhen(text)
      if (!when) {
        await sendText(to, 'Sorry, I did not catch that time. Try something like "Saturday 05:30" or "tomorrow 14:00".')
        await saveConversation(phone, STEPS.datetime, draft)
        return
      }
      return handleDatetime(phone, to, when, draft)
    }

    case STEPS.from: {
      if (replyId === BTN.sendLocation) {
        await sendText(to, 'Tap the attach (📎) button in WhatsApp, choose Location, and send where you are.')
        await saveConversation(phone, STEPS.from, draft)
        return
      }
      const end = await readEnd(message, reply, BTN.atFarm)
      if (end === 'too-short') {
        await saveConversation(phone, await askFrom(to), draft)
        return
      }
      if (!end) {
        await sendText(to, 'I could not find that one. Try the name of a gate, a town or a lodge - or send your location.')
        await saveConversation(phone, STEPS.from, draft)
        return
      }
      draft.from = end
      await saveConversation(phone, await askTo(to, draft.from), draft)
      return
    }

    case STEPS.to: {
      // Answer to "coming to Kanaan or leaving it?" after two non-farm places.
      if (replyId === BTN.comingToFarm || replyId === BTN.leavingFarm) {
        if (replyId === BTN.comingToFarm) draft.to = 'farm'
        else { draft.to = draft.from; draft.from = 'farm' }
        return settlePlace(phone, to, draft)
      }
      const end = await readEnd(message, reply, BTN.toFarm)
      if (end === 'too-short') {
        await saveConversation(phone, await askTo(to, draft.from), draft)
        return
      }
      if (!end) {
        await sendText(to, 'I could not find that one. Try the name of a gate, a town or a lodge - or send your location.')
        await saveConversation(phone, STEPS.to, draft)
        return
      }
      draft.to = end
      return settlePlace(phone, to, draft)
    }

    case STEPS.placeConfirm: {
      if (replyId === BTN.placeNo) {
        // Re-ask whichever end was the far one; the farm end stands.
        const redo: Step = draft.direction === 'drop' ? STEPS.to : STEPS.from
        delete draft.place
        if (redo === STEPS.to) delete draft.to
        else delete draft.from
        await saveConversation(phone, redo === STEPS.to ? await askTo(to, draft.from) : await askFrom(to), draft)
        return
      }
      if (replyId === BTN.placeCloser) {
        // The far end was the problem, whichever end that was.
        const redo: Step = draft.direction === 'drop' ? STEPS.to : STEPS.from
        delete draft.place
        if (redo === STEPS.to) delete draft.to
        else delete draft.from
        await saveConversation(phone, redo === STEPS.to ? await askTo(to, draft.from) : await askFrom(to), draft)
        return
      }
      if (!replyId && (text || isLocationMessage(message))) {
        // Typed a place instead of tapping: treat it as a fresh answer for the far end.
        const end = await readEnd(message, reply, '')
        if (!end || end === 'too-short') {
          await sendText(to, 'I could not find that one. Try the name of a gate, a town or a lodge - or send your location.')
          await saveConversation(phone, STEPS.placeConfirm, draft)
          return
        }
        if (draft.direction === 'drop') draft.to = end
        else draft.from = end
        delete draft.place
        return settlePlace(phone, to, draft)
      }
      if (replyId === BTN.placeEnd) {
        const settings = await loadSettings()
        await sendText(to, `No problem. Call Anneli on ${settings.opsPhone} whenever you are ready.`)
        await saveConversation(phone, STEPS.idle, {})
        return
      }
      if (replyId !== BTN.placeYes) {
        await saveConversation(phone, await confirmPlace(to, draft.place!), draft)
        return
      }
      await saveConversation(phone, await askName(to), draft)
      return
    }

    case STEPS.name: {
      if (!text || replyId) {
        await saveConversation(phone, await askName(to), draft)
        return
      }
      draft.name = text.slice(0, 60)
      const settings = await loadSettings()
      draft.fare = fareFor(draft.place!.distanceKm, settings, draft.place!.fixedFare)
      await saveConversation(phone, await confirmQuote(to, draft), draft)
      return
    }

    case STEPS.quoteConfirm: {
      if (replyId === BTN.quoteWhy) {
        // Two buttons, not three: "Why no cash?" has already been answered.
        await sendButtons(
          to,
          'We are a cash-free service, so nobody has to carry money on a trip.\n' +
            'You add your card now. We hold the amount shortly before you travel, and it is only charged once the trip is finished.',
          [
            { id: BTN.quoteConfirm, title: 'Confirm and add card' },
            { id: BTN.quoteChange, title: 'Change something' },
          ],
        )
        await saveConversation(phone, STEPS.quoteConfirm, draft)
        return
      }

      if (replyId === BTN.quoteChange) {
        // Start again from the time but keep the name — it is the one answer that does
        // not change between attempts.
        await saveConversation(phone, await askWhen(to), { name: draft.name })
        return
      }

      if (replyId !== BTN.quoteConfirm) {
        await saveConversation(phone, await confirmQuote(to, draft), draft)
        return
      }

      const tripId = await createTrip(phone, draft)
      await saveConversation(phone, await askForCard(to, tripId), {}, tripId)
      return
    }

    case STEPS.card: {
      await sendText(to, 'Tap "Add card" above to finish - nothing is charged now. Or say "cancel" to drop the request.')
      await saveConversation(phone, STEPS.card, draft, convo.tripId)
      return
    }

    case STEPS.ops:
    case STEPS.booked: {
      // Nothing to decide — the guest is waiting on Anneli or on the day.
      await sendText(to, 'Thanks - nothing more needed from you right now. I will message you as soon as there is news.')
      await saveConversation(phone, convo.step, draft, convo.tripId)
      return
    }

    case STEPS.cancelConfirm: {
      const trip = convo.tripId ? await tripForReply(phone, 'guest', null) : null
      if (replyId === BTN.cancelYes && trip) {
        await cancelTrip(trip.id, 'guest', 'guest cancelled by chat')
        await saveConversation(phone, STEPS.idle, {})
        return
      }
      if (replyId === BTN.cancelNo || !trip) {
        await sendText(to, trip ? `Kept. Your car for ${formatWhenLong(trip.scheduledAt!)} stands.` : 'There is nothing to cancel.')
        await saveConversation(phone, trip ? STEPS.booked : STEPS.idle, {}, trip?.id ?? null)
        return
      }
      await askCancel(phone, to, trip)
      return
    }

    default: {
      await saveConversation(phone, await askStart(to), {})
      return
    }
  }
}

async function handleDatetime(phone: string, to: string, when: Date, draft: Draft) {
  if (when.getTime() < Date.now()) {
    await sendText(to, 'That time has already passed. When would you like to leave?')
    await saveConversation(phone, STEPS.datetime, draft)
    return
  }
  const windowError = bookingWindowError(when, await loadSettings())
  if (windowError) {
    await sendText(to, `${windowError}\nPlease choose another time.`)
    await saveConversation(phone, STEPS.datetime, draft)
    return
  }
  draft.scheduledAt = when.toISOString()
  await saveConversation(phone, await askFrom(to), draft)
}

/**
 * Both ends are known. One of them has to be the farm — that is the end that gets
 * priced — so work out which, check the distance, and confirm the far end back.
 */
async function settlePlace(phone: string, to: string, draft: Draft) {
  if (draft.from === 'farm' && draft.to === 'farm') {
    await sendText(to, 'The pickup and the drop are both the farm. Where are you going?')
    delete draft.to
    await saveConversation(phone, await askTo(to, draft.from), draft)
    return
  }
  if (draft.from !== 'farm' && draft.to !== 'farm') {
    // Two places and neither is the farm. Nine times out of ten the guest has typed the
    // same place twice, so ask which way the trip runs rather than re-asking for a place.
    const place = (draft.to as ResolvedPlace).name
    await sendButtons(
      to,
      `Got it - ${place}. Is that where we collect you, or where you are going? One end of the trip is always the farm.`,
      [
        { id: BTN.comingToFarm, title: 'Coming to Kanaan' },
        { id: BTN.leavingFarm, title: 'Leaving Kanaan' },
      ],
    )
    await saveConversation(phone, STEPS.to, draft)
    return
  }

  draft.direction = draft.from === 'farm' ? 'drop' : 'pickup'
  const place = (draft.direction === 'drop' ? draft.to : draft.from) as ResolvedPlace

  const settings = await loadSettings()
  if (place.distanceKm > settings.maxChatKm) {
    draft.place = place
    await saveConversation(phone, await refuseTooFar(to, place, settings, STEPS.placeConfirm), draft)
    return
  }

  draft.place = place
  await saveConversation(phone, await confirmPlace(to, place), draft)
}

// ── replies about a live trip ────────────────────────────────────────────────

async function askCancel(phone: string, to: string, trip: Trip) {
  await sendButtons(
    to,
    `Cancel your car to ${toLabel(trip)} on ${formatDayName(trip.scheduledAt!)} at ${formatTime(trip.scheduledAt!)}?\nRef ${trip.ref}`,
    [
      { id: BTN.cancelYes, title: 'Yes, cancel it' },
      { id: BTN.cancelNo, title: 'No, keep it' },
    ],
  )
  await saveConversation(phone, STEPS.cancelConfirm, {}, trip.id)
}

/**
 * Buttons on the templates and cards sent after booking. Returns true when the message
 * was one of those and has been dealt with.
 */
async function handleTripReply(phone: string, message: WaMessage, reply: InboundReply, convo: Conversation): Promise<boolean> {
  const to = toWaId(phone)
  const id = reply.replyId ?? ''

  // Anneli's alternative time.
  if (id.startsWith('offer:accept:')) {
    const trip = await tripForReply(phone, 'guest', message.context?.id)
    if (trip && trip.status === 'requested') {
      await acceptNewTime(trip.id, new Date(id.slice('offer:accept:'.length)))
      await saveConversation(phone, STEPS.ops, {}, trip.id)
    }
    return true
  }

  const wantsCancel =
    id === 'offer:decline' ||
    said(reply, GUEST_BTN.cancelTrip, GUEST_BTN.cancelRequest, GUEST_BTN.cancelTheTrip)
  const isTripButton =
    wantsCancel ||
    id.startsWith('guest:') ||
    said(reply, GUEST_BTN.canSee, GUEST_BTN.notYet, GUEST_BTN.weAreHere, GUEST_BTN.comingNow,
      GUEST_BTN.tryAnotherTime, GUEST_BTN.end, GUEST_BTN.good, GUEST_BTN.notGood)
  if (!isTripButton) return false

  const trip = await tripForReply(phone, 'guest', message.context?.id)

  // Feedback arrives after the trip has closed, so it is not in the active set.
  if (id.startsWith('guest:feedback:') || said(reply, GUEST_BTN.good, GUEST_BTN.notGood)) {
    const closed = trip ?? (await lastTrip(phone))
    if (closed) await guestFeedback(closed.id, id === 'guest:feedback:good' || said(reply, GUEST_BTN.good))
    return true
  }

  // "Try another time" / "End" after a decline.
  if (said(reply, GUEST_BTN.tryAnotherTime)) {
    const last = await lastTrip(phone)
    const draft: Draft = last ? { name: last.guestName ?? undefined } : {}
    await saveConversation(phone, await askWhen(to), draft)
    return true
  }
  if (said(reply, GUEST_BTN.end)) {
    await sendText(to, `No problem. Say hello whenever you need a car, or call Anneli on ${(await loadSettings()).opsPhone}.`)
    await saveConversation(phone, STEPS.idle, {})
    return true
  }

  if (!trip || !(ACTIVE_STATUSES as readonly string[]).includes(trip.status)) {
    await sendText(to, 'There is no live booking on this number. Say hello to book a car.')
    return true
  }

  if (wantsCancel) {
    await askCancel(phone, to, trip)
    return true
  }

  switch (trip.status) {
    case 'driver_waiting':
      if (id === 'guest:at_drop:yes' || said(reply, GUEST_BTN.weAreHere)) break
      if (said(reply, GUEST_BTN.canSee)) { await guestConfirmedPickup(trip.id); return true }
      if (said(reply, GUEST_BTN.notYet)) { await guestCannotSeeDriver(trip.id); return true }
      if (said(reply, GUEST_BTN.comingNow)) { await guestComingNow(trip.id); return true }
      break
    case 'in_progress':
      if (id === 'guest:at_drop:yes' || said(reply, GUEST_BTN.weAreHere)) { await guestConfirmedDrop(trip.id); return true }
      if (id === 'guest:at_drop:no' || said(reply, GUEST_BTN.notYet)) { await guestNotAtDropYet(trip.id); return true }
      break
  }

  await sendText(to, `Noted. Your car (${trip.ref}) is ${describe(trip)}. Nothing more is needed from you right now.`)
  return true
}

async function lastTrip(phone: string): Promise<Trip | null> {
  const [row] = await db.select().from(trips).where(eq(trips.guestPhone, phone)).orderBy(desc(trips.createdAt)).limit(1)
  return row ?? null
}

function describe(trip: Trip): string {
  switch (trip.status) {
    case 'requested': return 'with Anneli, waiting for a driver'
    case 'allocated': return `confirmed for ${formatWhenLong(trip.scheduledAt!)}`
    case 'driver_en_route': return 'on its way to you'
    case 'driver_waiting': return 'waiting for you at the pickup'
    case 'in_progress': return 'under way'
    default: return trip.status
  }
}

/** Exposed for the webhook to greet a guest who has never written before. */
export async function startConversation(phone: string) {
  await saveConversation(phone, await askStart(toWaId(phone)), {})
}

export { formatTime, FARM, config as farmConfig }
