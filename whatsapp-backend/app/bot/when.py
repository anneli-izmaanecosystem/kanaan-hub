"""Turning "saturday 05:30" into an instant, and instants back into words.

Guests type departure times in whatever shape comes naturally, so this accepts the
handful of forms that actually turn up and returns None for everything else — the
conversation then asks again rather than guessing at a 05:30 airport run.

Instants are kept in UTC (the server's own timezone never enters into it) and turned into
South African time for reading and display, using the IANA zone Africa/Johannesburg. The
slim image has no system timezone database, so the zone comes from the tzdata package.
"""

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    SAST = ZoneInfo("Africa/Johannesburg")
except ZoneInfoNotFoundError:
    # tzdata missing from an install: keep the bot answering rather than failing to start.
    # South Africa has kept UTC+2 since 1944, so the times read the same either way.
    logging.getLogger("kanaan.bot.when").error("no timezone data for Africa/Johannesburg (install tzdata) - using UTC+2")
    SAST = timezone(timedelta(hours=2), "SAST")

MONTHS = ["january", "february", "march", "april", "may", "june",
          "july", "august", "september", "october", "november", "december"]
# Python counts Monday as 0; these are in that order.
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]
DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _sa(at: datetime) -> datetime:
    return at.astimezone(SAST)


def _from_sa(year: int, month: int, day: int, hour: int, minute: int) -> datetime:
    """The instant Johannesburg reads these fields. `day` may overflow the month."""
    base = datetime(year, month, 1, hour, minute, tzinfo=SAST)
    return (base + timedelta(days=day - 1)).astimezone(timezone.utc)


def _find_time(text: str) -> Optional[tuple[int, int]]:
    # 05:30, 5.30, 5h30 first; then "0530h" and "5 30". Also "5pm" / "5 pm". The colon
    # forms come first so "2026-10-01 07:15" reads as 07:15, not the "01 07" in the date.
    hm = (re.search(r"\b(\d{1,2})[:.h](\d{2})\b", text)
          or re.search(r"\b(\d{2})(\d{2})h\b", text)
          or re.search(r"\b(\d{1,2}) (\d{2})\b(?!\s*(?:" + "|".join(m[:3] for m in MONTHS) + "))", text))
    ampm = re.search(r"\b(\d{1,2})\s?(am|pm)\b", text)
    if hm:
        hour, minute = int(hm.group(1)), int(hm.group(2))
    elif ampm:
        hour, minute = int(ampm.group(1)), 0
    else:
        return None
    if re.search(r"pm\b", text) and hour < 12:
        hour += 12
    if re.search(r"am\b", text) and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return hour, minute


def parse_when(value: str, now: Optional[datetime] = None) -> Optional[datetime]:
    """A departure time, as an aware UTC datetime, or None.

    Ambiguity resolves forward: a time already passed today means tomorrow, and a weekday
    already passed this week means next week.
    """
    now = now or datetime.now(timezone.utc)
    text = value.lower().strip()
    if not text:
        return None

    # "now" — give the driver a few minutes rather than a time already in the past.
    if re.match(r"^(now|asap|right now|immediately)\b", text):
        return now + timedelta(minutes=15)

    t = _find_time(text)
    here = _sa(now)

    iso = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", text)
    if iso and t:
        return _from_sa(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)), *t)

    month_idx = next((i for i, m in enumerate(MONTHS) if m[:3] in text), -1)
    if month_idx >= 0 and t:
        day_match = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\b(?!\s?[:.h])", text)
        if day_match:
            month = month_idx + 1
            # A month earlier than the current one means next year.
            year = here.year + 1 if month < here.month else here.year
            return _from_sa(year, month, int(day_match.group(1)), *t)

    if not t:
        return None

    if "tomorrow" in text:
        return _from_sa(here.year, here.month, here.day + 1, *t)
    if "today" in text or "tonight" in text:
        return _from_sa(here.year, here.month, here.day, *t)

    day_idx = next((i for i, d in enumerate(DAYS) if d[:3] in text), -1)
    if day_idx >= 0:
        delta = (day_idx - here.weekday()) % 7
        candidate = _from_sa(here.year, here.month, here.day + delta, *t)
        if delta == 0 and candidate <= now:
            delta = 7
        return _from_sa(here.year, here.month, here.day + delta, *t)

    today_at = _from_sa(here.year, here.month, here.day, *t)
    return today_at if today_at > now else _from_sa(here.year, here.month, here.day + 1, *t)


# ── formatting (matches what guests were already sent) ──────────────────────


def format_when_long(at: datetime) -> str:
    """'Saturday, 12 September at 05:30'"""
    s = _sa(at)
    return f"{DAYS[s.weekday()].capitalize()}, {s.day} {MONTHS[s.month - 1].capitalize()} at {s:%H:%M}"


def format_when_short(at: datetime) -> str:
    """'Sat, 12 Sept, 05:30' — the compact form on the ops and driver cards."""
    s = _sa(at)
    return f"{DAY_SHORT[s.weekday()]}, {s.day} {MONTH_SHORT[s.month - 1]}, {s:%H:%M}"


def format_time(at: datetime) -> str:
    """'05:30'"""
    return f"{_sa(at):%H:%M}"


def format_day_name(at: datetime) -> str:
    """'Saturday'"""
    return DAYS[_sa(at).weekday()].capitalize()


def estimated_arrival(minutes: int, at: Optional[datetime] = None) -> datetime:
    """When a drive of `minutes` started at `at` (default: now) gets there, in South
    African time. Datetime arithmetic, so the hour, midnight and the date roll over."""
    start = at or datetime.now(timezone.utc)
    return _sa(start + timedelta(minutes=minutes))


def format_arrival(arrival: datetime, at: Optional[datetime] = None) -> str:
    """'14:50 South Africa time', or with the date when that is not today in South Africa:
    '00:15 on 4 October 2026 (South Africa time)'."""
    s = _sa(arrival)
    if s.date() == _sa(at or datetime.now(timezone.utc)).date():
        return f"{s:%H:%M} South Africa time"
    return f"{s:%H:%M} on {s.day} {MONTHS[s.month - 1].capitalize()} {s.year} (South Africa time)"


def format_duration(minutes: int) -> str:
    """'35 minutes', '1 hour 20 minutes', '2 hours'"""
    hours, mins = divmod(int(minutes), 60)
    parts = [f"{hours} hour{'' if hours == 1 else 's'}"] if hours else []
    if mins or not hours:
        parts.append(f"{mins} minute{'' if mins == 1 else 's'}")
    return " ".join(parts)


def sa_date(at: datetime) -> str:
    return _sa(at).strftime("%Y-%m-%d")


def sa_hour(at: datetime) -> int:
    return _sa(at).hour


def sa_hhmm(at: datetime) -> str:
    return f"{_sa(at):%H:%M}"


def iso_z(at: datetime) -> str:
    """'2026-09-12T03:30:00.000Z' — the form stored in drafts and button ids."""
    return at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{at.microsecond // 1000:03d}Z"


def from_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
