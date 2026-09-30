"""The WhatsApp Flow behind "Pick a day and time": a calendar, an hour and a minute, and a
confirm screen, all inside WhatsApp.

The flow has no endpoint (nothing for Meta to call back mid-flow), so everything dynamic —
the first and last bookable dates and the hours on offer — is handed to it in the message
that opens it (`opening_data`). When the guest confirms, WhatsApp sends the answer back to
the webhook as an `nfm_reply` whose response_json carries
{"date": "YYYY-MM-DD", "hour": "HH", "minute": "MM"}.

The flow is registered on the WABA with scripts/sync_booking_flow.py, which prints the id
to set as KANAAN_DATETIME_FLOW_ID. A published flow cannot change, so editing this file
means publishing a new version and switching the id over.
"""

import json
from datetime import datetime, timedelta
from typing import Any, Optional

from app.bot.settings_store import TransferSettings
from app.bot.when import SAST

FLOW_NAME = "kanaan_pickup_datetime"
FLOW_TOKEN_PREFIX = "pickup-datetime"
FIRST_SCREEN = "DATE"
MINUTE_STEP = 5


def _options(example: list[str]) -> dict[str, Any]:
    return {
        "type": "array",
        "items": {"type": "object", "properties": {"id": {"type": "string"}, "title": {"type": "string"}}},
        "__example__": [{"id": v, "title": v} for v in example],
    }


def flow_json() -> dict[str, Any]:
    hours, minutes = _options(["05", "06"]), _options(["00", "05"])
    date_example = {"type": "string", "__example__": "2026-09-30"}
    two_digits = {"type": "string", "__example__": "05"}
    return {
        "version": "7.1",
        "screens": [
            {
                "id": "DATE",
                "title": "Pick-up date",
                "data": {"min_date": date_example, "max_date": {"type": "string", "__example__": "2026-11-28"},
                         "hours": hours, "minutes": minutes},
                "layout": {
                    "type": "SingleColumnLayout",
                    "children": [
                        {"type": "TextSubheading", "text": "When should the driver collect you?"},
                        {
                            "type": "CalendarPicker",
                            "name": "date",
                            "label": "Pick-up date",
                            "mode": "single",
                            "min-date": "${data.min_date}",
                            "max-date": "${data.max_date}",
                            "required": True,
                        },
                        {
                            "type": "Footer",
                            "label": "Continue",
                            "on-click-action": {
                                "name": "navigate",
                                "next": {"type": "screen", "name": "TIME"},
                                "payload": {"date": "${form.date}", "hours": "${data.hours}", "minutes": "${data.minutes}"},
                            },
                        },
                    ],
                },
            },
            {
                "id": "TIME",
                "title": "Pick-up time",
                "data": {"date": date_example, "hours": hours, "minutes": minutes},
                "layout": {
                    "type": "SingleColumnLayout",
                    "children": [
                        {"type": "TextSubheading", "text": "${data.date}"},
                        {"type": "TextBody", "text": "Choose the hour and the minutes (South African time, 24-hour clock)."},
                        {"type": "Dropdown", "name": "hour", "label": "Hour", "data-source": "${data.hours}", "required": True},
                        {"type": "Dropdown", "name": "minute", "label": "Minutes", "data-source": "${data.minutes}", "required": True},
                        {
                            "type": "Footer",
                            "label": "Continue",
                            "on-click-action": {
                                "name": "navigate",
                                "next": {"type": "screen", "name": "CONFIRM"},
                                "payload": {"date": "${data.date}", "hour": "${form.hour}", "minute": "${form.minute}"},
                            },
                        },
                    ],
                },
            },
            {
                "id": "CONFIRM",
                "title": "Confirm pick-up",
                "terminal": True,
                "success": True,
                "data": {"date": date_example, "hour": two_digits, "minute": {"type": "string", "__example__": "30"}},
                "layout": {
                    "type": "SingleColumnLayout",
                    "children": [
                        {"type": "TextCaption", "text": "Date"},
                        {"type": "TextHeading", "text": "${data.date}"},
                        {"type": "TextCaption", "text": "Time"},
                        {"type": "TextHeading", "text": "`${data.hour} ':' ${data.minute}`"},
                        {"type": "TextBody", "text": "Next, we will ask where the driver should collect you. Nothing is booked until Anneli confirms."},
                        {
                            "type": "Footer",
                            "label": "Confirm",
                            "on-click-action": {
                                "name": "complete",
                                "payload": {"date": "${data.date}", "hour": "${data.hour}", "minute": "${data.minute}"},
                            },
                        },
                    ],
                },
            },
        ],
    }


def hour_options(s: TransferSettings) -> list[dict[str, str]]:
    """The hours within the service window; without one, 05 to 20."""
    first = int((s.service_start or "05:00")[:2])
    last = int((s.service_end or "20:00")[:2])
    return [{"id": f"{h:02d}", "title": f"{h:02d}"} for h in range(first, last + 1)]


def minute_options() -> list[dict[str, str]]:
    return [{"id": f"{m:02d}", "title": f"{m:02d}"} for m in range(0, 60, MINUTE_STEP)]


def opening_data(s: TransferSettings, now: datetime) -> dict[str, Any]:
    today = now.astimezone(SAST).date()
    return {
        "min_date": today.isoformat(),
        "max_date": (today + timedelta(days=s.max_lead_days)).isoformat(),
        "hours": hour_options(s),
        "minutes": minute_options(),
    }


def flow_token(phone: str) -> str:
    return f"{FLOW_TOKEN_PREFIX}:{phone}"


def read_flow_reply(message: dict[str, Any]) -> Optional[dict[str, Any]]:
    """The payload of a completed flow (nfm_reply), or None if this is not one."""
    interactive = message.get("interactive") or {}
    if message.get("type") != "interactive" or interactive.get("type") != "nfm_reply":
        return None
    raw = (interactive.get("nfm_reply") or {}).get("response_json") or "{}"
    try:
        data = json.loads(raw)
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def picked_datetime(data: dict[str, Any]) -> Optional[datetime]:
    """The instant a completed date/time flow means (SAST), or None if malformed. Takes
    hour + minute (this version) or a single "HH:MM" time (the first published version,
    which a guest may still have open)."""
    try:
        day = datetime.strptime(str(data["date"])[:10], "%Y-%m-%d")
        if "hour" in data:
            hh, mm = int(data["hour"]), int(data.get("minute") or 0)
        else:
            hh, mm = (int(x) for x in str(data["time"]).split(":")[:2])
        if not (0 <= hh <= 23 and 0 <= mm <= 59):
            return None
        return day.replace(hour=hh, minute=mm, tzinfo=SAST)
    except (KeyError, ValueError, TypeError):
        return None
