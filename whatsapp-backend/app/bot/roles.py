"""Which side of the conversation a number is on, and when a guest opts in."""

import re
from typing import Literal

from sqlalchemy import select

from app.bot import hub_db
from app.bot.settings_store import load_settings

Role = Literal["guest", "ops", "driver"]


def to_e164(phone: str) -> str:
    return phone if phone.startswith("+") else f"+{phone}"


def role_for(phone: str) -> Role:
    """Anneli's number is ops, a registered driver is a driver, anyone else is a guest."""
    e164 = to_e164(phone)
    ops = load_settings().ops_whatsapp
    if ops and e164 == to_e164(ops):
        return "ops"
    with hub_db.begin() as c:
        driver = hub_db.one(c, select(hub_db.drivers.c.id).where(hub_db.drivers.c.phone == e164))
    return "driver" if driver else "guest"


# "nii" is the printed keyword on the room cards; the greetings are what guests type
# anyway. Exact matches only, so a message that merely contains one of these words does
# not reset a booking already under way.
START_WORDS = {"nii", "hi", "hello", "hey", "hallo", "start", "book", "book a car", "car", "taxi"}


def is_start_keyword(text: str) -> bool:
    return re.sub(r"[!.?]+$", "", text.strip().lower()) in START_WORDS
