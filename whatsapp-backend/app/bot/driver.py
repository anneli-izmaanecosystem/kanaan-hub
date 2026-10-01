"""The driver's side. He only ever taps: Noted on the trip card, then I have left / I have
arrived / Ride started / Reached destination / Ride complete on the day. "Ride started" is
offered once, when the guest says "Yes, I can see him"; "Ride complete" only once the fare
is paid."""

from datetime import timedelta
from typing import Any

from sqlalchemy import select

from app.bot import hub_db, trip as T
from app.bot.hub_db import Row, now
from app.bot.reply import context_id, read_reply, said
from app.bot.settings_store import load_settings
from app.bot.wa import send_text, to_wa_id
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

    # A tap on a card of a trip that is already over (a second "Ride complete", a button on
    # an old card) - say so, rather than something that only fits a trip still going.
    finished = {"completed": "closed", "cancelled": "cancelled", "no_show": "closed as a no-show", "declined": "closed"}
    if trip.status in finished and not said(reply, B["noted"]):
        send_text(to, f"Trip {trip.ref} is already {finished[trip.status]}. Nothing more is needed from you. Thank you.")
        return

    status = trip.status.replace("_", " ", 1)

    if said(reply, B["noted"]):
        T.record(trip.id, "driver", "driver_acknowledged")
        send_text(to, f"Thank you. You will get a reminder {_reminder_wording(trip)}.")
        return

    # Handing a trip back from a card is no longer offered: kn_driver_new_trip_v2 has only
    # "Noted" and kn_driver_trip_reminder_v2 only "I have left". A tap on an older card is
    # pointed at Anneli, and the trip stands.
    if said(reply, B["cannot_take"], B["cannot_make"]):
        event = "cannot_take_tapped" if said(reply, B["cannot_take"]) else "cannot_make_tapped"
        T.record(trip.id, "driver", event, "option removed - told to call Anneli")
        send_text(to, f"Trip {trip.ref} is still yours. If you really cannot do it, please call Anneli on {load_settings().ops_phone}.")
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

    # The guest is in the car. The button comes once the guest can see the driver; typed, it
    # is also accepted for a guest who never tapped, and from "on my way" for a driver who
    # skipped "I have arrived".
    if reply.reply_id == T.RIDE_STARTED[0] or said(reply, B["ride_started"]):
        if trip.status == "in_progress":
            _ride_step(to, trip, f"Trip {trip.ref} has already started. ")
            return
        if trip.status not in ("driver_waiting", "driver_en_route"):
            send_text(to, f"Trip {trip.ref} is marked as {status} - tap I have left and I have arrived first.")
            return
        T.driver_started_ride(trip.id, driver)
        return

    # At the drop-off. "Arrived at drop" is the same step on cards sent before the rename.
    if reply.reply_id in (T.REACHED[0], "driver:at_drop") or said(reply, B["reached"], B["at_drop"]):
        if trip.status != "in_progress":
            _not_started(to, trip)
            return
        if T.reached_destination(trip):
            _complete_or_wait(to, trip)
            return
        T.driver_reached_destination(trip.id, driver)
        return

    if reply.reply_id == T.RIDE_COMPLETE[0] or said(reply, B["ride_complete"]):
        if trip.status != "in_progress":
            _not_started(to, trip)
            return
        if not T.ride_can_complete(trip):
            # Unpaid: the guest is asked to pay at the destination first.
            if T.reached_destination(trip):
                _complete_or_wait(to, trip)
            else:
                T.driver_reached_destination(trip.id, driver)
            return
        T.driver_completed_ride(trip.id, driver)
        return

    send_text(to, f"Use the buttons for trip {trip.ref}, or call Anneli if something is wrong.")


# The replies below say where a trip stands, in words only. Each of the driver's buttons is
# sent once, by the step that earns it (trip.py) - a double tap, or a tap out of order,
# never puts a second copy on his screen.


def _not_started(to: str, trip: Row) -> None:
    """A drop-off button before the ride has started."""
    if trip.status == "driver_waiting" and T.guest_saw_driver(trip):
        send_text(to, f"Trip {trip.ref} has not started yet. Tap Ride started above once the guest is in the car.")
    elif trip.status == "driver_waiting":
        send_text(to, f"Trip {trip.ref} has not started yet. Ride started will appear here once the guest confirms they can see you.")
    else:
        send_text(to, f"Trip {trip.ref} has not started yet.")


def _ride_step(to: str, trip: Row, started: str) -> None:
    """Where a ride under way stands: on the road, or at the drop-off."""
    if T.reached_destination(trip):
        _complete_or_wait(to, trip, started)
    else:
        send_text(to, f"{started}Tap Reached destination above when you arrive at {T.to_label(trip)}.")


def _complete_or_wait(to: str, trip: Row, started: str = "") -> None:
    """At the drop-off: Ride complete if the fare is paid, else why not yet."""
    if T.ride_can_complete(trip):
        send_text(to, f"{started}Tap Ride complete above once you have dropped the guest off.")
    else:
        send_text(to, f"{started}The guest has not paid the R {T.fare(trip)} fare yet - Ride complete will appear here "
                      "as soon as they do. If they cannot pay, please call Anneli.")


def _reminder_wording(trip: Row) -> str:
    """"shortly before 05:30 on Saturday" — when kn_driver_trip_reminder goes out."""
    at = trip.scheduled_at
    today = format_day_name(at) == format_day_name(now()) and at - now() < timedelta(days=1)
    return f"shortly before {format_time(at)}{'' if today else f' on {format_day_name(at)}'}"
