"""The tariff and policy numbers: the transfer_settings row the owner edits in the
dashboard, falling back per field to the env defaults in app/config.py."""

import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

from app.bot import hub_db
from app.bot.when import sa_hhmm
from app.config import get_settings


@dataclass
class TransferSettings:
    fare_base: float
    fare_per_km: float
    fare_minimum: float
    max_chat_km: int
    ops_response_min: int
    no_show_wait_min: int
    hold_before_min: int
    driver_nudge_min: int
    charge_no_show: bool
    no_show_fee: Optional[float]
    service_start: Optional[str]
    service_end: Optional[str]
    max_lead_days: int
    ops_whatsapp: str
    ops_phone: str
    ops_escalation_whatsapp: Optional[str]
    mute_ops_commentary: bool


def defaults() -> TransferSettings:
    s = get_settings()
    return TransferSettings(
        fare_base=s.kanaan_fare_base,
        fare_per_km=s.kanaan_fare_per_km,
        fare_minimum=s.kanaan_fare_minimum,
        max_chat_km=s.kanaan_max_chat_km,
        ops_response_min=s.kanaan_ops_response_min,
        no_show_wait_min=s.kanaan_no_show_wait_min,
        hold_before_min=s.kanaan_hold_before_min,
        driver_nudge_min=s.kanaan_driver_nudge_before_min,
        charge_no_show=False,
        no_show_fee=None,
        service_start=None,
        service_end=None,
        max_lead_days=60,
        ops_whatsapp=s.kanaan_ops_whatsapp,
        ops_phone=s.kanaan_ops_phone,
        ops_escalation_whatsapp=None,
        mute_ops_commentary=False,
    )


def load_settings() -> TransferSettings:
    d = defaults()
    with hub_db.begin() as c:
        r = hub_db.one(c, select(hub_db.transfer_settings).order_by(hub_db.transfer_settings.c.id).limit(1))
    if not r:
        return d

    def num(v, fallback):
        return fallback if v is None else float(v)

    def pick(v, fallback):
        return fallback if v is None else v

    return TransferSettings(
        fare_base=num(r.fare_base, d.fare_base),
        fare_per_km=num(r.fare_per_km, d.fare_per_km),
        fare_minimum=num(r.fare_minimum, d.fare_minimum),
        max_chat_km=pick(r.max_chat_km, d.max_chat_km),
        ops_response_min=pick(r.ops_response_min, d.ops_response_min),
        no_show_wait_min=pick(r.no_show_wait_min, d.no_show_wait_min),
        hold_before_min=pick(r.hold_before_min, d.hold_before_min),
        driver_nudge_min=pick(r.driver_nudge_min, d.driver_nudge_min),
        charge_no_show=pick(r.charge_no_show, d.charge_no_show),
        no_show_fee=None if r.no_show_fee is None else float(r.no_show_fee),
        service_start=r.service_start,
        service_end=r.service_end,
        max_lead_days=pick(r.max_lead_days, d.max_lead_days),
        ops_whatsapp=r.ops_whatsapp or d.ops_whatsapp,
        ops_phone=r.ops_phone or d.ops_phone,
        ops_escalation_whatsapp=r.ops_escalation_whatsapp,
        mute_ops_commentary=pick(r.mute_ops_commentary, d.mute_ops_commentary),
    )


def js_round(x: float) -> int:
    """Half up, like the Math.round the fares were quoted with — not Python's half-even."""
    return math.floor(x + 0.5)


def fare_for(distance_km: float, s: TransferSettings, fixed_fare: Optional[float] = None) -> float:
    """The upfront fare in rand: base + per km, never below the minimum, rounded to the
    whole rand. Quoted before booking and locked on the trip. A fixed price for the place
    (backend or dashboard) wins over the formula."""
    if fixed_fare is not None:
        return float(fixed_fare)
    return float(max(s.fare_minimum, js_round(s.fare_base + s.fare_per_km * distance_km)))


def fixed_fares() -> dict[str, float]:
    """KANAAN_FIXED_FARES as {place key: rand}. Malformed entries are skipped, not fatal."""
    out: dict[str, float] = {}
    for part in get_settings().kanaan_fixed_fares.split(","):
        key, _, value = part.partition("=")
        try:
            if key.strip() and float(value) > 0:
                out[key.strip().lower()] = float(value)
        except ValueError:
            continue
    return out


def booking_window_error(at: datetime, s: TransferSettings) -> Optional[str]:
    """Why a departure is outside the lead time or service hours, or None."""
    lead_days = (at - datetime.now(timezone.utc)).total_seconds() / 86_400
    if lead_days > s.max_lead_days:
        return f"We only take bookings up to {s.max_lead_days} days ahead."
    if not s.service_start or not s.service_end:
        return None
    hhmm = sa_hhmm(at)
    if hhmm < s.service_start or hhmm > s.service_end:
        return f"We run cars between {s.service_start} and {s.service_end}. For anything outside that, please call {s.ops_phone}."
    return None
