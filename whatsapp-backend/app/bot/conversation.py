"""The guest side: making the booking, the confirmations on the day, and the refusals and
cancellations that end it early.

Every inbound message is handled by the function for the step the guest is on. Each
handler does its work, sends the next message, and returns the step to move to. State
lives in wa_conversations, not memory, so a restart mid-booking loses nothing and a guest
can answer an hour later. The draft keeps the camelCase keys the earlier Next.js flow
wrote, so conversations already in progress carry on.

Button ids are the contract with WhatsApp: they come back verbatim on the webhook, so they
are stable strings and the visible titles can be reworded freely. Buttons on templates are
the exception — they come back as their text (see trip.GUEST_BTN).
"""

import json
import logging
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional, Union

from sqlalchemy import and_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.bot import flows, hub_db, trip as T
from app.bot.admin_log import log_flow
from app.bot.hub_db import Row, db_time, now
from app.bot.places import PRESETS, SHARED, distance_between, preset_place, resolve_place, resolve_shared_location
from app.bot.reply import FLOW_REPLY, Reply, context_id, is_location, read_reply, said
from app.bot.settings_store import TransferSettings, booking_window_error, fare_for, js_round, load_settings
from app.bot.wa import send_buttons, send_flow, send_list, send_location, send_location_request, send_text, to_wa_id
from app.bot.when import (estimated_arrival, format_arrival, format_day_name, format_duration, format_time,
                          format_when_long, from_iso, iso_z, parse_when)
from app.config import get_settings

log = logging.getLogger("kanaan.bot.conversation")


class STEPS:
    idle = "idle"
    start = "awaiting_start"
    when = "awaiting_when"
    datetime = "awaiting_datetime"
    trip_type = "awaiting_trip_type"
    day_trip_name = "awaiting_day_trip_name"
    frm = "awaiting_from"
    to = "awaiting_to"
    place_confirm = "awaiting_place_confirm"
    name = "awaiting_name"
    quote_confirm = "awaiting_quote_confirm"
    ops = "awaiting_ops"
    booked = "booked"
    cancel_confirm = "awaiting_cancel_confirm"
    review_note = "awaiting_review_note"


class BTN:
    book = "book"
    when_now = "when:now"
    when_later = "when:later"
    trip_day = "trip:day"
    trip_one_way = "trip:one_way"
    at_farm = "from:farm"
    send_location = "from:location"
    from_closer = "from:closer"
    from_end = "from:end"
    from_other = "from:other"
    to_farm = "to:farm"
    to_location = "to:location"
    to_other = "to:other"
    change_pickup = "from:change"
    place_yes = "place:yes"
    place_no = "place:no"
    place_closer = "place:closer"
    place_end = "place:end"
    quote_confirm = "quote:confirm"
    quote_change = "quote:change"
    cancel_yes = "cancel:yes"
    cancel_no = "cancel:no"
    review_skip = "review:skip"


class TRIP_TYPE:
    """draft["tripType"]: the kind of trip the guest chose. Only a one-way trip can be
    booked; a day trip is offered and answered with "coming soon" until it is built."""
    one_way = "ONE_WAY"
    day_trip = "DAY_TRIP"


# Either end of the trip: the farm, or a place dict from places.py.
End = Union[str, dict[str, Any]]
TOO_SHORT = "too-short"
NOT_FOUND = "I could not find that one. Type the name of a gate, a town or a lodge - or tap Send location to drop a pin."


@dataclass
class Conversation:
    phone: str
    step: str
    draft: dict[str, Any] = field(default_factory=dict)
    trip_id: Optional[int] = None


# ── state ────────────────────────────────────────────────────────────────────


def load_conversation(phone: str) -> Conversation:
    c_ = hub_db.wa_conversations
    with hub_db.begin() as c:
        r = hub_db.one(c, select(c_).where(c_.c.phone == phone))
    if not r:
        return Conversation(phone, STEPS.idle)
    try:
        draft = json.loads(r.draft) if r.draft else {}
    except ValueError:
        # A malformed draft restarts the booking rather than wedging the guest.
        log.error("unreadable draft for %s - starting over", phone)
        draft = {}
    return Conversation(phone, r.step, draft, r.trip_id)


def save_conversation(phone: str, step: str, draft: dict[str, Any], trip_id: Optional[int] = None,
                      role: str = "guest") -> None:
    values = {
        "phone": phone, "role": role, "step": step, "draft": json.dumps(draft), "trip_id": trip_id,
        "last_inbound_at": db_time(now()), "updated_at": db_time(now()),
    }
    with hub_db.begin() as c:
        stmt = pg_insert(hub_db.wa_conversations).values(**values)
        c.execute(stmt.on_conflict_do_update(index_elements=["phone"], set_=values))
    log_flow(phone, role, step, {**draft, "tripId": trip_id})


def _claim_step(phone: str, expected: str, step: str) -> bool:
    """Moves the conversation from `expected` to `step` in one statement - True only for
    the one message that made the move, so a double tap cannot act twice."""
    c_ = hub_db.wa_conversations
    with hub_db.begin() as c:
        moved = c.execute(
            c_.update().where(and_(c_.c.phone == phone, c_.c.step == expected))
            .values(step=step, updated_at=db_time(now())).returning(c_.c.id)
        ).first()
    return moved is not None


# ── steps ────────────────────────────────────────────────────────────────────


def ask_start(to: str) -> str:
    send_buttons(to, "Welcome to Kanaan Guest Farm.\nI can arrange a car for you.", [(BTN.book, "Book a car")])
    return STEPS.start


def ask_when(to: str) -> str:
    send_buttons(to, "When do you need the car?", [(BTN.when_now, "Now"), (BTN.when_later, "Pick a day and time")])
    return STEPS.when


def ask_datetime(to: str) -> str:
    """The calendar and time slots, as a WhatsApp Flow. A typed day and time still works
    (parse_when), and is the fallback while no flow is published."""
    flow_id = get_settings().kanaan_datetime_flow_id
    if flow_id:
        try:
            send_flow(to, "Tap below and choose when you would like to leave.", "Choose day and time", flow_id,
                      flows.flow_token(to), flows.FIRST_SCREEN, flows.opening_data(load_settings(), now()))
            return STEPS.datetime
        except Exception:
            log.exception("could not open the date/time flow - asking for typed text")
    send_text(to, 'When would you like to leave?\nTell me the day and time - for example "Saturday 05:30" or "tomorrow 14:00".')
    return STEPS.datetime


def ask_trip_type(to: str) -> str:
    """Asked once the time is set, just before the pickup."""
    send_buttons(to, "What kind of trip would you like?", [(BTN.trip_day, "Day Trip"), (BTN.trip_one_way, "One Way Trip")])
    return STEPS.trip_type


def refuse_day_trip(to: str) -> str:
    """Day trips are not offered yet: say so, with One Way Trip one tap away. The step
    stays the same, so that tap carries on exactly as if it had been chosen first."""
    send_buttons(to, "Day Trip Service – Coming Soon\n\n"
                     "This service is currently unavailable and will be introduced in the future.\n\n"
                     "Please select One Way Trip to continue with our currently available transfer service.",
                 [(BTN.trip_one_way, "One Way Trip")])
    return STEPS.trip_type


def ask_day_trip_name(to: str) -> str:
    """Day Trip, from a guest whose name is not known yet: the name, for their request."""
    send_text(to, "What is your full name?")
    return STEPS.day_trip_name


def known_name(phone: str, draft: dict[str, Any]) -> Optional[str]:
    """The guest's full name if the chat already has it - given earlier in this booking, on
    an earlier trip, or with an earlier day trip request - so it is not asked again."""
    if draft.get("name"):
        return draft["name"]
    last = T.last_trip(phone)
    if last and last.guest_name:
        return last.guest_name
    from app.db import SessionLocal
    from app.models import DayTripRequest as D
    try:
        with SessionLocal() as db:
            return db.scalar(select(D.guest_name).where(D.phone_number == phone, D.guest_name.is_not(None))
                             .order_by(D.created_at.desc()).limit(1))
    except Exception:
        log.exception("could not look up an earlier day trip request from %s", phone)
        return None


def day_trip_requested(phone: str, to: str, draft: dict[str, Any]) -> str:
    """Day Trip, with the guest's name: the request is kept, then the usual "coming soon"."""
    keep_day_trip_request(phone, draft)
    return refuse_day_trip(to)


def keep_day_trip_request(phone: str, draft: dict[str, Any]) -> None:
    """Who asked for a day trip (full name and WhatsApp number), and for when - kept for the
    admin portal (Transportation > Day trip requests), since the chat itself books nothing.
    The same guest asking again for the same day and time is the same request; a request
    for another day or time is a new one. A failure is logged and never stops the chat."""
    from app.db import SessionLocal  # the service's own database, beside the admin log
    from app.models import DayTripRequest

    if not draft.get("scheduledAt"):
        return
    try:
        with SessionLocal() as db:
            db.execute(pg_insert(DayTripRequest.__table__).values(
                id=str(uuid.uuid4()),
                phone_number=phone,
                guest_name=draft.get("name"),
                requested_for=db_time(from_iso(draft["scheduledAt"])),
                leave_now=bool(draft.get("leaveNow")),
                created_at=db_time(now()),
            ).on_conflict_do_nothing(index_elements=["phone_number", "requested_for"]))
            db.commit()
    except Exception:
        log.exception("could not keep the day trip request from %s", phone)


FARM_ROW = {"title": "Kanaan Guest Farm", "description": "R40, Hazyview"}


def _place_rows(prefix: str, exclude: Optional[End] = None) -> list[dict[str, str]]:
    """The one-tap choices: the farm, the preset places, the guest's own location, or
    somewhere else. `prefix` is "from" or "to"; the end already chosen is left out."""
    rows = []
    if exclude != "farm":
        rows.append({"id": f"{prefix}:farm", **FARM_ROW})
    taken = exclude.get("preset") if isinstance(exclude, dict) else None
    rows += [{"id": f"{prefix}:preset:{key}", "title": p["title"], "description": p["description"]}
             for key, p in PRESETS.items() if key != taken]
    rows.append({"id": f"{prefix}:location", "title": "Share my location", "description": "Send your current location or drop a pin"})
    rows.append({"id": f"{prefix}:other", "title": "Somewhere else", "description": "Type a place - a gate, a lodge, an address"})
    return rows


def ask_from(to: str) -> str:
    send_list(to, "Where should the driver collect you?\nChoose a place below, or share your location.",
              "Choose pickup", _place_rows("from"))
    return STEPS.frm


def ask_pickup_location(to: str) -> str:
    """The guest is not at the farm: ask for a pin, which the distance is measured from."""
    send_location_request(
        to,
        "Please share your pickup location.\n"
        'Tap "Send location" below, then choose your current location or drop a pin where the driver should meet you.',
    )
    return STEPS.frm


def tell_driver_arrival(to: str, pickup: dict[str, Any]) -> None:
    """For a car wanted now: when the driver should reach the pickup - the current South
    African time plus the drive to it, the same duration the pickup was measured with
    (from the farm). An estimate: traffic is not counted."""
    minutes = pickup.get("durationMin")
    if not minutes:
        return
    at = now()
    send_text(to, "Estimated Driver Arrival\n\n"
                  f"Your driver is estimated to reach your pickup location at {format_arrival(estimated_arrival(int(minutes), at), at)}.\n\n"
                  f"Estimated travel time: {format_duration(int(minutes))}.")


def ask_to(to: str, frm: Optional[End] = None) -> str:
    """The same pick-list as the pickup, for the drop-off, whatever the pickup was - any
    two places can be a trip. The pickup itself is left off the list. No distance here:
    it would be measured from the farm, which means nothing to the guest."""
    where = f"We will collect you at {frm['name']}.\n" if isinstance(frm, dict) else ""
    send_list(to, f"{where}Where are you going?\nChoose a place below, or share a location.", "Choose destination",
              _place_rows("to", exclude=frm))
    return STEPS.to


def ask_other_place(to: str, step: str) -> str:
    """"Somewhere else": type it, or drop a pin."""
    send_location_request(to, 'Type the place - a gate, a hotel, a landmark or an address - or tap "Send location" to drop a pin.')
    return step


def show_pin(to: str, place: dict[str, Any]) -> None:
    """The chosen place as a map pin the guest can open in Google Maps."""
    try:
        send_location(to, float(place["lat"]), float(place["lng"]), place["name"])
    except Exception:
        log.exception("could not send the map pin for %s", place.get("name"))


def confirm_place(to: str, place: dict[str, Any], pin: bool = True) -> str:
    # The place as a map pin first, so "Is this the right spot?" can be checked on the map.
    # Not for a pin the guest shared themselves, or one already shown - they have it.
    if pin and not place.get("shared"):
        show_pin(to, place)
    send_buttons(to, f"{place['name']}\n{_km(place['distanceKm'])} km, about {place['durationMin']} minutes\nIs this the right spot?",
                 [(BTN.place_yes, "Yes, that one"), (BTN.place_no, "No, try again")])
    return STEPS.place_confirm


def ask_name(to: str) -> str:
    send_text(to, "What is your full name? The driver will ask for you by this name.")
    return STEPS.name


def confirm_quote(to: str, draft: dict[str, Any]) -> str:
    """Everything the guest is agreeing to, with the fare. No payment is asked for here:
    it is only offered once Anneli has accepted and a driver is allocated."""
    when = from_iso(draft["scheduledAt"])
    from_name = "The farm gate" if draft["from"] == "farm" else draft["from"]["name"]
    to_name = "the farm gate" if draft["to"] == "farm" else draft["to"]["name"]
    lines = ["Please confirm:", f"{from_name} to {to_name}"]
    if draft.get("name"):
        lines.append(f"Name: {draft['name']}")
    # The number they are writing from - what the driver will call if needed.
    lines.append(f"Phone: {T.format_phone(to)}")
    place = draft["place"]
    trip_size = f"{_km(place['distanceKm'])} km" + (f", about {place['durationMin']} minutes" if place.get("durationMin") else "")
    lines += [format_when_long(when), trip_size, f"Fare: R {_num(draft['fare'])}", "",
              "We are checking driver availability and will confirm your booking as soon as possible. "
              "No payment is required until your car is confirmed."]
    send_buttons(to, "\n".join(lines), [(BTN.quote_confirm, "Send request"), (BTN.quote_change, "Change something")])
    return STEPS.quote_confirm


def refuse_too_far(to: str, place: dict[str, Any], settings: TransferSettings, step: str, end: str) -> str:
    """Past the chat limit, so no fare is quoted. Pick a spot within range, or stop."""
    if end == "pickup":
        what = "That pickup point"
    else:
        what = "That drop-off point" if place["name"] == SHARED else place["name"]
    limit = settings.max_chat_km
    body = (f"Sorry - {what} is about {js_round(place['distanceKm'])} km from Kanaan Guest Farm. "
            f"We can only book cars by chat within {limit} km of the farm.\n\n"
            f"Choose a {'pickup' if end == 'pickup' else 'drop-off'} point within {limit} km, "
            f"or call Anneli on {settings.ops_phone} to arrange a longer transfer.")
    closer, stop = (BTN.from_closer, BTN.from_end) if end == "pickup" else (BTN.place_closer, BTN.place_end)
    send_buttons(to, body, [(closer, f"Pick within {limit} km"), (stop, "End")])
    return step


def _num(x: Any) -> str:
    """280 rather than 280.0; 250.5 stays 250.5."""
    f = float(x)
    return str(int(f)) if f.is_integer() else str(f)


def _km(x: Any) -> str:
    return _num(x)


# ── committing the booking ───────────────────────────────────────────────────


def create_trip(phone: str, draft: dict[str, Any]) -> int:
    """Writes the trip. The KN- reference needs the generated id, so the row is written
    with a unique placeholder first (two simultaneous inserts must not collide on the
    unique ref) and renamed in the same transaction."""
    place = draft["place"]
    # Between two places, neither the farm: the pickup point is stored too.
    pickup = draft["from"] if draft.get("direction") == "drop" and isinstance(draft.get("from"), dict) else None
    pickup_cols = {"pickup_name": pickup["name"], "pickup_lat": pickup["lat"], "pickup_lng": pickup["lng"]} if pickup else {}
    with hub_db.begin() as c:
        trip_id = c.execute(hub_db.trips.insert().values(
            **pickup_cols,
            ref=f"pending-{uuid.uuid4()}",
            direction=draft["direction"],
            status="draft",
            guest_phone=phone,
            guest_name=draft.get("name"),
            place_name=place["name"],
            place_lat=place["lat"],
            place_lng=place["lng"],
            distance_km=place["distanceKm"],
            duration_min=place["durationMin"],
            scheduled_at=db_time(from_iso(draft["scheduledAt"])),
            fare=draft["fare"],
            created_at=db_time(now()),
            updated_at=db_time(now()),
        ).returning(hub_db.trips.c.id)).scalar_one()
        ref = f"KN-{1000 + trip_id}"
        c.execute(hub_db.trips.update().where(hub_db.trips.c.id == trip_id).values(ref=ref))
    T.record(trip_id, "guest", "trip_created", ref)
    return trip_id


# ── an end of the trip from a reply ──────────────────────────────────────────


def read_end(message: dict[str, Any], reply: Reply, farm_id: str) -> Optional[End]:
    if farm_id and reply.reply_id == farm_id:
        return "farm"
    # One of the preset places from the list ("from:preset:airport").
    if reply.reply_id and ":preset:" in reply.reply_id:
        return preset_place(reply.reply_id.rsplit(":", 1)[1])
    if is_location(message):
        loc = message["location"]
        return resolve_shared_location(float(loc["latitude"]), float(loc["longitude"]), loc.get("name"))
    if not reply.text or reply.reply_id:
        return TOO_SHORT
    if re.fullmatch(r"(kanaan|the farm|farm|farm gate|kanaan guest farm)", reply.text.strip(), re.I):
        return "farm"
    return resolve_place(reply.text)


# ── router ───────────────────────────────────────────────────────────────────


def handle_guest_message(phone: str, message: dict[str, Any]) -> None:
    """One inbound guest message, against the step they are on. Unrecognised input
    re-asks the current question rather than advancing."""
    to = to_wa_id(phone)
    reply = read_reply(message)
    reply_id, text = reply.reply_id, reply.text
    convo = load_conversation(phone)
    draft = convo.draft

    # Replies about a live trip can arrive at any step, days after the booking was made.
    if handle_trip_reply(phone, message, reply, convo):
        return

    # "cancel" always works. With a live trip it means that trip, through the same yes/no -
    # until Anneli confirms the car, after which it is turned down.
    if not reply_id and re.match(r"^(cancel|stop|start over|restart)\b", text, re.I):
        live = T.trip_for_reply(phone, "guest")
        if live and live.status in T.ACTIVE_STATUSES and not re.match(r"^(start over|restart)", text, re.I):
            if T.guest_can_cancel(live):
                ask_cancel(phone, to, live)
            else:
                T.refuse_guest_cancel(live)
            return
        send_buttons(to, "No problem - that request is cancelled. Tap below whenever you need a car.", [T.BOOK_AGAIN])
        save_conversation(phone, STEPS.idle, {})
        return

    step = convo.step

    # "Book a car" on any earlier message (a cancellation, a review thank-you) starts a
    # fresh booking straight at "When do you need the car?".
    if reply_id == BTN.book and step != STEPS.start:
        save_conversation(phone, ask_when(to), {})
        return

    if step == STEPS.start:
        if reply_id != BTN.book and not said(reply, "book a car", "book", "yes"):
            save_conversation(phone, ask_start(to), {})
            return
        save_conversation(phone, ask_when(to), {})
        return

    if step == STEPS.when:
        if reply_id == BTN.when_now or said(reply, "now"):
            when = parse_when("now")
            error = booking_window_error(when, load_settings())
            if error:
                send_text(to, f"{error}\nPlease choose another time.")
                save_conversation(phone, ask_when(to), draft)
                return
            draft["scheduledAt"] = iso_z(when)
            # The driver sets off as soon as possible, so an arrival time can be estimated.
            draft["leaveNow"] = True
            save_conversation(phone, ask_trip_type(to), draft)
            return
        if reply_id == BTN.when_later:
            save_conversation(phone, ask_datetime(to), draft)
            return
        typed = parse_when(text) if text and not reply_id else None
        if typed:
            _handle_datetime(phone, to, typed, draft)
            return
        save_conversation(phone, ask_when(to), draft)
        return

    if step in (STEPS.when, STEPS.datetime) and reply_id == FLOW_REPLY:
        # The guest confirmed a date and time in the flow.
        picked = flows.picked_datetime(flows.read_flow_reply(message) or {})
        if not picked:
            send_text(to, "Sorry, I could not read that time.")
            save_conversation(phone, ask_datetime(to), draft)
            return
        _handle_datetime(phone, to, picked, draft)
        return

    if step == STEPS.datetime:
        when = parse_when(text)
        if not when:
            if get_settings().kanaan_datetime_flow_id:
                # Offer the picker again rather than asking them to type it better.
                send_text(to, "Sorry, I did not catch that time.")
                save_conversation(phone, ask_datetime(to), draft)
            else:
                send_text(to, 'Sorry, I did not catch that time. Try something like "Saturday 05:30" or "tomorrow 14:00".')
                save_conversation(phone, STEPS.datetime, draft)
            return
        _handle_datetime(phone, to, when, draft)
        return

    if step == STEPS.day_trip_name:
        # The full name for a Day Trip request. A double-sent name arrives twice at once:
        # only the message that moves the conversation off this step keeps the request.
        if text and not reply_id:
            if not _claim_step(phone, STEPS.day_trip_name, STEPS.trip_type):
                return
            draft["name"] = text[:60]
            save_conversation(phone, day_trip_requested(phone, to, draft), draft)
            return
        if not reply_id:
            save_conversation(phone, ask_day_trip_name(to), draft)
            return
        # A tap on the trip type question is answered just as it would be there.
        step = STEPS.trip_type

    if step == STEPS.trip_type:
        if reply_id == BTN.trip_one_way or said(reply, "one way trip", "one way"):
            draft["tripType"] = TRIP_TYPE.one_way
            save_conversation(phone, ask_from(to), draft)
            return
        if reply_id == BTN.trip_day or said(reply, "day trip"):
            # Kept as a Day Trip request once the guest's full name is known; nothing is
            # quoted or booked.
            draft["tripType"] = TRIP_TYPE.day_trip
            name = known_name(phone, draft)
            if not name:
                save_conversation(phone, ask_day_trip_name(to), draft)
                return
            draft["name"] = name
            save_conversation(phone, day_trip_requested(phone, to, draft), draft)
            return
        save_conversation(phone, ask_trip_type(to), draft)
        return

    if step == STEPS.frm:
        if reply_id in (BTN.send_location, BTN.from_closer):
            save_conversation(phone, ask_pickup_location(to), draft)
            return
        if reply_id == BTN.from_other:
            save_conversation(phone, ask_other_place(to, STEPS.frm), draft)
            return
        if reply_id == BTN.from_end:
            send_buttons(to, f"No problem. Call Anneli on {load_settings().ops_phone} for a longer transfer, or tap below to book a car within range.",
                         [T.BOOK_AGAIN])
            save_conversation(phone, STEPS.idle, {})
            return
        end = read_end(message, reply, BTN.at_farm)
        if end == TOO_SHORT:
            save_conversation(phone, ask_from(to), draft)
            return
        if not end:
            send_location_request(to, NOT_FOUND)
            save_conversation(phone, STEPS.frm, draft)
            return
        # Measured from the farm the moment the pickup is known, so a guest out of range
        # is told now rather than after also choosing a destination. The preset places
        # are served whatever the distance.
        if end != "farm":
            settings = load_settings()
            if not end.get("preset") and end["distanceKm"] > settings.max_chat_km:
                save_conversation(phone, refuse_too_far(to, end, settings, STEPS.frm, "pickup"), draft)
                return
            if end.get("preset"):
                show_pin(to, end)
            if draft.get("leaveNow"):
                tell_driver_arrival(to, end)
        draft["from"] = end
        save_conversation(phone, ask_to(to, end), draft)
        return

    if step == STEPS.to:
        if reply_id == BTN.change_pickup:
            draft.pop("from", None)
            save_conversation(phone, ask_from(to), draft)
            return
        if reply_id == BTN.to_location:
            send_location_request(to, 'Please share where you are going.\nTap "Send location" below and drop a pin on the drop-off point.')
            save_conversation(phone, STEPS.to, draft)
            return
        if reply_id == BTN.to_other:
            save_conversation(phone, ask_other_place(to, STEPS.to), draft)
            return
        end = read_end(message, reply, BTN.to_farm)
        if end == TOO_SHORT:
            save_conversation(phone, ask_to(to, draft.get("from")), draft)
            return
        if not end:
            send_location_request(to, NOT_FOUND)
            save_conversation(phone, STEPS.to, draft)
            return
        draft["to"] = end
        _settle_place(phone, to, draft)
        return

    if step == STEPS.place_confirm:
        if reply_id in (BTN.place_no, BTN.place_closer):
            # Re-ask whichever end was the far one; the farm end stands.
            redo_to = draft.get("direction") == "drop"
            draft.pop("place", None)
            draft.pop("to" if redo_to else "from", None)
            save_conversation(phone, ask_to(to, draft.get("from")) if redo_to else ask_from(to), draft)
            return
        if not reply_id and (text or is_location(message)):
            # Typed a place instead of tapping: a fresh answer for the far end.
            end = read_end(message, reply, "")
            if not end or end == TOO_SHORT:
                send_location_request(to, NOT_FOUND)
                save_conversation(phone, STEPS.place_confirm, draft)
                return
            draft["to" if draft.get("direction") == "drop" else "from"] = end
            draft.pop("place", None)
            _settle_place(phone, to, draft)
            return
        if reply_id == BTN.place_end:
            send_buttons(to, f"No problem. Call Anneli on {load_settings().ops_phone} for a longer transfer, or tap below to book a car within range.",
                         [T.BOOK_AGAIN])
            save_conversation(phone, STEPS.idle, {})
            return
        if reply_id != BTN.place_yes:
            save_conversation(phone, confirm_place(to, draft["place"], pin=False), draft)
            return
        save_conversation(phone, ask_name(to), draft)
        return

    if step == STEPS.name:
        if not text or reply_id:
            save_conversation(phone, ask_name(to), draft)
            return
        draft["name"] = text[:60]
        place = draft["place"]
        f = fare_for(float(place["distanceKm"]), load_settings(), place.get("fixedFare"))
        draft["fare"] = int(f) if float(f).is_integer() else f
        save_conversation(phone, confirm_quote(to, draft), draft)
        return

    if step == STEPS.quote_confirm:
        if reply_id == BTN.quote_change:
            # Start again from the time but keep the name.
            save_conversation(phone, ask_when(to), {"name": draft.get("name")})
            return
        if reply_id != BTN.quote_confirm:
            save_conversation(phone, confirm_quote(to, draft), draft)
            return
        # A double-tapped "Send request" arrives twice at once: only the tap that moves the
        # conversation off this step creates the trip.
        if not _claim_step(phone, STEPS.quote_confirm, STEPS.ops):
            return
        # No payment at booking: the request goes straight to Anneli.
        trip_id = create_trip(phone, draft)
        T.submit_to_ops(trip_id)
        save_conversation(phone, STEPS.ops, {}, trip_id)
        return

    if step == STEPS.review_note:
        # The note after a low rating: whatever they type, or Skip.
        if convo.trip_id and (reply_id == BTN.review_skip or (text and not reply_id)):
            T.guest_review_note(convo.trip_id, None if reply_id == BTN.review_skip else text)
            save_conversation(phone, STEPS.idle, {})
            return
        send_buttons(to, "Type a short note about what went wrong, or tap Skip.", [(BTN.review_skip, "Skip")])
        save_conversation(phone, STEPS.review_note, {}, convo.trip_id)
        return

    if step in (STEPS.ops, STEPS.booked):
        live = T.get_trip(convo.trip_id) if convo.trip_id else None
        cancel = T.cancel_button(live) if live else None
        body = "Thanks - nothing more needed from you right now. I will message you as soon as there is news."
        if cancel:
            send_buttons(to, body + "\nIf your plans change, tap below.", [cancel], live.id)
        elif live and live.status in T.ACTIVE_STATUSES:
            send_text(to, body)
        else:
            send_buttons(to, "Your last trip is closed. Tap below whenever you need another car.", [T.BOOK_AGAIN])
        save_conversation(phone, step, draft, convo.trip_id)
        return

    if step == STEPS.cancel_confirm:
        trip = T.trip_for_reply(phone, "guest") if convo.trip_id else None
        if reply_id == BTN.cancel_yes and trip:
            # Asked while the request waited on Anneli, answered after she confirmed it.
            if not T.guest_can_cancel(trip):
                T.refuse_guest_cancel(trip)
                save_conversation(phone, STEPS.booked, {}, trip.id)
                return
            T.cancel_trip(trip.id, "guest", "guest cancelled by chat")
            save_conversation(phone, STEPS.idle, {})
            return
        if reply_id == BTN.cancel_no or not trip:
            send_text(to, f"Kept. Your car for {format_when_long(trip.scheduled_at)} stands." if trip else "There is nothing to cancel.")
            save_conversation(phone, STEPS.booked if trip else STEPS.idle, {}, trip.id if trip else None)
            return
        ask_cancel(phone, to, trip)
        return

    save_conversation(phone, ask_start(to), {})


def _handle_datetime(phone: str, to: str, when, draft: dict[str, Any]) -> None:
    # A time already gone (a slot earlier today) or outside the rules: say why, then offer
    # the picker again.
    if when < now():
        send_text(to, "That time has already passed. Please choose a later time.")
        save_conversation(phone, ask_datetime(to), draft)
        return
    error = booking_window_error(when, load_settings())
    if error:
        send_text(to, f"{error}\nPlease choose another time.")
        save_conversation(phone, ask_datetime(to), draft)
        return
    draft["scheduledAt"] = iso_z(when)
    save_conversation(phone, ask_trip_type(to), draft)


def _same_spot(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return abs(float(a["lat"]) - float(b["lat"])) < 0.001 and abs(float(a["lng"]) - float(b["lng"])) < 0.001


def _settle_place(phone: str, to: str, draft: dict[str, Any]) -> None:
    """Both ends are known. To or from the farm, the far end is priced by its distance from
    the farm (and may have a fixed price); between two other places, by the drive from
    the pickup to the drop-off."""
    frm, dest = draft.get("from"), draft.get("to")
    if (frm == "farm" and dest == "farm") or (isinstance(frm, dict) and isinstance(dest, dict) and _same_spot(frm, dest)):
        send_text(to, "The pickup and the drop-off are the same place. Where are you going?")
        draft.pop("to", None)
        save_conversation(phone, ask_to(to, frm), draft)
        return

    settings = load_settings()
    if frm != "farm" and dest != "farm":
        # Between two places: both must be in the area served (the pickup was checked
        # already), and the fare is the drive from one to the other.
        if not dest.get("preset") and dest["distanceKm"] > settings.max_chat_km:
            draft["direction"] = "drop"
            save_conversation(phone, refuse_too_far(to, dest, settings, STEPS.place_confirm, "drop"), draft)
            return
        draft["direction"] = "drop"
        leg = distance_between(float(frm["lat"]), float(frm["lng"]), float(dest["lat"]), float(dest["lng"]))
        draft["place"] = {**dest, **leg, "fixedFare": None, "between": True}
        save_conversation(phone, confirm_place(to, draft["place"]), draft)
        return

    draft["direction"] = "drop" if frm == "farm" else "pickup"
    place = dest if draft["direction"] == "drop" else frm
    draft["place"] = place
    if not place.get("preset") and place["distanceKm"] > settings.max_chat_km:
        save_conversation(phone, refuse_too_far(to, place, settings, STEPS.place_confirm, draft["direction"]), draft)
        return
    save_conversation(phone, confirm_place(to, place, pin=not (draft["direction"] == "pickup" and place.get("preset"))), draft)


# ── replies about a live trip ────────────────────────────────────────────────


def ask_cancel(phone: str, to: str, trip: Row) -> None:
    send_buttons(to, f"Cancel your car to {T.to_label(trip)} on {format_day_name(trip.scheduled_at)} at "
                     f"{format_time(trip.scheduled_at)}?\nRef {trip.ref}",
                 [(BTN.cancel_yes, "Yes, cancel it"), (BTN.cancel_no, "No, keep it")], trip.id)
    save_conversation(phone, STEPS.cancel_confirm, {}, trip.id)


def handle_trip_reply(phone: str, message: dict[str, Any], reply: Reply, convo: Conversation) -> bool:
    """Buttons on the templates and cards sent after booking. True when handled."""
    to = to_wa_id(phone)
    rid = reply.reply_id or ""
    B = T.GUEST_BTN

    # Anneli's alternative time.
    if rid.startswith("offer:accept:"):
        trip = T.trip_for_reply(phone, "guest", context_id(message))
        if trip and trip.status == "requested":
            T.accept_new_time(trip.id, from_iso(rid.removeprefix("offer:accept:")))
            save_conversation(phone, STEPS.ops, {}, trip.id)
        return True

    wants_cancel = rid in ("offer:decline", "guest:cancel") or said(reply, B["cancel_trip"], B["cancel_request"], B["cancel_the_trip"])
    is_trip_button = (wants_cancel or rid.startswith("guest:") or said(
        reply, B["can_see"], B["not_yet"], B["we_are_here"], B["coming_now"], B["try_another_time"], B["end"],
        B["good"], B["not_good"]))
    if not is_trip_button:
        return False

    trip = T.trip_for_reply(phone, "guest", context_id(message))

    # The star rating, after the ride is complete and paid.
    if rid.startswith("guest:rating:"):
        rated = trip or T.last_trip(phone)
        stars = int(rid.rsplit(":", 1)[1]) if rid.rsplit(":", 1)[1].isdigit() else 0
        if rated and T.guest_rated(rated.id, stars):
            save_conversation(phone, STEPS.review_note, {}, rated.id)
        return True

    # Good / Not good on cards sent before the star rating. After the trip has closed.
    if rid.startswith("guest:feedback:") or said(reply, B["good"], B["not_good"]):
        closed = trip or T.last_trip(phone)
        if closed:
            T.guest_feedback(closed.id, rid == "guest:feedback:good" or said(reply, B["good"]))
        return True

    if said(reply, B["try_another_time"]):
        last = T.last_trip(phone)
        save_conversation(phone, ask_when(to), {"name": last.guest_name} if last and last.guest_name else {})
        return True
    if said(reply, B["end"]):
        send_buttons(to, f"No problem. Tap below whenever you need a car, or call Anneli on {load_settings().ops_phone}.", [T.BOOK_AGAIN])
        save_conversation(phone, STEPS.idle, {})
        return True

    # Pay now / Pay later — offered once Anneli has allocated a driver; Pay now is still good
    # after the ride closes (the tap may come late). Pay later leads to Card payment (the
    # driver's card machine) or Paystack payment, both at the destination. "Pay during
    # ride" is on older offers only.
    if rid == "guest:pay:noshow":
        target = trip or T.last_trip(phone)
        if target:
            T.guest_pay_noshow(target.id)
        return True

    pay = {
        T.PAY_NOW[0]: T.guest_pay_now,
        T.PAY_LATER[0]: T.guest_pay_later,
        T.PAY_BY_CARD[0]: T.guest_pay_by_card,
        T.PAY_BY_PAYSTACK[0]: T.guest_pay_by_paystack,
        "guest:pay:after": T.guest_pay_after,
    }
    if rid in pay:
        target = trip or T.last_trip(phone)
        if not target or target.status in ("requested", "draft"):
            send_text(to, "Nothing to pay yet - you will be asked once your car is confirmed.")
        else:
            pay[rid](target.id)
        return True

    if not trip or trip.status not in T.ACTIVE_STATUSES:
        send_buttons(to, "There is no live booking on this number. Tap below to book a car.", [T.BOOK_AGAIN])
        return True

    if wants_cancel:
        # "Cancel this trip" on a confirmation or reminder sent before those templates lost
        # the button: once the car is confirmed, the guest calls Anneli instead.
        if T.guest_can_cancel(trip):
            ask_cancel(phone, to, trip)
        else:
            T.refuse_guest_cancel(trip)
        return True

    if trip.status == "driver_waiting" and not (rid == "guest:at_drop:yes" or said(reply, B["we_are_here"])):
        if rid == "guest:can_see" or said(reply, B["can_see"]):
            T.guest_confirmed_pickup(trip.id)
            return True
        if rid == T.NEW_CODE[0]:
            T.pickup_code_again(trip.id)
            return True
        if said(reply, B["not_yet"]):
            T.guest_cannot_see_driver(trip.id)
            return True
        if said(reply, B["coming_now"]):
            T.guest_coming_now(trip.id)
            return True
    # in_progress: the driver closes the ride with "Ride complete", so an old
    # "Yes, we are here" card just gets the status line below.

    body = f"Noted. Your car ({trip.ref}) is {_describe(trip)}. Nothing more is needed from you right now."
    cancel = T.cancel_button(trip)
    if cancel:
        send_buttons(to, body, [cancel], trip.id)
    else:
        send_text(to, body)
    return True


def _describe(trip: Row) -> str:
    return {
        "requested": "with Anneli, waiting for a driver",
        "allocated": f"confirmed for {format_when_long(trip.scheduled_at)}",
        "driver_en_route": "on its way to you",
        "driver_waiting": "waiting for you at the pickup",
        "in_progress": "under way",
    }.get(trip.status, trip.status)


def start_conversation(phone: str) -> None:
    save_conversation(phone, ask_start(to_wa_id(phone)), {})
