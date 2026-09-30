"""The driver's side. He only ever taps: Noted on the trip card, then I have left (or I
cannot make it) / I have arrived / Ride started / Ride complete on the day. The ride
starts on his "Ride started" or the guest's "Yes, I can see him", whichever comes first."""

from datetime import timedelta
from typing import Any

from sqlalchemy import select

from app.bot import hub_db, trip as T
from app.bot.hub_db import Row, now
from app.bot.reply import context_id, read_reply, said
from app.bot.settings_store import load_settings
from app.bot.wa import send_buttons, send_text, to_wa_id
from app.bot.when import format_day_name, format_time

B = T.DRIVER_BTN


def handle_driver_message(phone: str, message: dict[str, Any]) -> None:
    to = to_wa_id(phone)
    reply = read_reply(message)
    with hub_db.begin() as c:
        driver = hub_db.one(c, select(hub_db.drivers).where(hub_db.drivers.c.phone == phone))
    if not driver:
        return

    trip = T.trip_for_reply(phone, "driver", context_id(message))
    if not trip:
        send_text(to, "You have no trip on the go right now. Anneli will send the next one here.")
        return
    if trip.driver_id != driver.id:
        send_text(to, f"Trip {trip.ref} has been reassigned - nothing needed from you.")
        return

    status = trip.status.replace("_", " ", 1)

    if said(reply, B["noted"]):
        T.record(trip.id, "driver", "driver_acknowledged")
        send_text(to, f"Thank you. You will get a reminder {_reminder_wording(trip)}.")
        return

    # Handing a new trip back from its card is no longer offered (kn_driver_new_trip_v2 has
    # only "Noted"); a tap on an older card is pointed at Anneli, and the trip stands.
    if said(reply, B["cannot_take"]):
        T.record(trip.id, "driver", "cannot_take_tapped", "option removed - told to call Anneli")
        send_text(to, f"Trip {trip.ref} is still yours. If you really cannot do it, please call Anneli on {load_settings().ops_phone}.")
        return

    # "I cannot make it" on the morning reminder still hands the trip back to Anneli.
    if said(reply, B["cannot_make"]):
        if trip.status != "allocated":
            send_text(to, f"Trip {trip.ref} is already under way - please call Anneli.")
            return
        T.driver_declined(trip.id, driver)
        return

    if said(reply, B["left"]):
        if trip.status != "allocated":
            send_text(to, f"Trip {trip.ref} is already marked as {status}.")
            return
        T.driver_left(trip.id, driver)
        return

    if reply.reply_id == "driver:arrived" or said(reply, B["arrived"]):
        if trip.status not in ("driver_en_route", "allocated"):
            send_text(to, f"Trip {trip.ref} is already marked as {status}.")
            return
        T.driver_arrived(trip.id, driver)
        return

    # The guest is in the car. Also accepted from "on my way", for a driver who skipped
    # "I have arrived".
    if reply.reply_id == "driver:started" or said(reply, B["ride_started"]):
        if trip.status == "in_progress":
            send_buttons(to, f"Trip {trip.ref} has already started. Tap below once you have dropped the guest off.",
                         [("driver:complete", B["ride_complete"])], trip.id)
            return
        if trip.status not in ("driver_waiting", "driver_en_route"):
            send_text(to, f"Trip {trip.ref} is marked as {status} - tap I have left and I have arrived first.")
            return
        T.driver_started_ride(trip.id, driver)
        return

    # "Arrived at drop" is the same action on cards sent before the button was renamed.
    if reply.reply_id in ("driver:complete", "driver:at_drop") or said(reply, B["ride_complete"], B["at_drop"]):
        if trip.status != "in_progress":
            send_text(to, "The guest has not confirmed the pickup yet, so the trip has not started.")
            return
        T.driver_completed_ride(trip.id, driver)
        return

    send_text(to, f"Use the buttons for trip {trip.ref}, or call Anneli if something is wrong.")


def _reminder_wording(trip: Row) -> str:
    """"shortly before 05:30 on Saturday" — when kn_driver_trip_reminder goes out."""
    at = trip.scheduled_at
    today = format_day_name(at) == format_day_name(now()) and at - now() < timedelta(days=1)
    return f"shortly before {format_time(at)}{'' if today else f' on {format_day_name(at)}'}"
