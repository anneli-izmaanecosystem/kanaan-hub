"""The trip lifecycle — every status change a trip can go through, and who is told.

The guest, ops and driver conversations all end up here: they read a reply, decide which
transition it means, and call one function. Each function writes the status and the
audit event first, then sends the messages, each one guarded — a template that fails to
land must never leave the trip half-moved, and one failed send must not stop the next
party being told.

Out-of-band messages go as templates: the driver and Anneli may not have written to the
number for days, and a guest's 24-hour window is usually shut by the morning of the trip.
"""

import logging
from typing import Any, Callable, Optional

from sqlalchemy import and_, select

from app import paystack
from app.bot import hub_db, wa
from app.bot.hub_db import Row, db_time, now
from app.bot.settings_store import js_round, load_settings
from app.bot.when import format_day_name, format_time, format_when_long, format_when_short, iso_z
from app.config import get_settings

log = logging.getLogger("kanaan.bot.trip")

T = hub_db.trips

# Statuses a trip can be acted on from — anything else is finished.
ACTIVE_STATUSES = ("requested", "allocated", "driver_en_route", "driver_waiting", "in_progress")

FARM = "the farm gate"

# Template quick-reply buttons come back as their visible text, so these strings are the
# contract with Meta's approved templates. Change them there first.
OPS_BTN = {
    "accept": "Accept",
    "no_car": "No car available",
    "offer_time": "Offer another time",
    "pick_another": "Pick another driver",
    "cancel_trip": "Cancel the trip",
    "release_hold": "Release the hold",
    "no_charge": "No charge",
    "charge_no_show": "Charge a no-show",
    "keep_waiting": "Keep waiting",
    "send_anyway": "Send the car anyway",
}

DRIVER_BTN = {
    "noted": "Noted",
    "cannot_take": "I cannot take it",
    "left": "I have left",
    "cannot_make": "I cannot make it",
    "arrived": "I have arrived",
    "at_drop": "Arrived at drop",  # on cards sent before the driver closed the ride
    "ride_started": "Ride started",
    "ride_complete": "Ride complete",
}

GUEST_BTN = {
    "cancel_trip": "Cancel this trip",
    "cancel_request": "Cancel the request",
    "cancel_the_trip": "Cancel the trip",
    "try_another_time": "Try another time",
    "end": "End",
    "can_see": "Yes, I can see him",
    "not_yet": "Not yet",
    "we_are_here": "Yes, we are here",
    "coming_now": "Coming now",
    "good": "Good",
    "not_good": "Not good",
    "pay_now": "Pay now",
    "pay_after": "Pay after ride",
}


# In-session buttons that keep the guest one tap from the next step, so no message leaves
# them at a dead end. Handled in conversation.py.
BOOK_AGAIN: tuple[str, str] = ("book", "Book a car")
CANCEL_REQUEST: tuple[str, str] = ("guest:cancel", GUEST_BTN["cancel_request"])
CANCEL_TRIP: tuple[str, str] = ("guest:cancel", GUEST_BTN["cancel_trip"])
CAN_SEE: tuple[str, str] = ("guest:can_see", GUEST_BTN["can_see"])


def cancel_button(trip: Row) -> Optional[tuple[str, str]]:
    """The right cancel button for where a trip stands, or None once the ride is under way."""
    if trip.status == "requested":
        return CANCEL_REQUEST
    if trip.status in ("allocated", "driver_en_route"):
        return CANCEL_TRIP
    return None


# ── lookups ──────────────────────────────────────────────────────────────────


def get_trip(trip_id: int) -> Optional[Row]:
    with hub_db.begin() as c:
        return hub_db.one(c, select(T).where(T.c.id == trip_id))


def get_driver(driver_id: int) -> Optional[Row]:
    with hub_db.begin() as c:
        return hub_db.one(c, select(hub_db.drivers).where(hub_db.drivers.c.id == driver_id))


def driver_for(trip: Row) -> Optional[Row]:
    return get_driver(trip.driver_id) if trip.driver_id else None


def trip_for_reply(phone: str, role: str, context_wamid: Optional[str] = None) -> Optional[Row]:
    """The trip a reply is about: the card it was tapped on, else the sender's earliest
    live trip."""
    linked = wa.wamid_trip(context_wamid)
    if linked:
        return get_trip(linked)
    with hub_db.begin() as c:
        if role == "guest":
            who = T.c.guest_phone == phone
        else:
            who = T.c.driver_id.in_(select(hub_db.drivers.c.id).where(hub_db.drivers.c.phone == phone))
        return hub_db.one(c, select(T).where(and_(T.c.status.in_(ACTIVE_STATUSES), who)).order_by(T.c.scheduled_at).limit(1))


def trip_for_ops_reply(context_wamid: Optional[str]) -> Optional[Row]:
    linked = wa.wamid_trip(context_wamid)
    return get_trip(linked) if linked else None


def last_trip(phone: str) -> Optional[Row]:
    with hub_db.begin() as c:
        return hub_db.one(c, select(T).where(T.c.guest_phone == phone).order_by(T.c.created_at.desc()).limit(1))


# ── audit + sending ──────────────────────────────────────────────────────────


def record(trip_id: int, actor: str, event: str, detail: Optional[str] = None) -> None:
    with hub_db.begin() as c:
        c.execute(hub_db.trip_events.insert().values(
            trip_id=trip_id, actor=actor, event=event, detail=detail, at=db_time(now())))


def events_for(trip_id: int) -> list[Row]:
    with hub_db.begin() as c:
        return hub_db.rows(c.execute(
            select(hub_db.trip_events).where(hub_db.trip_events.c.trip_id == trip_id).order_by(hub_db.trip_events.c.at)))


def _guarded(trip_id: Optional[int], what: str, fn: Callable[[], Any]) -> None:
    """One party's send, isolated: a failure is logged against the trip and swallowed."""
    try:
        fn()
    except Exception as err:
        log.exception("%s failed", what)
        if trip_id:
            try:
                record(trip_id, "system", "send_failed", f"{what}: {err}")
            except Exception:
                pass


def notify(role: str, to: str, trip_id: Optional[int], template: str, params: list[str]) -> None:
    # Template parameters may not contain newlines or tabs.
    body = [" ".join(str(p).split()) for p in params]
    _guarded(trip_id, f"{template} to {role}", lambda: wa.send_template(wa.to_wa_id(to), template, body, trip_id))


def notify_first(role: str, to: str, trip_id: Optional[int], templates: list[str], params: list[str]) -> None:
    """Like notify, trying each template in turn — a new version still in Meta's review
    (or rejected) falls back to the approved one before it, so nobody goes untold."""
    body = [" ".join(str(p).split()) for p in params]

    def send():
        for i, name in enumerate(templates):
            try:
                wa.send_template(wa.to_wa_id(to), name, body, trip_id)
                return
            except wa.WhatsAppError as err:
                if i == len(templates) - 1:
                    raise
                log.warning("%s not usable (%s) - falling back to %s", name, err, templates[i + 1])

    _guarded(trip_id, f"{templates[0]} to {role}", send)


def notify_or_say(role: str, to: str, trip_id: Optional[int], template: str, params: list[str], fallback: str) -> None:
    """A template when it is approved (it reaches people whose 24-hour window has closed);
    until then — in Meta's review, or rejected — the same news as a plain message."""
    body = [" ".join(str(p).split()) for p in params]

    def send():
        try:
            wa.send_template(wa.to_wa_id(to), template, body, trip_id)
        except wa.WhatsAppError as err:
            log.warning("%s not usable (%s) - sending it as a plain message", template, err)
            wa.send_text(wa.to_wa_id(to), fallback, trip_id)

    _guarded(trip_id, f"{template} to {role}", send)


def say(role: str, to: str, trip_id: Optional[int], body: str, buttons: Optional[list[wa.Button]] = None) -> None:
    def send():
        if buttons:
            wa.send_buttons(wa.to_wa_id(to), body, buttons, trip_id)
        else:
            wa.send_text(wa.to_wa_id(to), body, trip_id)
    _guarded(trip_id, f"message to {role}", send)


def ops_number() -> Optional[str]:
    ops = load_settings().ops_whatsapp
    if not ops:
        log.error("KANAAN_OPS_WHATSAPP is not set - Anneli cannot be told")
    return ops or None


def set_status(trip_id: int, status: str, **extra: Any) -> None:
    values = {k: db_time(v) if hasattr(v, "tzinfo") else v for k, v in extra.items()}
    with hub_db.begin() as c:
        c.execute(T.update().where(T.c.id == trip_id).values(status=status, updated_at=db_time(now()), **values))


# ── wording helpers ──────────────────────────────────────────────────────────


def from_label(trip: Row) -> str:
    return FARM if trip.direction == "drop" else (trip.place_name or "your location")


def to_label(trip: Row) -> str:
    return (trip.place_name or "your destination") if trip.direction == "drop" else FARM


def pickup_address(trip: Row) -> str:
    return get_settings().kanaan_pickup_address if trip.direction == "drop" else (trip.place_name or "guest location")


def guest_label(trip: Row) -> str:
    return trip.guest_name or trip.room_label or "the guest"


def fare(trip: Row) -> str:
    return str(js_round(float(trip.fare or 0)))


def held_not_captured(trip: Row) -> bool:
    return bool(trip.held_at and not trip.released_at and not trip.captured_at)


def payments_configured() -> bool:
    return bool(get_settings().paystack_secret_key)


def request_payment(trip: Row, amount_rand: float, purpose: str, intro: str) -> tuple[bool, str]:
    """Sends the guest a Paystack link for `amount_rand` — the fare, or a no-show fee.
    Returns (ok, reason) instead of raising, so the trip still closes and Anneli can
    collect the money another way."""
    settings = get_settings()
    if not payments_configured():
        return False, "no payment provider"
    try:
        email = paystack.guest_email(settings, trip.guest_phone)
        data = paystack.start_payment(settings, trip.id, trip.ref, email, amount_rand, purpose)
        reference = data["reference"]
        with hub_db.begin() as c:
            c.execute(T.update().where(T.c.id == trip.id).values(payment_ref=reference))
        _record_payment_row(trip, data, amount_rand, purpose, email)
        wa.send_cta_url(wa.to_wa_id(trip.guest_phone),
                        f"{intro}\nPlease pay R {js_round(amount_rand)} by card using the button below.",
                        "Pay now", data["authorization_url"], trip.id)
        record(trip.id, "system", f"{purpose}_payment_requested", reference)
        return True, ""
    except Exception as err:
        record(trip.id, "system", f"{purpose}_payment_request_failed", str(err))
        return False, str(err)


def _record_payment_row(trip: Row, data: dict[str, Any], amount_rand: float, purpose: str, email: str) -> None:
    """The pending kanaan_payments row, so the admin payments page shows the link."""
    from app.db import SessionLocal
    from app.routers.payments import record as record_payment
    try:
        with SessionLocal() as db:
            record_payment(db, {
                "reference": data["reference"], "status": "pending", "amount": round(amount_rand * 100),
                "currency": paystack.CURRENCY, "customer": {"email": email},
                "metadata": {"tripId": trip.id, "purpose": purpose},
            }, phone=trip.guest_phone, trip_ref=trip.ref)
    except Exception:
        log.exception("could not record the payment link for %s", trip.ref)


def offer_payment(trip: Row) -> None:
    """Straight after the confirmation template, once Anneli has accepted: the first time
    the guest sees a payment option. A session message, so it only lands inside the
    24-hour window; if it does not, the link still goes out when the driver closes the ride."""
    if not payments_configured() or trip.captured_at:
        return
    say("guest", trip.guest_phone, trip.id,
        f"Your fare is R {fare(trip)}, paid by card - no cash needed on the trip.\n"
        "Would you like to pay now, or after the ride?",
        [("guest:pay:now", GUEST_BTN["pay_now"]), ("guest:pay:after", GUEST_BTN["pay_after"])])


def payment_received(tx: dict[str, Any]) -> None:
    """Paystack confirmed a payment — from its webhook or the guest's browser, whichever
    lands first, so this must be safe to run twice."""
    meta = paystack.metadata_of(tx)
    trip_id = meta.get("tripId")
    purpose = meta.get("purpose")
    if not trip_id or purpose not in ("fare", "noshow") or tx.get("status") != "success":
        return
    with hub_db.begin() as c:
        trip = hub_db.one(c, T.update()
                          .where(and_(T.c.id == int(trip_id), T.c.captured_at.is_(None)))
                          .values(captured_at=db_time(now()), payment_ref=tx["reference"])
                          .returning(*T.c))
    if not trip:
        return
    amount = js_round(tx.get("amount", 0) / 100)
    record(trip.id, "guest", f"{purpose}_paid", f"R {amount} {tx['reference']}")
    say("guest", trip.guest_phone, trip.id, f"Payment of R {amount} received for trip {trip.ref}. Thank you!")
    driver = driver_for(trip)
    if driver and purpose == "fare":
        say("driver", driver.phone, trip.id,
            f"Trip {trip.ref} - the guest has paid the R {amount} fare by card. No cash to collect.")
    ops = ops_number()
    if ops:
        say("ops", ops, trip.id,
            f"Trip {trip.ref} - R {amount} {'no-show fee ' if purpose == 'noshow' else ''}paid by card. Nothing needed from you.")
    # Paid after the ride closed: now is the moment to ask for a review. (Paid before it
    # closed, the review goes out when the driver taps Ride complete.)
    if purpose == "fare" and trip.status == "completed":
        request_review(trip)


def _unpaid_attempt(tx: dict[str, Any]) -> Optional[tuple[Row, str, int]]:
    """(trip, purpose, amount) for a payment attempt that did not go through, or None if
    the trip is already paid or this attempt was already reported (the callback and the
    scheduler's check can both see the same one)."""
    meta = paystack.metadata_of(tx)
    trip_id, purpose, reference = meta.get("tripId"), meta.get("purpose"), tx.get("reference")
    if not trip_id or purpose not in ("fare", "noshow") or not reference:
        return None
    trip = get_trip(int(trip_id))
    if not trip or trip.captured_at:
        return None
    if any(e.event in ("payment_failed", "payment_cancelled") and e.detail and e.detail.startswith(reference)
           for e in events_for(trip.id)):
        return None
    amount = js_round((tx.get("amount") or round(float(trip.fare or 0) * 100)) / 100)
    return trip, purpose, amount


def _retry_buttons(trip: Row, purpose: str, first: str) -> list[wa.Button]:
    if purpose == "noshow":
        return [("guest:pay:noshow", first)]
    buttons: list[wa.Button] = [("guest:pay:now", first)]
    if trip.status in ("allocated", "driver_en_route", "driver_waiting", "in_progress"):
        buttons.append(("guest:pay:after", GUEST_BTN["pay_after"]))
    return buttons


def payment_failed(tx: dict[str, Any]) -> None:
    """The card was declined or the charge otherwise failed. The guest can try again;
    the driver and Anneli are told where things stand."""
    found = _unpaid_attempt(tx)
    if not found:
        return
    trip, purpose, amount = found
    reason = (tx.get("gateway_response") or "").strip() or "the bank declined it"
    what = "no-show fee" if purpose == "noshow" else "fare"
    record(trip.id, "guest", "payment_failed", f"{tx['reference']} R {amount} {reason}")

    say("guest", trip.guest_phone, trip.id,
        f"Your card payment of R {amount} for trip {trip.ref} did not go through ({reason}). No money was taken.\n"
        "You can try again with the same or another card.",
        _retry_buttons(trip, purpose, "Try again"))
    driver = driver_for(trip)
    if driver and purpose == "fare":
        say("driver", driver.phone, trip.id,
            f"Trip {trip.ref} - the guest's card payment did not go through. They have been asked to try again. "
            "Nothing needed from you.")
    ops = ops_number()
    if ops:
        say("ops", ops, trip.id,
            f"Trip {trip.ref} - card payment of R {amount} ({what}) failed: {reason}. The guest has been asked to try again.")


def payment_cancelled(tx: dict[str, Any]) -> None:
    """The guest tapped Cancel on Paystack's page. Nothing was taken; they can pay later."""
    if tx.get("status") == "success":
        return
    found = _unpaid_attempt(tx)
    if not found:
        return
    trip, purpose, amount = found
    what = "no-show fee" if purpose == "noshow" else "fare"
    record(trip.id, "guest", "payment_cancelled", f"{tx['reference']} R {amount}")

    later = purpose == "fare" and trip.status not in ("completed", "no_show")
    say("guest", trip.guest_phone, trip.id,
        f"Payment cancelled - nothing was taken for trip {trip.ref}.\n"
        + ("You can pay now, or after the ride." if later else f"The R {amount} {what} is still due - tap below when you are ready."),
        _retry_buttons(trip, purpose, "Pay now"))
    driver = driver_for(trip)
    if driver and purpose == "fare":
        say("driver", driver.phone, trip.id,
            f"Trip {trip.ref} - the guest cancelled the card payment and will pay later. Nothing needed from you.")
    ops = ops_number()
    if ops:
        say("ops", ops, trip.id,
            f"Trip {trip.ref} - the guest cancelled the R {amount} {what} payment. They can pay later from the chat.")


def guest_pay_noshow(trip_id: int) -> None:
    """"Try again" on a no-show fee that did not go through."""
    trip = get_trip(trip_id)
    if not trip or trip.captured_at:
        return
    fee = load_settings().no_show_fee
    ok, _ = request_payment(trip, float(fee if fee is not None else (trip.fare or 0)), "noshow", "Thank you.")
    if not ok:
        say("guest", trip.guest_phone, trip_id, "Sorry - card payment is not available right now. Anneli will be in touch.")


# ── 1. making the booking ────────────────────────────────────────────────────


def submit_to_ops(trip_id: int) -> None:
    """The guest is told, then the request is put in front of Anneli."""
    trip = get_trip(trip_id)
    if not trip:
        return
    set_status(trip_id, "requested")
    record(trip_id, "system", "sent_to_ops")
    # Nothing about payment yet: that is only offered once Anneli accepts.
    say("guest", trip.guest_phone, trip_id,
        f"Request sent to Anneli. Your reference is {trip.ref}.\n"
        "She will check which driver is free and confirm shortly - I will message you here as soon as she does.",
        [CANCEL_REQUEST])
    send_new_request_card(trip)


def send_new_request_card(trip: Row) -> None:
    """Anneli's card, with Accept / No car available / Offer another time."""
    ops = ops_number()
    if not ops:
        return
    notify("ops", ops, trip.id, "kn_ops_new_request_v2", [
        format_when_short(trip.scheduled_at),
        guest_label(trip),
        (trip.place_name or "") if trip.direction == "drop" else f"{FARM} (collect from {trip.place_name})",
        "" if trip.distance_km is None else str(trip.distance_km),
        fare(trip),
        trip.ref,
    ])


def send_driver_picker(trip_id: int, body: str = "Which driver is going?") -> bool:
    """The on-duty drivers Anneli can pick from; False when there are none."""
    ops = ops_number()
    if not ops:
        return False
    d = hub_db.drivers
    with hub_db.begin() as c:
        rows = hub_db.rows(c.execute(select(d).where(and_(d.c.active.is_(True), d.c.on_duty.is_(True))).limit(10)))
    if not rows:
        say("ops", ops, trip_id, "No drivers are on duty. Add or switch one on in the dashboard, then tap Accept again.")
        return False
    _guarded(trip_id, "driver picker", lambda: wa.send_list(
        wa.to_wa_id(ops), body, "Choose a driver",
        [{"id": f"driver:{r.id}", "title": f"{r.name} - {r.plate}"[:24], **({"description": r.vehicle[:72]} if r.vehicle else {})}
         for r in rows],
        trip_id))
    return True


def allocate_driver(trip_id: int, driver_id: int, by: str, reassign: bool = False) -> None:
    """Anneli (or the board) picked a driver. Confirms to the guest, briefs the driver with
    a map pin for the far end, and closes the loop with Anneli."""
    trip = get_trip(trip_id)
    driver = get_driver(driver_id)
    if not trip or not driver:
        return

    set_status(trip_id, "allocated", driver_id=driver.id)
    record(trip_id, "ops", "driver_reassigned" if reassign else "driver_allocated",
           f"{driver.name} ({driver.plate}){' - from the board' if by == 'board' else ''}")

    if reassign:
        notify("guest", trip.guest_phone, trip_id, "kn_guest_driver_changed",
               [trip.ref, driver.name, driver.plate, format_time(trip.scheduled_at)])
    else:
        notify("guest", trip.guest_phone, trip_id, "kn_guest_trip_confirmed_v2", [
            driver.name, driver.plate, driver.vehicle or "vehicle",
            format_day_name(trip.scheduled_at), format_time(trip.scheduled_at), fare(trip),
        ])
        offer_payment(trip)

    # _v2 has only "Noted": a driver no longer hands a new trip back from the card. The
    # original (with "I cannot take it") is the fallback while _v2 is in Meta's review.
    notify_first("driver", driver.phone, trip_id, ["kn_driver_new_trip_v2", "kn_driver_new_trip"], [
        format_when_short(trip.scheduled_at), pickup_address(trip), guest_label(trip), to_label(trip), trip.ref,
    ])
    if trip.place_lat is not None and trip.place_lng is not None:
        _guarded(trip_id, "driver map pin", lambda: wa.send_location(
            wa.to_wa_id(driver.phone), float(trip.place_lat), float(trip.place_lng),
            f"{trip.place_name} - tap for directions", trip.place_name, trip_id))

    ops = ops_number()
    if ops and by == "ops":
        say("ops", ops, trip_id, f"Done. The guest and {driver.name} have both been told.\nRef {trip.ref} is confirmed.")

    # A trip leaving within the nudge window gets its "I have left" card now.
    if (trip.scheduled_at - now()).total_seconds() <= load_settings().driver_nudge_min * 60:
        trip.driver_id, trip.status = driver.id, "allocated"
        send_driver_reminder(trip, driver)


def decline_trip(trip_id: int) -> None:
    """Anneli has no car. Nothing was ever taken."""
    trip = get_trip(trip_id)
    if not trip:
        return
    set_status(trip_id, "declined")
    record(trip_id, "ops", "declined", "no car available")
    notify("guest", trip.guest_phone, trip_id, "kn_guest_no_car_available",
           [format_time(trip.scheduled_at), format_day_name(trip.scheduled_at)])
    ops = ops_number()
    if ops:
        say("ops", ops, trip_id, f"Told the guest. Ref {trip.ref} is closed and nothing was held.")


def offer_new_time(trip_id: int, at) -> None:
    """Anneli proposes a different departure; the guest takes it or drops the request."""
    trip = get_trip(trip_id)
    if not trip:
        return
    record(trip_id, "ops", "time_offered", iso_z(at))
    say("guest", trip.guest_phone, trip_id,
        f"Sorry - no car is free at {format_time(trip.scheduled_at)} on {format_day_name(trip.scheduled_at)}.\n"
        f"Anneli can do {format_when_long(at)} instead. The fare stays R {fare(trip)}.",
        [(f"offer:accept:{iso_z(at)}", "Take that time"), ("offer:decline", "Cancel the request")])
    ops = ops_number()
    if ops:
        say("ops", ops, trip_id,
            f"Offered {format_when_short(at)} to the guest for {trip.ref}. You will get the request card back if they take it.")


def accept_new_time(trip_id: int, at) -> None:
    """The guest took the offered time: the request goes back to Anneli to allocate."""
    trip = get_trip(trip_id)
    if not trip:
        return
    with hub_db.begin() as c:
        c.execute(T.update().where(T.c.id == trip_id).values(scheduled_at=db_time(at), updated_at=db_time(now())))
    record(trip_id, "guest", "time_accepted", iso_z(at))
    say("guest", trip.guest_phone, trip_id,
        f"Thanks - your car is now down for {format_when_long(at)}. Anneli will confirm the driver shortly.")
    trip.scheduled_at = at
    send_new_request_card(trip)


# ── cancellations ────────────────────────────────────────────────────────────


def cancel_trip(trip_id: int, by: str, reason: Optional[str] = None) -> None:
    """Cancel from any side. Wording turns on whether money was taken."""
    trip = get_trip(trip_id)
    if not trip:
        return
    driver = driver_for(trip)
    held = held_not_captured(trip)
    extra: dict[str, Any] = {"cancelled_at": now()}
    if held:
        extra["released_at"] = now()
    set_status(trip_id, "cancelled", **extra)
    record(trip_id, by, "cancelled", reason)
    if held:
        record(trip_id, "system", "hold_released" if payments_configured() else "hold_release_skipped", "no payment provider")

    # Paying is offered from the moment Anneli accepts, so a cancelled trip may already be
    # paid for. Refunds are made by Anneli in Paystack, not automatically.
    paid = bool(trip.captured_at)
    if paid:
        record(trip_id, "system", "refund_needed", f"R {fare(trip)} {trip.payment_ref or ''}".strip())

    if paid:
        money = f"You have already paid R {fare(trip)} - Anneli will refund it to your card. Refunds can take a few working days to show."
    elif held:
        money = f"The hold of R {fare(trip)} is being released. It can take a few working days to clear from your statement."
    else:
        money = "Nothing has been charged."

    if by == "guest":
        say("guest", trip.guest_phone, trip_id, f"Cancelled.{f' {driver.name} has been told.' if driver else ''}\n{money}", [BOOK_AGAIN])
    else:
        say("guest", trip.guest_phone, trip_id, f"Trip {trip.ref} has been cancelled{' by Anneli' if by == 'ops' else ''}.\n{money}", [BOOK_AGAIN])

    if driver and by != "driver":
        notify("driver", driver.phone, trip_id, "kn_driver_trip_cancelled",
               [trip.ref, format_day_name(trip.scheduled_at), format_time(trip.scheduled_at)])

    ops = ops_number()
    if ops and by != "ops":
        notify("ops", ops, trip_id, "kn_ops_trip_cancelled",
               [trip.ref, driver.name if driver else "No driver was allocated yet, so nobody"])
    if ops and paid:
        paystack_ref = f", Paystack {trip.payment_ref}" if trip.payment_ref else ""
        say("ops", ops, trip_id,
            f"Trip {trip.ref} was already paid (R {fare(trip)}{paystack_ref}). Please refund it in Paystack - the guest has been told to expect it.")


def driver_declined(trip_id: int, driver: Row) -> None:
    """The driver hands the trip back and Anneli is asked to reallocate."""
    trip = get_trip(trip_id)
    if not trip:
        return
    record(trip_id, "driver", "driver_declined", f"{driver.name} ({driver.plate})")
    say("driver", driver.phone, trip_id, f"Thanks for letting us know. Anneli will find another driver for {trip.ref}.")
    ops = ops_number()
    if ops:
        notify("ops", ops, trip_id, "kn_ops_driver_unavailable", [trip.ref, driver.name, format_time(trip.scheduled_at)])


# ── 2. on the day ────────────────────────────────────────────────────────────


def send_evening_reminder(trip: Row, driver: Row) -> None:
    record(trip.id, "system", "guest_reminder_sent")
    notify("guest", trip.guest_phone, trip.id, "kn_guest_trip_reminder_evening_v2",
           [to_label(trip), format_time(trip.scheduled_at), driver.name, driver.plate, fare(trip)])


def send_driver_reminder(trip: Row, driver: Row) -> None:
    record(trip.id, "system", "driver_reminder_sent")
    notify("driver", driver.phone, trip.id, "kn_driver_trip_reminder",
           [trip.ref, format_time(trip.scheduled_at), pickup_address(trip), to_label(trip)])


def place_hold(trip: Row) -> None:
    """Paystack has no general pre-authorisation, so nothing is held — recorded and
    skipped, and nothing tells the guest money was held when it was not."""
    record(trip.id, "system", "hold_skipped",
           "Paystack has no pre-authorisation - fare is charged by link" if payments_configured() else "no payment provider")


def driver_left(trip_id: int, driver: Row) -> None:
    trip = get_trip(trip_id)
    if not trip:
        return
    set_status(trip_id, "driver_en_route")
    record(trip_id, "driver", "driver_left")
    say("driver", driver.phone, trip_id,
        "Thanks. The guest has been told you are on your way.\n"
        f"Guest: {guest_label(trip)} - +{wa.to_wa_id(trip.guest_phone)}\nPickup: {pickup_address(trip)}\nDrop: {to_label(trip)}",
        [("driver:arrived", DRIVER_BTN["arrived"])])
    notify("guest", trip.guest_phone, trip_id, "kn_guest_driver_on_way",
           [driver.name, driver.plate, driver.vehicle or "the car", driver.phone])
    ops = ops_number()
    if ops:
        notify("ops", ops, trip_id, "kn_ops_trip_left", [trip.ref, driver.name, guest_label(trip)])


def driver_arrived(trip_id: int, driver: Row) -> None:
    """Nothing moves past "arrived" until the guest confirms."""
    trip = get_trip(trip_id)
    if not trip:
        return
    set_status(trip_id, "driver_waiting")
    record(trip_id, "driver", "driver_arrived")
    say("driver", driver.phone, trip_id, "The guest has been told you are here.\nTap Ride started once they are in the car.",
        [("driver:started", DRIVER_BTN["ride_started"])])
    notify("guest", trip.guest_phone, trip_id, "kn_guest_driver_arrived", [driver.name, from_label(trip)])
    ops = ops_number()
    if ops:
        notify("ops", ops, trip_id, "kn_ops_trip_at_pickup", [trip.ref, driver.name, from_label(trip)])


def guest_confirmed_pickup(trip_id: int) -> None:
    """"Yes, I can see him": the ride starts, and the driver closes it."""
    trip = get_trip(trip_id)
    if not trip:
        return
    driver = driver_for(trip)
    set_status(trip_id, "in_progress")
    record(trip_id, "guest", "guest_confirmed_pickup")
    say("guest", trip.guest_phone, trip_id,
        "Trip started. Safe travels." if trip.captured_at
        else f"Trip started. Safe travels.\nWe will send the R {fare(trip)} payment link as soon as the ride is complete.")
    if driver:
        say("driver", driver.phone, trip_id, "Guest confirmed. Trip started.\nTap below once you have dropped the guest off.",
            [("driver:complete", DRIVER_BTN["ride_complete"])])
    ops = ops_number()
    if ops:
        notify("ops", ops, trip_id, "kn_ops_trip_started", [trip.ref])


def driver_started_ride(trip_id: int, driver: Row) -> None:
    """Driver tapped "Ride started": the guest is in the car. The guest is told, Anneli gets
    her trip-started card, and the driver gets Ride complete — the same place the guest's
    "Yes, I can see him" leads to, whichever comes first."""
    trip = get_trip(trip_id)
    if not trip:
        return
    set_status(trip_id, "in_progress")
    record(trip_id, "driver", "driver_started_ride")

    vehicle = f"{driver.plate}, {driver.vehicle}" if driver.vehicle else driver.plate
    fallback = f"Your ride with {driver.name} has started. Safe travels." + (
        "" if trip.captured_at else f"\nWe will send the R {fare(trip)} payment link as soon as the ride is complete.")
    notify_or_say("guest", trip.guest_phone, trip_id, "kn_guest_ride_started", [driver.name, vehicle, trip.ref], fallback)
    say("driver", driver.phone, trip_id, "Ride started.\nTap below once you have dropped the guest off.",
        [("driver:complete", DRIVER_BTN["ride_complete"])])
    ops = ops_number()
    if ops:
        notify("ops", ops, trip_id, "kn_ops_trip_started", [trip.ref])


def guest_pay_now(trip_id: int) -> None:
    trip = get_trip(trip_id)
    if not trip:
        return
    record(trip_id, "guest", "chose_pay_now")
    if trip.status in ("requested", "draft"):
        return
    if trip.captured_at:
        say("guest", trip.guest_phone, trip_id, f"Trip {trip.ref} is already paid. Thank you!")
        return
    ok, _ = request_payment(trip, float(trip.fare or 0), "fare", "Thank you.")
    if not ok:
        say("guest", trip.guest_phone, trip_id,
            "Sorry - card payment is not available right now. We will send the link after the ride, or Anneli will sort it with you.")


def guest_pay_after(trip_id: int) -> None:
    trip = get_trip(trip_id)
    if not trip:
        return
    record(trip_id, "guest", "chose_pay_after")
    say("guest", trip.guest_phone, trip_id, "No problem. We will send you the payment link as soon as the ride is complete.")


def guest_cannot_see_driver(trip_id: int) -> None:
    trip = get_trip(trip_id)
    if not trip:
        return
    driver = driver_for(trip)
    record(trip_id, "guest", "guest_not_yet")
    say("guest", trip.guest_phone, trip_id, "OK - the driver will wait for you. Tap below as soon as you see him.", [CAN_SEE])
    if driver:
        say("driver", driver.phone, trip_id, "The guest cannot see you yet. Please stay at the pickup point.")


def driver_completed_ride(trip_id: int, driver: Row) -> None:
    """Driver tapped "Ride complete". The trip closes, and the guest gets the payment link
    unless they already paid."""
    trip = get_trip(trip_id)
    if not trip:
        return
    record(trip_id, "driver", "ride_completed")
    set_status(trip_id, "completed", completed_at=now())

    intro = f"Your ride with {driver.name} to {to_label(trip)} is complete. Thank you for travelling with us."
    if trip.captured_at:
        ok, reason = True, ""
        say("guest", trip.guest_phone, trip_id, f"{intro}\nYour fare is already paid.")
    else:
        ok, reason = request_payment(trip, float(trip.fare or 0), "fare", intro)
        if not ok:
            say("guest", trip.guest_phone, trip_id, f"{intro}\nAnneli will be in touch about payment.")

    # The review comes once the fare is settled: now if it already is, else when Paystack
    # confirms the link was paid (payment_received). If no link could be sent, payment
    # happens outside the chat, so there is nothing to wait for.
    if trip.captured_at or not ok:
        request_review(trip)
    say("driver", driver.phone, trip_id, f"Trip {trip.ref} is closed. Thank you.")
    ops = ops_number()
    if ops:
        if trip.captured_at:
            money = f"R {fare(trip)} already paid by card during the ride"
        elif ok:
            money = f"R {fare(trip)} payment link sent to the guest - you will be told when it is paid"
        else:
            money = f"R {fare(trip)} NOT requested ({reason}) - please collect from the guest"
        notify("ops", ops, trip_id, "kn_ops_trip_closed_v2", [trip.ref, to_label(trip), money])


RATINGS = {
    5: "⭐⭐⭐⭐⭐ Excellent",
    4: "⭐⭐⭐⭐ Good",
    3: "⭐⭐⭐ Okay",
    2: "⭐⭐ Poor",
    1: "⭐ Very poor",
}


def request_review(trip: Row) -> None:
    """Asks the guest to rate the ride, 1-5 stars — once per trip, after it is paid."""
    if any(e.event == "review_requested" for e in events_for(trip.id)):
        return
    record(trip.id, "system", "review_requested")
    driver = driver_for(trip)
    _guarded(trip.id, "review request", lambda: wa.send_list(
        wa.to_wa_id(trip.guest_phone),
        f"How was your ride{f' with {driver.name}' if driver else ''} to {to_label(trip)}?\n"
        "Tap below to rate it - it helps us look after every guest.",
        "Rate your ride",
        [{"id": f"guest:rating:{stars}", "title": label} for stars, label in RATINGS.items()],
        trip.id))


def guest_rated(trip_id: int, stars: int) -> bool:
    """Records the rating. Returns True when the guest is asked what went wrong (3 or
    fewer stars), so the conversation waits for that note."""
    trip = get_trip(trip_id)
    if not trip or stars not in RATINGS:
        return False
    if any(e.event == "review_rating" for e in events_for(trip_id)):
        say("guest", trip.guest_phone, trip_id, "Thank you - we already have your rating for this ride.")
        return False
    record(trip_id, "guest", "review_rating", str(stars))
    if stars >= 4:
        say("guest", trip.guest_phone, trip_id, "Thank you for the rating! We hope to drive you again soon.", [BOOK_AGAIN])
        return False
    say("guest", trip.guest_phone, trip_id,
        "Sorry it was not better. What went wrong? Type a short note and Anneli will look into it.",
        [("review:skip", "Skip")])
    ops = ops_number()
    if ops:
        say("ops", ops, trip_id, f"Trip {trip.ref} - the guest rated it {stars}/5. Their note will follow if they leave one.")
    return True


def guest_review_note(trip_id: int, note: Optional[str]) -> None:
    """The note after a low rating, or None if the guest skipped it."""
    trip = get_trip(trip_id)
    if not trip:
        return
    if note:
        record(trip_id, "guest", "review_comment", note[:1000])
        say("guest", trip.guest_phone, trip_id,
            f"Thank you for telling us. Anneli will be in touch - or call her on {load_settings().ops_phone}.", [BOOK_AGAIN])
        ops = ops_number()
        if ops:
            say("ops", ops, trip_id, f'Trip {trip.ref} - guest review: "{note[:500]}". Worth a call.')
    else:
        say("guest", trip.guest_phone, trip_id, "No problem. Thank you for travelling with us.", [BOOK_AGAIN])


def guest_feedback(trip_id: int, good: bool) -> None:
    """The Good / Not good buttons on cards sent before the star rating."""
    trip = get_trip(trip_id)
    if not trip:
        return
    record(trip_id, "guest", "feedback_good" if good else "feedback_bad")
    say("guest", trip.guest_phone, trip_id, "Thank you. Safe onward travels." if good
        else f"Sorry to hear that. Anneli will be in touch - or call her on {load_settings().ops_phone}.", [BOOK_AGAIN])
    if not good:
        ops = ops_number()
        if ops:
            say("ops", ops, trip_id, f'Trip {trip.ref} - the guest rated it "Not good". Worth a call.')


# ── 3. the guest does not appear ─────────────────────────────────────────────


def ask_about_no_show(trip: Row, driver: Row, waited_min: int) -> None:
    record(trip.id, "system", "no_show_asked", f"{waited_min} min")
    notify("guest", trip.guest_phone, trip.id, "kn_guest_driver_waiting",
           [driver.name, from_label(trip), trip.ref, format_time(trip.scheduled_at)])
    ops = ops_number()
    if ops:
        fee = load_settings().no_show_fee
        notify("ops", ops, trip.id, "kn_ops_guest_no_show_v2", [
            trip.ref, driver.name, str(waited_min), from_label(trip),
            str(js_round(float(fee if fee is not None else (trip.fare or 0)))),
        ])


def guest_coming_now(trip_id: int) -> None:
    trip = get_trip(trip_id)
    if not trip:
        return
    driver = driver_for(trip)
    record(trip_id, "guest", "guest_coming")
    say("guest", trip.guest_phone, trip_id,
        f"Thanks - {driver.name if driver else 'the driver'} will wait. Tap below when you reach the car.", [CAN_SEE])
    if driver:
        say("driver", driver.phone, trip_id, "The guest says they are coming now. Please wait a little longer.")
    ops = ops_number()
    if ops:
        say("ops", ops, trip_id, f"Trip {trip.ref} - the guest says they are coming now.")


def keep_waiting(trip_id: int) -> None:
    trip = get_trip(trip_id)
    if not trip:
        return
    driver = driver_for(trip)
    record(trip_id, "ops", "keep_waiting")
    if driver:
        say("driver", driver.phone, trip_id, "Anneli says please keep waiting a little longer.")
    ops = ops_number()
    if ops:
        say("ops", ops, trip_id,
            f"OK - {driver.name if driver else 'the driver'} keeps waiting. I will ask again if the guest still does not appear.")


def resolve_no_show(trip_id: int, charge: bool) -> None:
    """Anneli releases or charges a no-show. Either way the trip ends."""
    trip = get_trip(trip_id)
    if not trip:
        return
    driver = driver_for(trip)
    settings = load_settings()
    fee = float(settings.no_show_fee if settings.no_show_fee is not None else (trip.fare or 0))

    set_status(trip_id, "no_show")
    record(trip_id, "ops", "no_show_charged" if charge else "no_show_released")
    closed = f"{driver.name if driver else 'The driver'} has left {from_label(trip)}. Trip {trip.ref} is closed."
    driver_msg = f"Trip {trip.ref} is closed as a no-show. You can leave. Thank you for waiting."
    ops = ops_number()

    # Already paid up front: charging keeps it as the fee; releasing means a refund.
    if trip.captured_at:
        record(trip_id, "system", "fare_kept_as_no_show" if charge else "refund_needed", f"R {fare(trip)}")
        say("guest", trip.guest_phone, trip_id,
            f"{closed}\nThe R {fare(trip)} you paid has been kept as the no-show fee." if charge
            else f"{closed}\nThe R {fare(trip)} you paid will be refunded to your card.")
        if driver:
            say("driver", driver.phone, trip_id, driver_msg)
        if ops:
            say("ops", ops, trip_id, f"Trip {trip.ref} closed as a no-show. The guest had already paid R {fare(trip)}. "
                + ("It has been kept as the no-show fee." if charge else "Please refund it in Paystack."))
        return

    ok, reason = request_payment(trip, fee, "noshow", f"{closed}\nA no-show fee applies.") if charge else (False, "")
    if not ok:
        say("guest", trip.guest_phone, trip_id, f"{closed}\nNothing has been charged.")
    if driver:
        say("driver", driver.phone, trip_id, driver_msg)
    if ops:
        if not charge:
            money = "Nothing has been charged."
        elif ok:
            money = f"A no-show fee link for R {js_round(fee)} was sent to the guest - you will be told when it is paid."
        else:
            money = f"The no-show fee link could not be sent ({reason}) - please collect from the guest."
        say("ops", ops, trip_id, f"Trip {trip.ref} closed as a no-show. {money}")


def send_car_anyway(trip_id: int) -> None:
    """Payment unresolved: Anneli sends the car anyway."""
    trip = get_trip(trip_id)
    if not trip:
        return
    driver = driver_for(trip)
    record(trip_id, "ops", "send_anyway", "card unresolved")
    if driver:
        say("driver", driver.phone, trip_id, f"Trip {trip.ref} goes ahead. Anneli will sort payment with the guest.")
    say("guest", trip.guest_phone, trip_id,
        f"Your car for {format_time(trip.scheduled_at)} is still coming. Anneli will sort the payment with you directly.")
    ops = ops_number()
    if ops:
        say("ops", ops, trip_id, f"OK - {trip.ref} goes ahead without a card. The guest and driver have been told.")
