"""Anneli's side. Everything she receives is a template card with buttons (she may not have
written to the number for days), so replies arrive as button text plus the wamid of the
card, which is how each tap finds its trip. The one typed answer is the alternative time
after "Offer another time"."""

from typing import Any, Optional

from sqlalchemy import select

from app.bot import hub_db, trip as T
from app.bot.conversation import load_conversation, save_conversation
from app.bot.hub_db import Row, now
from app.bot.reply import Reply, context_id, read_reply, said
from app.bot.wa import send_text, to_wa_id
from app.bot.when import format_when_short, parse_when

IDLE = "idle"
DRIVER_PICK = "awaiting_driver_pick"
OFFER_TIME = "awaiting_offer_time"

B = T.OPS_BTN


def _save(phone: str, step: str, trip_id: Optional[int] = None) -> None:
    save_conversation(phone, step, {}, trip_id, "ops")


def _is_open(trip: Row) -> bool:
    return trip.status in T.ACTIVE_STATUSES


def _pretty(status: str) -> str:
    return status.replace("_", " ", 1)


def handle_ops_message(phone: str, message: dict[str, Any]) -> None:
    to = to_wa_id(phone)
    reply = read_reply(message)
    convo = load_conversation(phone)

    # A list pick or a typed time answers the question asked last, about the trip stored
    # on the conversation (the list is not a template card).
    if reply.reply_id and reply.reply_id.startswith("driver:"):
        trip = T.get_trip(convo.trip_id) if convo.trip_id else None
        if not trip or not _is_open(trip):
            send_text(to, "That request is no longer open.")
            _save(phone, IDLE)
            return
        T.allocate_driver(trip.id, int(reply.reply_id.removeprefix("driver:")), "ops", reassign=bool(trip.driver_id))
        _save(phone, IDLE)
        return

    if convo.step == OFFER_TIME and not reply.reply_id and reply.text:
        trip = T.get_trip(convo.trip_id) if convo.trip_id else None
        if not trip or trip.status != "requested":
            send_text(to, "That request is no longer open.")
            _save(phone, IDLE)
            return
        at = parse_when(reply.text)
        if not at or at < now():
            send_text(to, 'I did not catch that time. Try something like "Saturday 08:00" or "tomorrow 14:00".')
            return
        T.offer_new_time(trip.id, at)
        _save(phone, IDLE)
        return

    # Everything else is a tap on a card; without its wamid, fall back to the trip most
    # recently put in front of her, then to the only possible candidate.
    trip = (T.trip_for_ops_reply(context_id(message))
            or (T.get_trip(convo.trip_id) if convo.trip_id else None)
            or _only_candidate(reply))
    if not trip:
        send_text(to, "Reply using the buttons on a request card, or use the dashboard.")
        return

    if said(reply, B["accept"]):
        if trip.status != "requested":
            send_text(to, f"{trip.ref} is already {_pretty(trip.status)}.")
            return
        sent = T.send_driver_picker(trip.id)
        _save(phone, DRIVER_PICK if sent else IDLE, trip.id)
        return

    if said(reply, B["no_car"]):
        if trip.status != "requested":
            send_text(to, f"{trip.ref} is already {_pretty(trip.status)}.")
            return
        T.decline_trip(trip.id)
        _save(phone, IDLE)
        return

    if said(reply, B["offer_time"]):
        if trip.status != "requested":
            send_text(to, f"{trip.ref} is already {_pretty(trip.status)}.")
            return
        send_text(to, f'What time can you do for {trip.ref} instead of {format_when_short(trip.scheduled_at)}? '
                      'Type it, for example "Saturday 08:00".')
        _save(phone, OFFER_TIME, trip.id)
        return

    if said(reply, B["pick_another"]):
        if not _is_open(trip):
            send_text(to, f"{trip.ref} is {_pretty(trip.status)} - nothing to reallocate.")
            return
        sent = T.send_driver_picker(trip.id, f"Who takes {trip.ref} instead?")
        _save(phone, DRIVER_PICK if sent else IDLE, trip.id)
        return

    if said(reply, B["cancel_trip"]):
        if not _is_open(trip):
            send_text(to, f"{trip.ref} is already {_pretty(trip.status)}.")
            return
        T.cancel_trip(trip.id, "ops", "cancelled by Anneli from WhatsApp")
        send_text(to, f"{trip.ref} cancelled. The guest{' and the driver have' if trip.driver_id else ' has'} been told.")
        _save(phone, IDLE)
        return

    if said(reply, B["keep_waiting"]):
        T.keep_waiting(trip.id)
        return
    if said(reply, B["no_charge"], B["release_hold"]):
        T.resolve_no_show(trip.id, False)
        return
    if said(reply, B["charge_no_show"]):
        T.resolve_no_show(trip.id, True)
        return
    if said(reply, B["send_anyway"]):
        T.send_car_anyway(trip.id)
        return

    send_text(to, f"Not sure what to do with that for {trip.ref}. Use the buttons on the card, or the dashboard.")


def _only_candidate(reply: Reply) -> Optional[Row]:
    """A tap without its card's wamid can still be unambiguous: "Accept" with one request
    waiting, or "Keep waiting" with one driver at a gate."""
    status = None
    if said(reply, B["accept"], B["no_car"], B["offer_time"]):
        status = "requested"
    if said(reply, B["keep_waiting"], B["no_charge"], B["release_hold"], B["charge_no_show"]):
        status = "driver_waiting"
    if not status:
        return None
    with hub_db.begin() as c:
        rows = hub_db.rows(c.execute(select(hub_db.trips).where(hub_db.trips.c.status == status).limit(2)))
    return rows[0] if len(rows) == 1 else None
