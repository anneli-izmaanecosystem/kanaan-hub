"""The pickup check: a 6-digit code (OTP) the guest reads out and the driver types in, so a
ride only starts with the guest who booked it.

When the guest taps "Yes, I can see him", that guest - and only that guest - is sent a code
for that trip. The driver types it into his chat; it is checked against his own trip, and
only a match moves on to what "Yes, I can see him" used to do at once: the driver's "Ride
started" button (trip.py does the messaging).

Nothing new in the database: each step is a trip_events row, like the rest of the pickup
(driver_arrived, guest_confirmed_pickup), and steps that read and then write take turns
under trip.trip_lock. The code itself is never stored or logged - only an HMAC of it, keyed
by a server secret and bound to the trip, so a copy of the database cannot be searched for
it and a code sent for one trip never matches another.
"""

import hashlib
import hmac
import json
import logging
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from app.bot.hub_db import Row, now
from app.bot.when import from_iso, iso_z
from app.config import get_settings

log = logging.getLogger("kanaan.bot.pickup_code")

CODE_LIFE = timedelta(minutes=10)
MAX_TRIES = 5                     # wrong codes before a code is used up
MAX_CODES = 3                     # codes per trip, so they cannot be had without end
DOUBLE_TAP = timedelta(seconds=60)  # a repeat "Yes" sooner than this changes nothing

# trip_events.event names
SENT = "pickup_code_sent"         # detail: {"salt", "hmac", "expires"} - never the code
WRONG = "pickup_code_wrong"
LOCKED = "pickup_code_locked"
EXPIRED = "pickup_code_expired"
VERIFIED = "pickup_verified"

_fallback_key: Optional[bytes] = None


@dataclass
class Check:
    """Where a trip's pickup check stands, read from its events."""
    codes: int = 0                          # codes sent for the trip
    stored: Optional[dict[str, Any]] = None  # the latest code's salt and HMAC
    sent_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    tries: int = 0                          # wrong tries at the latest code
    locked: bool = False                    # the latest code is used up
    verified: bool = False

    def live(self, at: datetime) -> bool:
        """A code the driver can still enter."""
        return bool(self.stored) and not self.verified and not self.locked and at < self.expires_at

    @property
    def can_send(self) -> bool:
        return self.codes < MAX_CODES


def check(events: list[Row]) -> Check:
    """`events` oldest first, as trip.events_for returns them."""
    c = Check()
    for e in events:
        if e.event == SENT:
            data = json.loads(e.detail or "{}")
            c.codes += 1
            c.stored = data
            c.sent_at = e.at.replace(tzinfo=timezone.utc) if e.at.tzinfo is None else e.at
            c.expires_at = from_iso(data["expires"])
            c.tries, c.locked = 0, False
        elif e.event == WRONG:
            c.tries += 1
        elif e.event == LOCKED:
            c.locked = True
        elif e.event == VERIFIED:
            c.verified = True
    return c


def new_code(trip_id: int) -> tuple[str, str, datetime]:
    """(the code - for the guest's message only, the event detail to record, its expiry).
    Six digits from the operating system's secure random source: nothing about the trip,
    the guest or the time goes into it."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    salt = secrets.token_hex(8)
    expires = now() + CODE_LIFE
    detail = json.dumps({"salt": salt, "hmac": _digest(trip_id, salt, code), "expires": iso_z(expires)})
    return code, detail, expires


def matches(trip_id: int, stored: dict[str, Any], typed: str) -> bool:
    return hmac.compare_digest(str(stored.get("hmac", "")), _digest(trip_id, str(stored.get("salt", "")), typed))


def read_code(text: str) -> Optional[str]:
    """The six digits a driver typed - "482731", "482 731" or "482-731" - else None."""
    digits = re.sub(r"[\s-]", "", text or "")
    return digits if re.fullmatch(r"\d{6}", digits) else None


def _digest(trip_id: int, salt: str, code: str) -> str:
    return hmac.new(_key(), f"{trip_id}:{salt}:{code}".encode(), hashlib.sha256).hexdigest()


def _key() -> bytes:
    """Derived from a secret the service already holds, so nothing new has to be set up."""
    s = get_settings()
    secret = s.internal_mirror_secret or s.whatsapp_app_secret
    if secret:
        return hmac.new(secret.encode(), b"kanaan pickup code", hashlib.sha256).digest()
    global _fallback_key
    if _fallback_key is None:
        log.error("no INTERNAL_MIRROR_SECRET or WHATSAPP_APP_SECRET: pickup codes will not survive a restart")
        _fallback_key = secrets.token_bytes(32)
    return _fallback_key
