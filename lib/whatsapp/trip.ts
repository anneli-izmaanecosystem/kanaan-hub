// The trip lifecycle — every status change a trip can go through, and who is told.
//
// The guest, ops and driver conversations all end up here: they read a reply, decide
// which transition it means, and call one function. Each function writes the status and
// the audit event first, then sends the messages, each one guarded — a template that
// fails to land must never leave the trip half-moved, and one failed send must not stop
// the next party being told.
//
// Out-of-band messages (anything not a direct reply inside a live conversation) go as
// templates: the driver and Anneli may not have written to the number for days, and a
// guest's 24-hour window is usually shut by the morning of the trip.

import { and, eq, inArray } from 'drizzle-orm'
import { db, trips, tripEvents, drivers, waMessages } from '@/lib/db'
import { sendText, sendButtons, sendList, sendLocation, sendTemplate, type ReplyButton } from './client'
import { config, toWaId } from './config'
import { loadSettings } from './settings'
import { formatWhenShort, formatWhenLong, formatTime, formatDayName } from './when'

export type Trip = typeof trips.$inferSelect
export type Driver = typeof drivers.$inferSelect
export type Actor = 'guest' | 'ops' | 'driver' | 'system'

/** Statuses a trip can be acted on from — anything else is finished. */
export const ACTIVE_STATUSES = ['requested', 'allocated', 'driver_en_route', 'driver_waiting', 'in_progress'] as const

export const FARM = 'the farm gate'

// ── button labels ────────────────────────────────────────────────────────────
// Template quick-reply buttons come back as their visible text, so these strings are
// the contract with Meta's approved templates. Change them there first.

export const OPS_BTN = {
  accept: 'Accept',
  noCar: 'No car available',
  offerTime: 'Offer another time',
  pickAnother: 'Pick another driver',
  cancelTrip: 'Cancel the trip',
  releaseHold: 'Release the hold',
  chargeNoShow: 'Charge a no-show',
  keepWaiting: 'Keep waiting',
  sendAnyway: 'Send the car anyway',
} as const

export const DRIVER_BTN = {
  noted: 'Noted',
  cannotTake: 'I cannot take it',
  left: 'I have left',
  cannotMake: 'I cannot make it',
  arrived: 'I have arrived',
  atDrop: 'Arrived at drop',
} as const

export const GUEST_BTN = {
  cancelTrip: 'Cancel this trip',
  cancelRequest: 'Cancel the request',
  cancelTheTrip: 'Cancel the trip',
  tryAnotherTime: 'Try another time',
  end: 'End',
  canSee: 'Yes, I can see him',
  notYet: 'Not yet',
  weAreHere: 'Yes, we are here',
  comingNow: 'Coming now',
  good: 'Good',
  notGood: 'Not good',
} as const

// ── lookups ──────────────────────────────────────────────────────────────────

export async function getTrip(id: number): Promise<Trip | undefined> {
  const [trip] = await db.select().from(trips).where(eq(trips.id, id))
  return trip
}

export async function getDriver(id: number): Promise<Driver | undefined> {
  const [driver] = await db.select().from(drivers).where(eq(drivers.id, id))
  return driver
}

/** A trip's driver, or null while nobody is allocated. */
export async function driverFor(trip: Trip): Promise<Driver | null> {
  return trip.driverId ? (await getDriver(trip.driverId)) ?? null : null
}

/**
 * The trip a reply is about. A tap on a template button carries the wamid of the card
 * it was on, which is the most reliable link; failing that, the sender's single live
 * trip. Returns null when there is nothing to act on or the answer is ambiguous.
 */
export async function tripForReply(
  phone: string,
  role: 'guest' | 'driver',
  contextWamid?: string | null,
): Promise<Trip | null> {
  if (contextWamid) {
    const [sent] = await db
      .select({ tripId: waMessages.tripId })
      .from(waMessages)
      .where(eq(waMessages.waMessageId, contextWamid))
    if (sent?.tripId) return (await getTrip(sent.tripId)) ?? null
  }

  const rows = await db
    .select()
    .from(trips)
    .where(and(inArray(trips.status, [...ACTIVE_STATUSES]), byRole(role, phone)))
    .orderBy(trips.scheduledAt)
  return rows.length === 1 ? rows[0] : rows[0] ?? null
}

function byRole(role: 'guest' | 'driver', phone: string) {
  if (role === 'guest') return eq(trips.guestPhone, phone)
  // Drivers are matched through their row rather than a phone column on the trip.
  return inArray(
    trips.driverId,
    db.select({ id: drivers.id }).from(drivers).where(eq(drivers.phone, phone)),
  )
}

/** Trip a contextual reply from Anneli refers to, else null. */
export async function tripForOpsReply(contextWamid?: string | null): Promise<Trip | null> {
  if (!contextWamid) return null
  const [sent] = await db
    .select({ tripId: waMessages.tripId })
    .from(waMessages)
    .where(eq(waMessages.waMessageId, contextWamid))
  return sent?.tripId ? (await getTrip(sent.tripId)) ?? null : null
}

// ── audit + sending ──────────────────────────────────────────────────────────

export async function record(tripId: number, actor: Actor, event: string, detail?: string) {
  await db.insert(tripEvents).values({ tripId, actor, event, detail: detail ?? null })
}

export async function eventsFor(tripId: number) {
  return db.select().from(tripEvents).where(eq(tripEvents.tripId, tripId)).orderBy(tripEvents.at)
}

/**
 * Ties a sent message to its trip. client.ts records every outbound row; this adds the
 * trip id so a later tap on the card can be traced back to it.
 */
async function logOutbound(waMessageId: string | null, tripId: number | null) {
  if (!waMessageId || !tripId) return
  await db.update(waMessages).set({ tripId }).where(eq(waMessages.waMessageId, waMessageId))
}

/** One party's send, isolated: a failure is logged against the trip and swallowed. */
async function guarded(tripId: number | null, what: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (err) {
    console.error(`[whatsapp] ${what} failed —`, err)
    if (tripId) await record(tripId, 'system', 'send_failed', `${what}: ${(err as Error).message}`).catch(() => {})
  }
}

export async function notify(
  role: 'guest' | 'ops' | 'driver',
  to: string,
  tripId: number | null,
  template: string,
  params: string[],
  opts: { header?: string[]; urlButtonParam?: string } = {},
) {
  await guarded(tripId, `${template} to ${role}`, async () => {
    // Template parameters may not contain newlines or tabs.
    const body = params.map(p => p.replace(/\s+/g, ' ').trim())
    const id = await sendTemplate(toWaId(to), template, { body, header: opts.header, urlButtonParam: opts.urlButtonParam })
    await logOutbound(id, tripId)
  })
}

export async function say(role: 'guest' | 'ops' | 'driver', to: string, tripId: number | null, body: string, buttons?: ReplyButton[]) {
  await guarded(tripId, `message to ${role}`, async () => {
    const id = buttons?.length ? await sendButtons(toWaId(to), body, buttons) : await sendText(toWaId(to), body)
    await logOutbound(id, tripId)
  })
}

async function opsNumber(): Promise<string | null> {
  const { opsWhatsapp } = await loadSettings()
  if (!opsWhatsapp) console.error('[whatsapp] KANAAN_OPS_WHATSAPP is not set — Anneli cannot be told')
  return opsWhatsapp || null
}

async function setStatus(tripId: number, status: Trip['status'], extra: Partial<Trip> = {}) {
  await db.update(trips).set({ status, updatedAt: new Date(), ...extra }).where(eq(trips.id, tripId))
}

// ── wording helpers ──────────────────────────────────────────────────────────

export function fromLabel(trip: Trip): string {
  return trip.direction === 'drop' ? FARM : trip.placeName ?? 'your location'
}

export function toLabel(trip: Trip): string {
  return trip.direction === 'drop' ? trip.placeName ?? 'your destination' : FARM
}

function pickupAddress(trip: Trip): string {
  return trip.direction === 'drop' ? config.pickupAddress : trip.placeName ?? 'guest location'
}

function guestLabel(trip: Trip): string {
  return trip.guestName ?? trip.roomLabel ?? 'the guest'
}

function fare(trip: Trip): string {
  return String(Math.round(Number(trip.fare ?? 0)))
}

function heldNotCaptured(trip: Trip): boolean {
  return Boolean(trip.heldAt && !trip.releasedAt && !trip.capturedAt)
}

/** Whether a card provider exists. Until Stripe is wired, holds and charges are logged, not made. */
export function paymentsConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

// ── 1. making the booking ────────────────────────────────────────────────────

/** 1.10 / 1.11 — the guest is told, then the request is put in front of Anneli. */
export async function submitToOps(tripId: number) {
  const trip = await getTrip(tripId)
  if (!trip) return

  await setStatus(tripId, 'requested')
  await record(tripId, 'system', 'sent_to_ops')

  await say('guest', trip.guestPhone, tripId, `Sent to Anneli. Your reference is ${trip.ref}.\nNothing has been charged.`)
  await sendNewRequestCard(trip)
}

/** Anneli's request card, with Accept / No car available / Offer another time. */
export async function sendNewRequestCard(trip: Trip) {
  const ops = await opsNumber()
  if (!ops) return
  await notify('ops', ops, trip.id, 'kn_ops_new_request', [
    formatWhenShort(trip.scheduledAt!),
    guestLabel(trip),
    trip.direction === 'drop' ? trip.placeName ?? '' : `${FARM} (collect from ${trip.placeName})`,
    String(trip.distanceKm ?? ''),
    fare(trip),
    trip.ref,
  ])
}

/** The on-duty drivers Anneli can pick from, or null when there are none. */
export async function sendDriverPicker(tripId: number, body = 'Which driver is going?'): Promise<boolean> {
  const ops = await opsNumber()
  if (!ops) return false
  const rows = await db
    .select()
    .from(drivers)
    .where(and(eq(drivers.active, true), eq(drivers.onDuty, true)))
    .limit(10)
  if (rows.length === 0) {
    await say('ops', ops, tripId, 'No drivers are on duty. Add or switch one on in the dashboard, then tap Accept again.')
    return false
  }
  await guarded(tripId, 'driver picker', async () => {
    const id = await sendList(
      toWaId(ops),
      body,
      'Choose a driver',
      rows.map(d => ({ id: `driver:${d.id}`, title: `${d.name} - ${d.plate}`.slice(0, 24), description: d.vehicle ?? undefined })),
    )
    await logOutbound(id, tripId)
  })
  return true
}

/**
 * Anneli picked a driver. Confirms to the guest, briefs the driver (with a map pin for
 * the far end), and closes the loop with Anneli. `reassign` is the driver-cannot-go
 * path: the guest is told who is coming instead, not booked afresh.
 */
export async function allocateDriver(tripId: number, driverId: number, by: 'ops' | 'board', opts: { reassign?: boolean } = {}) {
  const trip = await getTrip(tripId)
  const driver = await getDriver(driverId)
  if (!trip || !driver) return

  await setStatus(tripId, 'allocated', { driverId: driver.id })
  await record(tripId, 'ops', opts.reassign ? 'driver_reassigned' : 'driver_allocated', `${driver.name} (${driver.plate})${by === 'board' ? ' — from the board' : ''}`)

  if (opts.reassign) {
    await notify('guest', trip.guestPhone, tripId, 'kn_guest_driver_changed', [
      trip.ref, driver.name, driver.plate, formatTime(trip.scheduledAt!),
    ])
  } else {
    await notify('guest', trip.guestPhone, tripId, 'kn_guest_trip_confirmed', [
      driver.name, driver.plate, driver.vehicle ?? 'vehicle',
      formatDayName(trip.scheduledAt!), formatTime(trip.scheduledAt!), fare(trip),
    ])
  }

  await notify('driver', driver.phone, tripId, 'kn_driver_new_trip', [
    formatWhenShort(trip.scheduledAt!), pickupAddress(trip), guestLabel(trip), toLabel(trip), trip.ref,
  ])

  // The far end as a pin the driver can tap for directions.
  if (trip.placeLat && trip.placeLng) {
    await guarded(tripId, 'driver map pin', () =>
      sendLocation(toWaId(driver.phone), {
        latitude: Number(trip.placeLat), longitude: Number(trip.placeLng),
        name: `${trip.placeName} - tap for directions`, address: trip.placeName ?? undefined,
      }),
    )
  }

  const ops = await opsNumber()
  if (ops && by === 'ops') {
    await say('ops', ops, tripId, `Done. The guest and ${driver.name} have both been told.\nRef ${trip.ref} is confirmed.`)
  }

  // A trip leaving within the nudge window gets its "I have left" card now rather than
  // waiting for the scheduler.
  const settings = await loadSettings()
  if (trip.scheduledAt!.getTime() - Date.now() <= settings.driverNudgeMin * 60_000) {
    await sendDriverReminder({ ...trip, driverId: driver.id, status: 'allocated' }, driver)
  }
}

/** 3.02 — Anneli has no car. Nothing was ever held. */
export async function declineTrip(tripId: number) {
  const trip = await getTrip(tripId)
  if (!trip) return
  await setStatus(tripId, 'declined')
  await record(tripId, 'ops', 'declined', 'no car available')

  await notify('guest', trip.guestPhone, tripId, 'kn_guest_no_car_available', [
    formatTime(trip.scheduledAt!), formatDayName(trip.scheduledAt!),
  ])
  const ops = await opsNumber()
  if (ops) await say('ops', ops, tripId, `Told the guest. Ref ${trip.ref} is closed and nothing was held.`)
}

/** Anneli proposes a different departure; the guest is asked to take it or drop the request. */
export async function offerNewTime(tripId: number, at: Date) {
  const trip = await getTrip(tripId)
  if (!trip) return
  await record(tripId, 'ops', 'time_offered', at.toISOString())
  await say('guest', trip.guestPhone, tripId,
    `Sorry - no car is free at ${formatTime(trip.scheduledAt!)} on ${formatDayName(trip.scheduledAt!)}.\n` +
      `Anneli can do ${formatWhenLong(at)} instead. The fare stays R ${fare(trip)}.\nNothing has been held or charged.`,
    [
      { id: `offer:accept:${at.toISOString()}`, title: 'Take that time' },
      { id: 'offer:decline', title: 'Cancel the request' },
    ])
  const ops = await opsNumber()
  if (ops) await say('ops', ops, tripId, `Offered ${formatWhenShort(at)} to the guest for ${trip.ref}. You will get the request card back if they take it.`)
}

/** The guest took the offered time: the request goes back to Anneli to allocate. */
export async function acceptNewTime(tripId: number, at: Date) {
  const trip = await getTrip(tripId)
  if (!trip) return
  await db.update(trips).set({ scheduledAt: at, updatedAt: new Date() }).where(eq(trips.id, tripId))
  await record(tripId, 'guest', 'time_accepted', at.toISOString())
  await say('guest', trip.guestPhone, tripId, `Thanks - your car is now down for ${formatWhenLong(at)}. Anneli will confirm the driver shortly.`)
  await sendNewRequestCard({ ...trip, scheduledAt: at })
}

// ── cancellations ────────────────────────────────────────────────────────────

/**
 * Cancel from any side. Wording turns on whether money is held: telling a guest nothing
 * was charged when they can see a hold on their statement is the worst version of this.
 */
export async function cancelTrip(tripId: number, by: Actor, reason?: string) {
  const trip = await getTrip(tripId)
  if (!trip) return
  const driver = await driverFor(trip)

  const held = heldNotCaptured(trip)
  await setStatus(tripId, 'cancelled', { cancelledAt: new Date(), ...(held ? { releasedAt: new Date() } : {}) })
  await record(tripId, by, 'cancelled', reason)
  if (held) await record(tripId, 'system', paymentsConfigured() ? 'hold_released' : 'hold_release_skipped', 'no payment provider')

  const money = held
    ? `The hold of R ${fare(trip)} is being released. It can take a few working days to clear from your statement.`
    : 'No hold was placed and nothing is charged.'

  if (by === 'guest') {
    await say('guest', trip.guestPhone, tripId, `Cancelled.${driver ? ` ${driver.name} has been told.` : ''}\n${money}`)
  } else {
    await say('guest', trip.guestPhone, tripId, `Trip ${trip.ref} has been cancelled${by === 'ops' ? ' by Anneli' : ''}.\n${money}`)
  }

  if (driver && by !== 'driver') {
    await notify('driver', driver.phone, tripId, 'kn_driver_trip_cancelled', [
      trip.ref, formatDayName(trip.scheduledAt!), formatTime(trip.scheduledAt!),
    ])
  }

  const ops = await opsNumber()
  if (ops && by !== 'ops') {
    await notify('ops', ops, tripId, 'kn_ops_trip_cancelled', [
      trip.ref, driver ? driver.name : 'No driver was allocated yet, so nobody',
    ])
  }
}

// ── driver cannot go ─────────────────────────────────────────────────────────

/** 3.04 — the driver hands the trip back and Anneli is asked to reallocate. */
export async function driverDeclined(tripId: number, driver: Driver) {
  const trip = await getTrip(tripId)
  if (!trip) return
  await record(tripId, 'driver', 'driver_declined', `${driver.name} (${driver.plate})`)
  await say('driver', driver.phone, tripId, `Thanks for letting us know. Anneli will find another driver for ${trip.ref}.`)

  const ops = await opsNumber()
  if (ops) {
    await notify('ops', ops, tripId, 'kn_ops_driver_unavailable', [
      trip.ref, driver.name, formatTime(trip.scheduledAt!),
    ])
  }
}

// ── 2. on the morning of the trip ────────────────────────────────────────────

export async function sendEveningReminder(trip: Trip, driver: Driver) {
  await record(trip.id, 'system', 'guest_reminder_sent')
  await notify('guest', trip.guestPhone, trip.id, 'kn_guest_trip_reminder_evening', [
    toLabel(trip), formatTime(trip.scheduledAt!), driver.name, driver.plate, fare(trip),
  ])
}

export async function sendDriverReminder(trip: Trip, driver: Driver) {
  await record(trip.id, 'system', 'driver_reminder_sent')
  await notify('driver', driver.phone, trip.id, 'kn_driver_trip_reminder', [
    trip.ref, formatTime(trip.scheduledAt!), pickupAddress(trip), toLabel(trip),
  ])
}

/**
 * The hold an hour before pickup. Without a payment provider this is recorded and
 * skipped, so the rest of the morning still runs; nothing tells the guest money was
 * held when it was not.
 */
export async function placeHold(trip: Trip) {
  if (!paymentsConfigured()) {
    await record(trip.id, 'system', 'hold_skipped', 'no payment provider')
    return
  }
  throw new Error('Stripe holds are not implemented yet — unset STRIPE_SECRET_KEY')
}

/** Driver tapped "I have left". */
export async function driverLeft(tripId: number, driver: Driver) {
  const trip = await getTrip(tripId)
  if (!trip) return
  await setStatus(tripId, 'driver_en_route')
  await record(tripId, 'driver', 'driver_left')

  await say('driver', driver.phone, tripId, 'Thanks. The guest has been told you are on your way.', [
    { id: 'driver:arrived', title: DRIVER_BTN.arrived },
  ])
  await notify('guest', trip.guestPhone, tripId, 'kn_guest_driver_on_way', [
    driver.name, driver.plate, driver.vehicle ?? 'the car', driver.phone,
  ])
  const ops = await opsNumber()
  if (ops) await notify('ops', ops, tripId, 'kn_ops_trip_left', [trip.ref, driver.name, guestLabel(trip)])
}

/** Driver tapped "I have arrived" at the pickup. Nothing moves until the guest confirms. */
export async function driverArrived(tripId: number, driver: Driver) {
  const trip = await getTrip(tripId)
  if (!trip) return
  await setStatus(tripId, 'driver_waiting')
  await record(tripId, 'driver', 'driver_arrived')

  await say('driver', driver.phone, tripId, 'Waiting for the guest to confirm.')
  await notify('guest', trip.guestPhone, tripId, 'kn_guest_driver_arrived', [driver.name, fromLabel(trip)])
  const ops = await opsNumber()
  if (ops) await notify('ops', ops, tripId, 'kn_ops_trip_at_pickup', [trip.ref, driver.name, fromLabel(trip)])
}

/** Guest tapped "Yes, I can see him". */
export async function guestConfirmedPickup(tripId: number) {
  const trip = await getTrip(tripId)
  if (!trip) return
  const driver = await driverFor(trip)
  await setStatus(tripId, 'in_progress')
  await record(tripId, 'guest', 'guest_confirmed_pickup')

  await say('guest', trip.guestPhone, tripId, 'Trip started. Safe travels.')
  if (driver) {
    await say('driver', driver.phone, tripId, 'Guest confirmed. Trip started.', [
      { id: 'driver:at_drop', title: DRIVER_BTN.atDrop },
    ])
  }
  const ops = await opsNumber()
  if (ops) await notify('ops', ops, tripId, 'kn_ops_trip_started', [trip.ref])
}

/** Guest cannot see the driver yet — the driver is told, nothing else changes. */
export async function guestCannotSeeDriver(tripId: number) {
  const trip = await getTrip(tripId)
  if (!trip) return
  const driver = await driverFor(trip)
  await record(tripId, 'guest', 'guest_not_yet')
  await say('guest', trip.guestPhone, tripId, `OK. Tap "${GUEST_BTN.canSee}" as soon as you do.`)
  if (driver) await say('driver', driver.phone, tripId, 'The guest cannot see you yet. Please stay at the pickup point.')
}

/** Driver tapped "Arrived at drop". */
export async function driverAtDrop(tripId: number, driver: Driver) {
  const trip = await getTrip(tripId)
  if (!trip) return
  await record(tripId, 'driver', 'driver_at_drop')
  await say('driver', driver.phone, tripId, 'Waiting for the guest to confirm.')
  await say('guest', trip.guestPhone, tripId, `${driver.name} says you have arrived at ${toLabel(trip)}.`, [
    { id: 'guest:at_drop:yes', title: GUEST_BTN.weAreHere },
    { id: 'guest:at_drop:no', title: GUEST_BTN.notYet },
  ])
}

/** Guest tapped "Yes, we are here" — the trip closes and the fare is captured. */
export async function guestConfirmedDrop(tripId: number) {
  const trip = await getTrip(tripId)
  if (!trip) return
  const driver = await driverFor(trip)
  const charged = paymentsConfigured() && heldNotCaptured(trip)
  await setStatus(tripId, 'completed', { completedAt: new Date(), ...(charged ? { capturedAt: new Date() } : {}) })
  await record(tripId, 'guest', 'guest_confirmed_drop')
  await record(tripId, 'system', charged ? 'fare_captured' : 'capture_skipped', charged ? undefined : 'no payment provider')

  await say('guest', trip.guestPhone, tripId,
    `Trip complete.\n${charged ? `R ${fare(trip)} charged to your card. ` : ''}Thank you.\nHow was it?`,
    [
      { id: 'guest:feedback:good', title: GUEST_BTN.good },
      { id: 'guest:feedback:bad', title: GUEST_BTN.notGood },
    ])
  if (driver) await say('driver', driver.phone, tripId, `Confirmed by the guest.\nTrip ${trip.ref} is closed. Thank you.`)
  const ops = await opsNumber()
  if (ops) await notify('ops', ops, tripId, 'kn_ops_trip_closed', [trip.ref, toLabel(trip), charged ? fare(trip) : `${fare(trip)} NOT (no card on file)`])
}

export async function guestNotAtDropYet(tripId: number) {
  const trip = await getTrip(tripId)
  if (!trip) return
  const driver = await driverFor(trip)
  await record(tripId, 'guest', 'guest_not_at_drop')
  await say('guest', trip.guestPhone, tripId, `OK. Tap "${GUEST_BTN.weAreHere}" once you are.`)
  if (driver) {
    await say('driver', driver.phone, tripId, 'The guest says you are not there yet. Tap again when you are.', [
      { id: 'driver:at_drop', title: DRIVER_BTN.atDrop },
    ])
  }
}

export async function guestFeedback(tripId: number, good: boolean) {
  const trip = await getTrip(tripId)
  if (!trip) return
  await record(tripId, 'guest', good ? 'feedback_good' : 'feedback_bad')
  await say('guest', trip.guestPhone, tripId, good ? 'Thank you. Safe onward travels.' : `Sorry to hear that. Anneli will be in touch - or call her on ${(await loadSettings()).opsPhone}.`)
  if (!good) {
    const ops = await opsNumber()
    if (ops) await say('ops', ops, tripId, `Trip ${trip.ref} - the guest rated it "Not good". Worth a call.`)
  }
}

// ── 3. the guest does not appear ─────────────────────────────────────────────

/** The waiting driver has been at the gate too long: ask the guest, then Anneli. */
export async function askAboutNoShow(trip: Trip, driver: Driver, waitedMin: number) {
  await record(trip.id, 'system', 'no_show_asked', `${waitedMin} min`)
  await notify('guest', trip.guestPhone, trip.id, 'kn_guest_driver_waiting', [
    driver.name, fromLabel(trip), trip.ref, formatTime(trip.scheduledAt!),
  ])
  const ops = await opsNumber()
  if (ops) {
    await notify('ops', ops, trip.id, 'kn_ops_guest_no_show', [
      trip.ref, driver.name, String(waitedMin), fromLabel(trip), heldNotCaptured(trip) ? fare(trip) : '0 (nothing)',
    ])
  }
}

export async function guestComingNow(tripId: number) {
  const trip = await getTrip(tripId)
  if (!trip) return
  const driver = await driverFor(trip)
  await record(tripId, 'guest', 'guest_coming')
  await say('guest', trip.guestPhone, tripId, `Thanks - ${driver?.name ?? 'the driver'} will wait. Tap "${GUEST_BTN.canSee}" when you reach the car.`)
  if (driver) await say('driver', driver.phone, tripId, 'The guest says they are coming now. Please wait a little longer.')
  const ops = await opsNumber()
  if (ops) await say('ops', ops, tripId, `Trip ${trip.ref} - the guest says they are coming now.`)
}

export async function keepWaiting(tripId: number) {
  const trip = await getTrip(tripId)
  if (!trip) return
  const driver = await driverFor(trip)
  await record(tripId, 'ops', 'keep_waiting')
  if (driver) await say('driver', driver.phone, tripId, 'Anneli says please keep waiting a little longer.')
  const ops = await opsNumber()
  if (ops) await say('ops', ops, tripId, `OK - ${driver?.name ?? 'the driver'} keeps waiting. I will ask again if the guest still does not appear.`)
}

/** Anneli releases the hold or charges a no-show. Either way the trip ends. */
export async function resolveNoShow(tripId: number, charge: boolean) {
  const trip = await getTrip(tripId)
  if (!trip) return
  const driver = await driverFor(trip)
  const held = heldNotCaptured(trip)
  const willCharge = charge && held && paymentsConfigured()

  await setStatus(tripId, 'no_show', willCharge ? { capturedAt: new Date() } : held ? { releasedAt: new Date() } : {})
  await record(tripId, 'ops', charge ? 'no_show_charged' : 'no_show_released', paymentsConfigured() ? undefined : 'no payment provider - recorded only')

  const settings = await loadSettings()
  const money = willCharge
    ? `A no-show fee of R ${settings.noShowFee ?? fare(trip)} has been charged.`
    : held ? 'The hold is being released and nothing is charged.' : 'Nothing has been charged.'
  await say('guest', trip.guestPhone, tripId, `${driver?.name ?? 'The driver'} has left ${fromLabel(trip)}. Trip ${trip.ref} is closed.\n${money}`)
  if (driver) await say('driver', driver.phone, tripId, `Trip ${trip.ref} is closed as a no-show. You can leave. Thank you for waiting.`)
  const ops = await opsNumber()
  if (ops) await say('ops', ops, tripId, `Trip ${trip.ref} closed as a no-show. ${money}`)
}

/** 4 — card declined and never fixed: Anneli sends the car anyway or cancels. */
export async function sendCarAnyway(tripId: number) {
  const trip = await getTrip(tripId)
  if (!trip) return
  const driver = await driverFor(trip)
  await record(tripId, 'ops', 'send_anyway', 'card unresolved')
  if (driver) await say('driver', driver.phone, tripId, `Trip ${trip.ref} goes ahead. Anneli will sort payment with the guest.`)
  await say('guest', trip.guestPhone, tripId, `Your car for ${formatTime(trip.scheduledAt!)} is still coming. Anneli will sort the payment with you directly.`)
  const ops = await opsNumber()
  if (ops) await say('ops', ops, tripId, `OK - ${trip.ref} goes ahead without a card. The guest and driver have been told.`)
}
