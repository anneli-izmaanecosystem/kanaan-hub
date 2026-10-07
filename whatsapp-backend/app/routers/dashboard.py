"""What the Next.js dashboard shows on its Transportation and WhatsApp tabs.

The dashboard runs on Vercel with its own database and no connection to kanaan_hub, so
these tabs read and edit the bot's data here instead: its API routes forward to these
with X-Internal-Secret (lib/bot.ts) and hand the JSON straight to the browser. The shapes
are what those routes returned when they queried the tables with Drizzle - camelCase
keys, numerics as strings, times as ISO UTC - so the pages did not change.

Writes that message people (allocating a driver, cancelling) run the same code as the
WhatsApp buttons, so the guest, driver and Anneli are told exactly as they would be there.
"""

import math
import re
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import or_, select, text
from sqlalchemy.exc import IntegrityError

from app.bot import hub_db
from app.bot import trip as T
from app.bot.hub_db import db_time, now
from app.bot.places import distance_from_farm
from app.bot.roles import to_e164
from app.bot.settings_store import load_settings
from app.routers.bot import _require_bot
from app.routers.internal import require_internal_secret

router = APIRouter(
    prefix="/dashboard", tags=["dashboard"],
    dependencies=[Depends(require_internal_secret), Depends(_require_bot)],
)

OPEN_STATUSES = ("requested", "allocated", "driver_en_route", "driver_waiting", "in_progress")
# A driver on one of these has been named to the guest, so they cannot be removed.
LIVE_STATUSES = ("allocated", "driver_en_route", "driver_waiting", "in_progress")
TRIP_ACTIONS = ("allocate", "cancel", "complete", "no_show")


# ── JSON in Drizzle's shape ──────────────────────────────────────────────────


def _camel(key: str) -> str:
    head, *rest = key.split("_")
    return head + "".join(part.title() for part in rest)


def _snake(key: str) -> str:
    return re.sub(r"[A-Z]", lambda m: f"_{m.group(0).lower()}", key)


def _value(v: Any) -> Any:
    if isinstance(v, datetime):
        # The columns hold naive UTC; JSON gets what JavaScript's Date.toJSON would.
        aware = v if v.tzinfo else v.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(v, Decimal):
        return str(v)  # node-postgres hands numerics over as strings, and the pages expect that
    return v


def _out(mapping: Any) -> dict[str, Any]:
    items = vars(mapping).items() if isinstance(mapping, hub_db.Row) else mapping.items()
    return {_camel(k): _value(v) for k, v in items}


def _text(v: Any) -> str:
    return "" if v is None else str(v).strip()


def _number(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return math.nan


def normalise_phone(value: Any) -> Optional[str]:
    """Accepts 072 118 4460, 27721184460 or +27721184460 and returns E.164. WhatsApp
    identifies people by number, so a driver saved in the wrong shape never matches."""
    raw = re.sub(r"[\s()-]", "", _text(value))
    if not raw:
        return None
    if raw.startswith("+"):
        return raw if re.fullmatch(r"\+\d{8,15}", raw) else None
    if raw.startswith("0"):
        return f"+27{raw[1:]}"  # South African local form
    if raw.startswith("27"):
        return f"+{raw}"
    return f"+{raw}" if re.fullmatch(r"\d{8,15}", raw) else None


# ── WhatsApp tab ─────────────────────────────────────────────────────────────
# Read-only: the guests' and the drivers' chats with the bot. Anneli's own chat stays out.

# What the tab shows of a trip (the page's Trip type) - no card or payment fields.
THREAD_TRIP_COLUMNS = ("id", "ref", "status", "direction", "guest_name", "place_name", "scheduled_at", "fare")


def _event_out(e: Any) -> dict[str, Any]:
    """A trip event for the timeline. A pickup code's details (its salt and HMAC) stay in
    the database: the code is for the guest alone."""
    event = _out(e)
    if event["event"].startswith("pickup_code"):
        event["detail"] = None
    return event


@router.get("/conversations")
def conversations():
    """One row per guest or driver who has ever exchanged a message, newest activity first,
    named as the driver list or the guest's latest booking has them."""
    with hub_db.begin() as c:
        rs = c.execute(text("""
            with latest as (
                select phone, max(created_at) as last_at, count(*)::int as count,
                       count(*) filter (where direction = 'inbound')::int as inbound
                from wa_messages where role in ('guest', 'driver') group by phone
            )
            select l.phone, l.last_at, l.count, l.inbound,
                   m.body as last_body, m.direction::text as last_direction, m.role::text as role,
                   wc.step, wc.trip_id,
                   coalesce(
                       (select d.name from drivers d where d.phone = l.phone),
                       (select t.guest_name from trips t where t.guest_phone = l.phone and t.guest_name is not null
                         order by t.id desc limit 1)
                   ) as name,
                   ct.ref as trip_ref, ct.status::text as trip_status
            from latest l
            left join lateral (
                select body, direction, role from wa_messages m
                where m.phone = l.phone and m.role in ('guest', 'driver')
                order by m.created_at desc, m.id desc limit 1
            ) m on true
            left join wa_conversations wc on wc.phone = l.phone and wc.role = m.role
            left join trips ct on ct.id = wc.trip_id
            order by l.last_at desc
        """)).mappings().all()

    out = []
    for r in rs:
        row = dict(r)
        ref, status = row.pop("trip_ref"), row.pop("trip_status")
        out.append({**_out(row), "trip": {"ref": ref, "status": status} if ref else None})
    return out


@router.get("/conversations/{phone}")
def conversation(phone: str):
    """The full thread with one guest or driver, oldest first, where their conversation sits,
    and their trips: the ones a guest booked, or the ones a driver was given."""
    phone = to_e164(phone.strip())
    M, Tr, E, WC, D = hub_db.wa_messages, hub_db.trips, hub_db.trip_events, hub_db.wa_conversations, hub_db.drivers
    with hub_db.begin() as c:
        messages = c.execute(
            select(M.c.id, M.c.wa_message_id, M.c.direction, M.c.role, M.c.kind, M.c.template_name,
                   M.c.body, M.c.payload, M.c.trip_id, M.c.created_at)
            .where(M.c.phone == phone, M.c.role.in_(("guest", "driver"))).order_by(M.c.created_at, M.c.id)
        ).mappings().all()
        role = messages[-1]["role"] if messages else "guest"
        convo = c.execute(
            select(WC.c.step, WC.c.trip_id).where(WC.c.phone == phone, WC.c.role == role)
        ).mappings().first()
        driver = c.execute(select(D.c.id, D.c.name).where(D.c.phone == phone)).mappings().first()
        mine = Tr.c.guest_phone == phone
        if driver:
            mine = or_(mine, Tr.c.driver_id == driver["id"])
        trips = c.execute(
            select(*(Tr.c[k] for k in THREAD_TRIP_COLUMNS)).where(mine).order_by(Tr.c.id.desc()).limit(10)
        ).mappings().all()
        events = c.execute(
            select(E).where(E.c.trip_id.in_([t["id"] for t in trips])).order_by(E.c.at, E.c.id)
        ).mappings().all() if trips else []

    by_trip: dict[int, list[dict[str, Any]]] = {}
    for e in events:
        by_trip.setdefault(e["trip_id"], []).append(_event_out(e))
    return {
        "phone": phone,
        "role": role,
        "name": driver["name"] if driver else next((t["guest_name"] for t in trips if t["guest_name"]), None),
        "messages": [_out(m) for m in messages],
        "conversation": _out(convo) if convo else None,
        "trips": [{**_out(t), "events": by_trip.get(t["id"], [])} for t in trips],
    }


# ── dispatch board ───────────────────────────────────────────────────────────


@router.get("/trips")
def list_trips(scope: str = "today"):
    """scope=today: departing today (SAST); open: not finished, any date; all: everything."""
    Tr, D = hub_db.trips, hub_db.drivers
    stmt = select(
        Tr, D.c.name.label("driver_name"), D.c.phone.label("driver_phone"),
        D.c.plate.label("driver_plate"), D.c.vehicle.label("driver_vehicle"),
    ).select_from(Tr.outerjoin(D, Tr.c.driver_id == D.c.id))

    if scope == "today":
        # SAST is UTC+2 with no DST, so the owner's day is a fixed UTC window. The end is
        # exclusive: a trip at exactly midnight belongs to tomorrow.
        sast = now() + timedelta(hours=2)
        start = datetime(sast.year, sast.month, sast.day) - timedelta(hours=2)
        stmt = stmt.where(Tr.c.scheduled_at >= start, Tr.c.scheduled_at < start + timedelta(days=1))
    elif scope == "open":
        stmt = stmt.where(Tr.c.status.in_(OPEN_STATUSES))

    with hub_db.begin() as c:
        rs = c.execute(stmt.order_by(Tr.c.scheduled_at.desc()).limit(200)).mappings().all()
    by_card = _card_paid(r["id"] for r in rs if r["captured_at"])

    out = []
    for r in rs:
        row = dict(r)
        driver = {k: row.pop(f"driver_{k}") for k in ("name", "phone", "plate", "vehicle")}
        # A draft is a guest who abandoned the chat part-way: real, but not a booking.
        if row["status"] == "draft" and scope != "all":
            continue
        out.append({**_out(row), "paymentMethod": _payment_method(row["id"], row["captured_at"], by_card),
                    "driver": driver if driver["name"] else None})
    return out


def _card_paid(trip_ids: Any) -> set[int]:
    """Which of these paid trips were paid on the driver's card machine - the rest via Paystack."""
    ids = list(trip_ids)
    if not ids:
        return set()
    E = hub_db.trip_events
    with hub_db.begin() as c:
        return set(c.execute(select(E.c.trip_id).where(E.c.trip_id.in_(ids), E.c.event == T.CARD_PAID_EVENT)).scalars())


def _payment_method(trip_id: int, captured_at: Any, by_card: set[int]) -> Optional[str]:
    """How a paid trip was paid: "card" (the driver's card machine) or "paystack"."""
    if not captured_at:
        return None
    return "card" if trip_id in by_card else "paystack"


def _trip_or_404(trip_id: int) -> hub_db.Row:
    trip = T.get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Not found")
    return trip


@router.get("/trips/{trip_id}")
def get_trip(trip_id: int):
    trip = _trip_or_404(trip_id)
    events = T.events_for(trip.id)
    by_card = {trip.id} if any(e.event == T.CARD_PAID_EVENT for e in events) else set()
    return {**_out(trip), "paymentMethod": _payment_method(trip.id, trip.captured_at, by_card),
            "events": [_event_out(e) for e in events]}


@router.patch("/trips/{trip_id}")
def act_on_trip(trip_id: int, body: dict[str, Any] = Body(...)):
    """Manual intervention from the board, for what the chat cannot reach: a guest who
    phones instead of replying, a trip wedged because nobody tapped a button."""
    action = body.get("action")
    if action not in TRIP_ACTIONS:
        raise HTTPException(400, f"Unknown action. One of: {', '.join(TRIP_ACTIONS)}")
    trip = _trip_or_404(trip_id)

    if action == "allocate":
        driver_id = _number(body.get("driverId"))
        driver = T.get_driver(int(driver_id)) if driver_id.is_integer() else None
        if not driver:
            raise HTTPException(400, "Driver not found")
        # Same transition as Anneli's pick on WhatsApp: guest confirmed, driver briefed.
        T.allocate_driver(trip.id, driver.id, "board", reassign=bool(trip.driver_id))
    elif action == "cancel":
        T.cancel_trip(trip.id, "ops", body.get("reason") or "cancelled from the board")
    elif action == "complete":
        T.set_status(trip.id, "completed", completed_at=now())
        T.record(trip.id, "ops", "completed", "closed from the board")
    else:
        T.set_status(trip.id, "no_show")
        T.record(trip.id, "ops", "no_show", body.get("reason") or "marked from the board")

    return _out(T.get_trip(trip.id))


# ── day trip requests ────────────────────────────────────────────────────────


@router.get("/day-trips")
def day_trip_requests():
    """Guests who asked for a Day Trip in the chat (not offered yet - they were told "coming
    soon"): how many in all, and the latest, newest first - who asked, for what day and
    time, and where each request stands."""
    from sqlalchemy import func

    from app.db import SessionLocal  # kept in the service's own database (migrations/003)
    from app.models import DayTripRequest as D

    with SessionLocal() as db:
        count = db.scalar(select(func.count()).select_from(D))
        rows = db.scalars(select(D).order_by(D.created_at.desc()).limit(500)).all()
    return {"count": count, "requests": [{
        "id": r.id, "phone": r.phone_number, "guestName": r.guest_name, "requestType": r.request_type,
        "status": r.status, "requestedFor": _value(r.requested_for), "leaveNow": r.leave_now, "createdAt": _value(r.created_at),
    } for r in rows]}


# ── drivers ──────────────────────────────────────────────────────────────────


@router.get("/drivers")
def list_drivers():
    D = hub_db.drivers
    with hub_db.begin() as c:
        return [_out(r) for r in c.execute(select(D).order_by(D.c.name)).mappings()]


@router.post("/drivers")
def add_driver(body: dict[str, Any] = Body(...)):
    name, plate = _text(body.get("name")), _text(body.get("plate"))
    phone = normalise_phone(body.get("phone"))
    if not name:
        raise HTTPException(400, "Name is required")
    if not plate:
        raise HTTPException(400, "Registration is required")
    if not phone:
        raise HTTPException(400, "A valid WhatsApp number is required")

    D = hub_db.drivers
    values = {
        "name": name, "plate": plate, "phone": phone,
        "vehicle": _text(body.get("vehicle")) or None,
        "active": True if body.get("active") is None else bool(body["active"]),
        "on_duty": True if body.get("onDuty") is None else bool(body["onDuty"]),
    }
    try:
        with hub_db.begin() as c:
            return _out(c.execute(D.insert().values(**values).returning(D)).mappings().one())
    except IntegrityError:
        # phone is unique: two drivers on one number would make their replies ambiguous.
        raise HTTPException(409, "A driver with that number already exists")


@router.patch("/drivers/{driver_id}")
def edit_driver(driver_id: int, body: dict[str, Any] = Body(...)):
    patch: dict[str, Any] = {}
    for key in ("name", "plate"):
        if key in body:
            patch[key] = _text(body[key])
    if "vehicle" in body:
        patch["vehicle"] = _text(body["vehicle"]) or None
    if "active" in body:
        patch["active"] = bool(body["active"])
    if "onDuty" in body:
        patch["on_duty"] = bool(body["onDuty"])
    if "phone" in body:
        phone = normalise_phone(body["phone"])
        if not phone:
            raise HTTPException(400, "A valid WhatsApp number is required")
        patch["phone"] = phone

    D = hub_db.drivers
    try:
        with hub_db.begin() as c:
            if patch:
                r = c.execute(D.update().where(D.c.id == driver_id).values(**patch).returning(D)).mappings().first()
            else:
                r = c.execute(select(D).where(D.c.id == driver_id)).mappings().first()
    except IntegrityError:
        raise HTTPException(409, "A driver with that number already exists")
    if not r:
        raise HTTPException(404, "Not found")
    return _out(r)


@router.delete("/drivers/{driver_id}")
def remove_driver(driver_id: int):
    """Deactivates rather than deletes: trips reference the driver, and the history has to
    stay readable. A driver on a live trip has been named to the guest, so not them."""
    D, Tr = hub_db.drivers, hub_db.trips
    with hub_db.begin() as c:
        live = c.execute(
            select(Tr.c.ref).where(Tr.c.driver_id == driver_id, Tr.c.status.in_(LIVE_STATUSES))
        ).scalars().all()
        if live:
            raise HTTPException(
                409, f"Still on {len(live)} live trip(s): {', '.join(live)}. Set them off duty instead.")
        r = c.execute(
            D.update().where(D.c.id == driver_id).values(active=False, on_duty=False).returning(D)
        ).mappings().first()
    if not r:
        raise HTTPException(404, "Not found")
    return _out(r)


# ── destinations ─────────────────────────────────────────────────────────────


def clean_aliases(value: Any) -> Optional[str]:
    """Lowercased and de-duplicated: the matcher compares against lowercase guest text."""
    aliases = [a.strip().lower() for a in _text(value).split(",")]
    unique = list(dict.fromkeys(a for a in aliases if a))
    return ", ".join(unique) if unique else None


def _fixed_fare(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    fare = _number(value)
    if not math.isfinite(fare) or fare < 0:
        raise HTTPException(400, "Fixed fare must be a positive amount")
    return fare


def _coordinate(body: dict[str, Any], key: str) -> float:
    low, high = (-90, 90) if key == "lat" else (-180, 180)
    v = _number(body.get(key))
    if not math.isfinite(v) or v < low or v > high:
        raise HTTPException(400, f"{key} must be between {low} and {high}")
    return v


def _with_distance(r: Any) -> dict[str, Any]:
    # Derived from the coordinates on read, so moving the farm pin corrects every
    # destination at once. Google Routes answers are cached in places.py.
    return {**_out(r), **distance_from_farm(float(r["lat"]), float(r["lng"]))}


@router.get("/destinations")
def list_destinations():
    Ds = hub_db.destinations
    with hub_db.begin() as c:
        rs = c.execute(select(Ds).order_by(Ds.c.name)).mappings().all()
    return [_with_distance(r) for r in rs]


@router.post("/destinations")
def add_destination(body: dict[str, Any] = Body(...)):
    name = _text(body.get("name"))
    if not name:
        raise HTTPException(400, "Name is required")
    values = {
        "name": name,
        "aliases": clean_aliases(body.get("aliases")),
        "lat": _coordinate(body, "lat"),
        "lng": _coordinate(body, "lng"),
        "fixed_fare": _fixed_fare(body.get("fixedFare")),
        "active": True if body.get("active") is None else bool(body["active"]),
    }
    Ds = hub_db.destinations
    try:
        with hub_db.begin() as c:
            r = c.execute(Ds.insert().values(**values).returning(Ds)).mappings().one()
    except IntegrityError:
        raise HTTPException(409, "A destination with that name already exists")
    return _with_distance(r)


@router.patch("/destinations/{destination_id}")
def edit_destination(destination_id: int, body: dict[str, Any] = Body(...)):
    patch: dict[str, Any] = {}
    if "name" in body:
        patch["name"] = _text(body["name"])
    if "aliases" in body:
        patch["aliases"] = clean_aliases(body["aliases"])
    if "active" in body:
        patch["active"] = bool(body["active"])
    if "fixedFare" in body:
        patch["fixed_fare"] = _fixed_fare(body["fixedFare"])
    for key in ("lat", "lng"):
        if key in body:
            patch[key] = _coordinate(body, key)

    Ds = hub_db.destinations
    try:
        with hub_db.begin() as c:
            if patch:
                r = c.execute(Ds.update().where(Ds.c.id == destination_id).values(**patch).returning(Ds)).mappings().first()
            else:
                r = c.execute(select(Ds).where(Ds.c.id == destination_id)).mappings().first()
    except IntegrityError:
        raise HTTPException(409, "A destination with that name already exists")
    if not r:
        raise HTTPException(404, "Not found")
    return _with_distance(r)


@router.delete("/destinations/{destination_id}")
def remove_destination(destination_id: int):
    # Trips keep the place as text, not a reference, so no past trip is orphaned.
    Ds = hub_db.destinations
    with hub_db.begin() as c:
        r = c.execute(Ds.delete().where(Ds.c.id == destination_id).returning(Ds.c.id)).first()
    if not r:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ── rates & rules ────────────────────────────────────────────────────────────

MONEY = ("fareBase", "farePerKm", "fareMinimum", "noShowFee")
WHOLE = ("maxChatKm", "opsResponseMin", "noShowWaitMin", "holdBeforeMin", "driverNudgeMin", "maxLeadDays")
FLAGS = ("chargeNoShow", "muteOpsCommentary")
PHONES = ("opsWhatsapp", "opsEscalationWhatsapp")
HHMM = re.compile(r"([01]\d|2[0-3]):[0-5]\d")


def _settings_out() -> dict[str, Any]:
    return {_camel(k): v for k, v in asdict(load_settings()).items()}


@router.get("/transfer-settings")
def get_transfer_settings():
    return _settings_out()


@router.patch("/transfer-settings")
def edit_transfer_settings(body: dict[str, Any] = Body(...)):
    patch: dict[str, Any] = {}

    for key in MONEY:
        if key not in body:
            continue
        if body[key] is None or body[key] == "":
            patch[key] = None
            continue
        v = _number(body[key])
        if not math.isfinite(v) or v < 0:
            raise HTTPException(400, f"{key} must be a positive amount")
        patch[key] = v

    for key in WHOLE:
        if key not in body:
            continue
        v = _number(body[key])
        if not v.is_integer() or v < 0:
            raise HTTPException(400, f"{key} must be a whole number of minutes, km or days")
        patch[key] = int(v)

    for key in FLAGS:
        if key in body:
            patch[key] = bool(body[key])

    for key in PHONES:
        if key not in body:
            continue
        if not body[key]:
            patch[key] = None
            continue
        phone = normalise_phone(body[key])
        if not phone:
            raise HTTPException(400, f"{key} is not a valid number")
        patch[key] = phone

    if "opsPhone" in body:
        patch["opsPhone"] = _text(body["opsPhone"]) or None

    for key in ("serviceStart", "serviceEnd"):
        if key not in body:
            continue
        if not body[key]:
            patch[key] = None
            continue
        if not HHMM.fullmatch(str(body[key])):
            raise HTTPException(400, f"{key} must be HH:MM")
        patch[key] = str(body[key])

    # Charging a no-show with no fee set would take the full fare by accident.
    merged = {**_settings_out(), **patch}
    if merged["chargeNoShow"] and not merged["noShowFee"]:
        raise HTTPException(400, "Set a no-show fee before switching no-show charging on")

    S = hub_db.transfer_settings
    values = {_snake(k): v for k, v in patch.items()}
    with hub_db.begin() as c:
        # One row: created on the first save, updated after.
        existing = c.execute(select(S.c.id).order_by(S.c.id).limit(1)).scalar()
        if existing is None:
            c.execute(S.insert().values(**values))
        else:
            c.execute(S.update().where(S.c.id == existing).values(**values, updated_at=db_time(now())))
    return _settings_out()
