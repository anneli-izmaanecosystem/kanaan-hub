"""Test scenarios you can watch: each one plays a booking through the three simulator
phones at a readable pace and checks what each person sees. Every check is tagged with
the correction(s) it proves (corrections.json), so the tracker shows live which of the
user's corrections are verified.

Runs in a background thread inside the simulator; the page polls /sim/scenarios/status.
"""

import json
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

from sqlalchemy import text

from app.bot import hub_db, trip as T

HERE = Path(__file__).parent
PACE = 0.9  # seconds between taps, so the chat can be followed live

state: dict[str, Any] = {"running": False, "current": None, "results": [], "finished_at": None}
_run_lock = threading.Lock()


def corrections() -> list[dict[str, Any]]:
    return json.loads((HERE / "corrections.json").read_text(encoding="utf-8"))


# ── driving the phones ───────────────────────────────────────────────────────


def _sim():
    import app.sim as sim  # late: app.sim imports this module
    return sim


def _mark() -> int:
    return len(_sim()._log)


def _since(i: int) -> list[dict[str, Any]]:
    with _sim()._lock:
        return list(_sim()._log[i:])


def _out(ms: list[dict[str, Any]], role: str, pred: Callable[[dict[str, Any]], bool] = lambda m: True) -> Optional[dict[str, Any]]:
    xs = [m for m in ms if m["dir"] == "out" and m["role"] == role and pred(m)]
    return xs[-1] if xs else None


def _do(role: str, pause: bool = True, **kw) -> list[dict[str, Any]]:
    if pause:
        time.sleep(PACE)
    i = _mark()
    sim = _sim()
    sim.send(sim.Send(role=role, **kw))
    return _since(i)


def _pay(ms: list[dict[str, Any]], outcome: str) -> list[dict[str, Any]]:
    link = _out(ms, "guest", lambda m: m.get("cta"))
    time.sleep(PACE)
    i = _mark()
    _sim().pay(link["cta"]["url"].rsplit("/", 1)[1], outcome)
    return _since(i)


def _ids(m: Optional[dict[str, Any]]) -> list[str]:
    return [b["id"] for b in (m or {}).get("buttons", [])]


def _rows(m: Optional[dict[str, Any]]) -> list[str]:
    return [r["id"] for r in ((m or {}).get("list") or {}).get("rows", [])]


def _check(name: str, ok: bool, ids: list[str]) -> None:
    state["results"].append({"scenario": state["current"], "check": name, "ok": bool(ok), "corrections": ids})


def _latest_trip() -> Any:
    with hub_db.begin() as c:
        return c.execute(text("select * from trips order by id desc limit 1")).mappings().first()


def _close_leftovers() -> None:
    """Quietly ends any trip a previous run left open, so each scenario starts clean."""
    with hub_db.begin() as c:
        c.execute(text("update trips set status = 'cancelled' where status in "
                       "('draft','requested','allocated','driver_en_route','driver_waiting','in_progress')"))


def _book(to_id: str, to_title: str, frm_id: str = "from:farm", frm_title: str = "Kanaan Guest Farm",
          name: str = "Sam Botha") -> list[dict[str, Any]]:
    """Guest: hi -> Book a car -> Now -> pickup -> drop-off -> Yes -> name. Returns all messages."""
    log: list[dict[str, Any]] = []
    ms = _do("guest", kind="text", text="hi"); log += ms
    ms = _do("guest", kind="button", id="book", title="Book a car", context=_out(ms, "guest")["wamid"]); log += ms
    ms = _do("guest", kind="button", id="when:now", title="Now", context=_out(ms, "guest")["wamid"]); log += ms
    ms = _do("guest", kind="list", id=frm_id, title=frm_title, context=_out(ms, "guest", lambda m: m.get("list"))["wamid"]); log += ms
    ms = _do("guest", kind="list", id=to_id, title=to_title, context=_out(ms, "guest", lambda m: m.get("list"))["wamid"]); log += ms
    ms = _do("guest", kind="button", id="place:yes", title="Yes, that one", context=_out(ms, "guest", lambda m: m["buttons"])["wamid"]); log += ms
    ms = _do("guest", kind="text", text=name); log += ms
    return log


def _accept(ms: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Guest sends the request, Anneli accepts and picks the driver."""
    log: list[dict[str, Any]] = []
    ms = _do("guest", kind="button", id="quote:confirm", title="Send request", context=_out(ms, "guest", lambda m: m["buttons"])["wamid"]); log += ms
    card = _out(ms, "ops", lambda m: m.get("template"))
    ms = _do("ops", kind="template", title="Accept", context=card["wamid"]); log += ms
    ms = _do("ops", kind="list", id="driver:1", title="Test Driver - MP 1166", context=_out(ms, "ops", lambda m: m.get("list"))["wamid"]); log += ms
    return log


def _no_duplicates(log: list[dict[str, Any]]) -> bool:
    return not any("DUPLICATE" in (m.get("warn") or "") for m in log)


# ── the scenarios ────────────────────────────────────────────────────────────


def s_farm_pay_now() -> None:
    """Farm -> Perry's Bridge, pay now after acceptance, full ride and review."""
    log = _book("to:preset:perrys", "Perry's Bridge")
    pickup_q = next(m for m in log if m["dir"] == "out" and "Where should the driver collect you?" in m["text"])
    _check("Pickup is a dropdown with Kanaan, Perry's Bridge, Lowveld Mall (Engen), the airport, my location, somewhere else",
           _rows(pickup_q) == ["from:farm", "from:preset:perrys", "from:preset:lowveld", "from:preset:airport", "from:location", "from:other"],
           ["C10"])
    dest_q = next(m for m in log if m["dir"] == "out" and "Where are you going?" in m["text"])
    _check("Drop-off is the same dropdown (without the pickup)", "to:preset:perrys" in _rows(dest_q) and "to:farm" not in _rows(dest_q), ["C15", "C10"])
    _check("Choosing Perry's Bridge shares its map pin", any(m["kind"] == "location" and "Perry's Bridge" in m["text"] for m in log), ["C10"])
    quote = _out(log, "guest", lambda m: "Please confirm" in m["text"])
    _check("Quote shows Name and Phone", "Name: Sam Botha" in quote["text"] and "Phone: +27 00 000 0003" in quote["text"], ["C12"])
    _check("Quote wording: 'We are checking driver availability ... No payment is required until your car is confirmed.'",
           "We are checking driver availability and will confirm your booking as soon as possible. No payment is required until your car is confirmed."
           in quote["text"], ["C09"])
    _check("Fare R 20 (1.5 km, R5 + R8.30/km, minimum R20)", "Fare: R 20" in quote["text"], ["C13"])
    _check("No payment button before the request is accepted", not any(i.startswith("guest:pay") for m in log for i in _ids(m)), ["C01"])
    ms = _accept(log); log += ms
    confirmed = _out(ms, "guest", lambda m: (m.get("template") or "").startswith("kn_guest_trip_confirmed"))
    offer = _out(ms, "guest", lambda m: "guest:pay:now" in _ids(m))
    _check("Payment is offered only after Anneli accepts", offer is not None, ["C01"])
    _check("'Your car is confirmed' comes first, then the fare with only 'Pay now' (no 'Pay during ride')",
           bool(confirmed and offer and ms.index(confirmed) < ms.index(offer) and _ids(offer) == ["guest:pay:now"]), ["C29"])
    _check("The confirmation has no cancel button (kn_guest_trip_confirmed_v4)",
           bool(confirmed and confirmed["template"] == "kn_guest_trip_confirmed_v4" and not confirmed["buttons"]), ["C28"])
    after_confirmed = ms[ms.index(confirmed):] if confirmed else ms
    _check("No cancel button anywhere on the guest's screen once the car is confirmed",
           not any("cancel" in b["title"].lower() for m in after_confirmed if m["role"] == "guest" for b in m["buttons"]), ["C28"])
    card = _out(ms, "driver", lambda m: (m.get("template") or "").startswith("kn_driver_new_trip"))
    _check("Driver's new-trip card has only 'Noted' (no 'I cannot take it')",
           card and card["template"] == "kn_driver_new_trip_v2" and [b["title"] for b in card["buttons"]] == ["Noted"], ["C04"])
    _check("Driver's new-trip card shows the guest's full name and phone number",
           bool(card and "Guest: Sam Botha - +27 00 000 0003" in card["text"]), ["C25"])
    pins = [m for m in ms if m["role"] == "driver" and m["kind"] == "location"]
    _check("After the new-trip card, only the guest's pickup point is shown (Kanaan Guest Farm), not the drop-off",
           bool(card and len(pins) == 1 and "Pickup: Kanaan Guest Farm" in pins[0]["text"] and ms.index(card) < ms.index(pins[0])), ["C26"])
    reminder = _out(ms, "driver", lambda m: (m.get("template") or "").startswith("kn_driver_trip_reminder"))
    _check("Driver's 'I have left' card has no 'I cannot make it' button",
           bool(reminder and [b["title"] for b in reminder["buttons"]] == ["I have left"]), ["C27"])
    ms = _do("guest", kind="text", text="cancel"); log += ms
    _check("Typing 'cancel' once confirmed: turned down (call Anneli), Anneli told, the trip stands",
           bool(_out(ms, "guest", lambda m: "can no longer be cancelled" in m["text"]) and _out(ms, "ops", lambda m: "asked to cancel" in m["text"])
                and _latest_trip()["status"] == "allocated"), ["C28"])
    ms = _do("guest", kind="button", id="guest:pay:now", title="Pay now", context=offer["wamid"]); log += ms
    ms = _pay(ms, "success"); log += ms
    _check("Paid: guest, driver and Anneli are each told",
           _out(ms, "guest", lambda m: "Payment of R 20 received" in m["text"]) and _out(ms, "driver", lambda m: "has paid" in m["text"])
           and _out(ms, "ops", lambda m: "paid by card" in m["text"]), ["C06"])
    ms = _do("driver", kind="template", title="I have left"); log += ms
    ms = _do("driver", kind="button", id="driver:arrived", title="I have arrived", context=_out(ms, "driver", lambda m: m["buttons"])["wamid"]); log += ms
    arrived = _out(ms, "guest", lambda m: m.get("template"))
    _check("'I have arrived': the guest is asked 'Can you see him?' and the driver gets no 'Ride started' yet",
           bool(arrived and arrived["template"] == "kn_guest_driver_arrived")
           and not any("driver:started" in _ids(m) for m in ms if m["role"] == "driver"), ["C30"])
    ms = _do("guest", kind="template", title="Yes, I can see him", context=arrived["wamid"]); log += ms
    _check("'Yes, I can see him' does not start the ride; the driver gets 'Ride started'",
           _latest_trip()["status"] == "driver_waiting" and _ids(_out(ms, "driver", lambda m: m["buttons"])) == ["driver:started"], ["C17", "C07"])
    _check("'Ride started' reaches the driver once in the whole trip",
           sum(1 for m in log if m["role"] == "driver" and "driver:started" in _ids(m)) == 1, ["C30", "C14"])
    ms = _do("driver", kind="button", id="driver:started", title="Ride started", context=_out(ms, "driver", lambda m: m["buttons"])["wamid"]); log += ms
    _check("Driver's 'Ride started': guest is told the ride started", _out(ms, "guest", lambda m: m.get("template") == "kn_guest_ride_started"), ["C07"])
    _check("After 'Ride started' the driver gets 'Reached destination' (not 'Ride complete')",
           _ids(_out(ms, "driver", lambda m: m["buttons"])) == ["driver:reached"], ["C31"])
    _check("The drop-off pin comes with 'Ride started', for directions",
           _out(ms, "driver", lambda m: m["kind"] == "location" and "Drop-off: Perry's Bridge" in m["text"]) is not None, ["C26"])
    ms = _do("driver", kind="button", id="driver:reached", title="Reached destination", context=_out(ms, "driver", lambda m: m["buttons"])["wamid"]); log += ms
    _check("Already paid: no 'Pay now' for the guest at the destination; the driver gets 'Ride complete'",
           not _out(ms, "guest", lambda m: m.get("cta")) and _ids(_out(ms, "driver", lambda m: m["buttons"])) == ["driver:complete"], ["C31", "C18"])
    ms = _do("driver", kind="button", id="driver:complete", title="Ride complete", context=_out(ms, "driver", lambda m: m["buttons"])["wamid"]); log += ms
    review = _out(ms, "guest", lambda m: m.get("list"))
    _check("Paid, so the 1-5 star review comes at ride complete", review and len(_rows(review)) == 5, ["C05"])
    on_way = next((m for m in log if m.get("template") == "kn_guest_driver_on_way_v2"), None)
    closed = _out(ms, "ops", lambda m: m.get("template") == "kn_ops_trip_closed_v3")
    _check("New template wording is what is sent: driver on the way (no 'Good morning'), Anneli's trip closed (driver closed the ride)",
           bool(on_way and "Good morning" not in on_way["text"] and closed and "driver has closed the ride" in closed["text"]), ["C22"])
    ms = _do("guest", kind="list", id="guest:rating:5", title="Excellent", context=review["wamid"]); log += ms
    _check("Review thank-you offers 'Book a car' (no dead end)", _ids(_out(ms, "guest")) == ["book"], ["C08"])
    _check("No duplicate messages in this booking", _no_duplicates(log), ["C14", "C19"])


def s_between_places_pay_at_destination() -> None:
    """Airport -> Perry's Bridge (neither the farm), paid at the destination, old-button tap."""
    log = _book("to:preset:perrys", "Perry's Bridge", "from:preset:airport", "Kruger Intl Airport")
    dest_q = next(m for m in log if m["dir"] == "out" and "Where are you going?" in m["text"])
    _check("Airport pickup: drop-off dropdown offers Kanaan and the other places, not the airport",
           "to:farm" in _rows(dest_q) and "to:preset:perrys" in _rows(dest_q) and "to:preset:airport" not in _rows(dest_q), ["C15"])
    _check("'We will collect you at ...' shows no distance from Kanaan", " km" not in dest_q["text"], ["C11"])
    confirm = next(m for m in log if m["dir"] == "out" and "Is this the right spot?" in m["text"])
    from app.bot.places import PRESETS, distance_between
    leg = distance_between(PRESETS["airport"]["lat"], PRESETS["airport"]["lng"], PRESETS["perrys"]["lat"], PRESETS["perrys"]["lng"])["distanceKm"]
    _check(f"Airport -> Perry's Bridge priced on the {leg:g} km drive between them, not from the farm",
           "Perry's Bridge" in confirm["text"] and f"{leg:g} km" in confirm["text"], ["C15"])
    ms = _accept(log); log += ms
    pins = [m for m in ms if m["role"] == "driver" and m["kind"] == "location"]
    _check("Driver gets only the pickup pin (the airport), not the drop-off",
           len(pins) == 1 and "Pickup: Kruger" in pins[0]["text"], ["C26", "C15"])
    _check("The fare message has only 'Pay now'", _ids(_out(ms, "guest", lambda m: m["buttons"])) == ["guest:pay:now"], ["C29"])
    # The guest does not pay up front.
    ms = _do("driver", kind="template", title="I have left"); log += ms
    arrived_q = _out(ms, "driver", lambda m: m["buttons"])
    ms = _do("driver", kind="button", id="driver:arrived", title="I have arrived", context=arrived_q["wamid"]); log += ms
    arrived = _out(ms, "guest", lambda m: m.get("template"))
    ms = _do("guest", kind="template", title="Yes, I can see him", context=arrived["wamid"]); log += ms
    ms = _do("driver", kind="button", id="driver:started", title="Ride started", context=_out(ms, "driver", lambda m: m["buttons"])["wamid"]); log += ms
    _check("Ride started unpaid: no payment link yet - it comes at the destination", not _out(ms, "guest", lambda m: m.get("cta")), ["C31"])
    reached_q = _out(ms, "driver", lambda m: m["buttons"])
    _check("Ride started: the drop-off pin (Perry's Bridge), then 'Reached destination'",
           bool(_out(ms, "driver", lambda m: m["kind"] == "location" and "Drop-off: Perry's Bridge" in m["text"]))
           and _ids(reached_q) == ["driver:reached"], ["C26", "C31"])
    ms = _do("driver", kind="button", id="driver:arrived", title="I have arrived", context=arrived_q["wamid"]); log += ms
    _check("'I have arrived' tapped again on its old message: refused, and 'Reached destination' sent again",
           bool(_out(ms, "driver", lambda m: "earlier message" in m["text"])) and _ids(_out(ms, "driver", lambda m: m["buttons"])) == ["driver:reached"], ["C16"])
    ms = _do("driver", kind="button", id="driver:reached", title="Reached destination", context=reached_q["wamid"]); log += ms
    link = _out(ms, "guest", lambda m: m.get("cta"))
    _check("'Reached destination': the unpaid guest gets 'Pay now'", bool(link and link["cta"]["label"] == "Pay now"), ["C31"])
    _check("No 'Ride complete' for the driver before payment", not any("driver:complete" in _ids(m) for m in ms if m["role"] == "driver"), ["C18", "C31"])
    pay_msgs = ms
    ms = _do("driver", kind="text", text="Ride complete"); log += ms
    _check("A 'Ride complete' before payment is refused", bool(_out(ms, "driver", lambda m: "has not paid" in m["text"])) and _latest_trip()["status"] == "in_progress", ["C18"])
    ms = _pay(pay_msgs, "success"); log += ms
    complete = _out(ms, "driver", lambda m: "driver:complete" in _ids(m))
    _check("Paid: only now does the driver get 'Ride complete' (once)", bool(complete) and sum(1 for m in ms if "driver:complete" in _ids(m)) == 1, ["C18", "C31"])
    ms = _do("driver", kind="button", id="driver:complete", title="Ride complete", context=complete["wamid"]); log += ms
    _check("Ride completed, review offered", _latest_trip()["status"] == "completed" and _out(ms, "guest", lambda m: m.get("list")), ["C05"])
    _check("No duplicate messages in this booking", _no_duplicates(log), ["C14", "C19"])


def s_pickup_too_far() -> None:
    """Pickup shared from far away is refused; then a pickup within range."""
    log: list[dict[str, Any]] = []
    ms = _do("guest", kind="text", text="hi"); log += ms
    ms = _do("guest", kind="button", id="book", title="Book a car", context=_out(ms, "guest")["wamid"]); log += ms
    ms = _do("guest", kind="button", id="when:now", title="Now", context=_out(ms, "guest")["wamid"]); log += ms
    ms = _do("guest", kind="list", id="from:location", title="Share my location", context=_out(ms, "guest", lambda m: m.get("list"))["wamid"]); log += ms
    _check("'Share my location' opens the location picker", _out(ms, "guest", lambda m: m.get("location_request")), ["C02"])
    ms = _do("guest", kind="location", lat=19.0760, lng=72.8777); log += ms
    refuse = _out(ms, "guest", lambda m: m["buttons"])
    _check("Pickup past 50 km: 'we can only book within 50 km', with 'Pick within 50 km' / 'End'",
           refuse and "within 50 km of the farm" in refuse["text"] and _ids(refuse) == ["from:closer", "from:end"], ["C02"])
    ms = _do("guest", kind="button", id="from:closer", title="Pick within 50 km", context=refuse["wamid"]); log += ms
    ms = _do("guest", kind="location", lat=-25.0450, lng=31.1250); log += ms
    dest_q = _out(ms, "guest", lambda m: m.get("list"))
    _check("Pickup within range: drop-off dropdown, with no distance from Kanaan", dest_q and " km" not in dest_q["text"], ["C02", "C11", "C15"])
    ms = _do("guest", kind="text", text="cancel"); log += ms
    _check("Cancelling offers 'Book a car'", _ids(_out(ms, "guest")) == ["book"], ["C08"])


def s_payment_outcomes() -> None:
    """Card declined, then payment page closed, then paid - everyone told each time."""
    log = _book("to:preset:lowveld", "Lowveld Mall (Engen)")
    ms = _accept(log); log += ms
    offer = _out(ms, "guest", lambda m: "guest:pay:now" in _ids(m))
    ms = _do("guest", kind="button", id="guest:pay:now", title="Pay now", context=offer["wamid"]); log += ms
    ms = _pay(ms, "failed"); log += ms
    retry = _out(ms, "guest", lambda m: m["buttons"])
    _check("Declined: guest told why, with only 'Try again'",
           retry and "did not go through (Declined)" in retry["text"] and _ids(retry) == ["guest:pay:now"], ["C06", "C29"])
    _check("Declined: driver and Anneli told", _out(ms, "driver", lambda m: "did not go through" in m["text"]) and _out(ms, "ops", lambda m: "failed" in m["text"]), ["C06"])
    ms = _do("guest", kind="button", id="guest:pay:now", title="Try again", context=retry["wamid"]); log += ms
    ms = _pay(ms, "cancelled"); log += ms
    cancelled = _out(ms, "guest", lambda m: m["buttons"])
    _check("Payment page closed: guest told nothing was taken and the booking is still confirmed",
           cancelled and "nothing was taken" in cancelled["text"] and "still confirmed" in cancelled["text"], ["C06", "C14"])
    _check("Payment page closed: driver told the trip is still on", _out(ms, "driver", lambda m: "is still on" in m["text"]), ["C06", "C14"])
    ms = _do("guest", kind="button", id="guest:pay:now", title="Pay now", context=cancelled["wamid"]); log += ms
    ms = _pay(ms, "success"); log += ms
    _check("Paid: guest, driver and Anneli told",
           _out(ms, "guest", lambda m: "received" in m["text"]) and _out(ms, "driver", lambda m: "has paid" in m["text"]) and _out(ms, "ops", lambda m: "paid by card" in m["text"]),
           ["C06"])
    # "Cancel this trip" on a confirmation sent before the button was taken off.
    ms = _do("guest", kind="template", title="Cancel this trip"); log += ms
    _check("'Cancel this trip' on an older confirmation: turned down, the trip stands",
           bool(_out(ms, "guest", lambda m: "can no longer be cancelled" in m["text"])) and _latest_trip()["status"] == "allocated", ["C28"])
    T.cancel_trip(_latest_trip()["id"], "ops", "scenario cleanup")
    _check("No duplicate messages in this booking", _no_duplicates(log), ["C14", "C19"])


def _together(*taps: tuple[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Delivers the taps at the same instant; returns everything sent meanwhile."""
    time.sleep(PACE)
    i = _mark()
    ts = [threading.Thread(target=_do, args=(role,), kwargs={"pause": False, **kw}) for role, kw in taps]
    [t.start() for t in ts]; [t.join() for t in ts]
    return _since(i)


def s_double_taps() -> None:
    """The KN-1012 case: taps landing together act once; old buttons are refused."""
    with hub_db.begin() as c:
        before = c.execute(text("select coalesce(max(id), 0) from trips")).scalar()
    log = _book("to:preset:perrys", "Perry's Bridge")
    quote = _out(log, "guest", lambda m: "Please confirm" in m["text"])
    ms = _accept(log); log += ms
    ms = _do("guest", kind="button", id="quote:confirm", title="Send request", context=quote["wamid"]); log += ms
    with hub_db.begin() as c:
        trips_made = c.execute(text("select count(*) from trips where id > :b"), {"b": before}).scalar()
    _check("Tapping the old 'Send request' again is refused as an earlier question - still one trip",
           trips_made == 1 and _out(ms, "guest", lambda m: "earlier message" in m["text"]), ["C16", "C14"])
    offer = _out(log, "guest", lambda m: "guest:pay:now" in _ids(m))
    ms = _do("guest", kind="button", id="guest:pay:now", title="Pay now", context=offer["wamid"]); log += ms
    ms = _pay(ms, "success"); log += ms
    ms = _do("driver", kind="template", title="I have left"); log += ms
    ms = _do("driver", kind="button", id="driver:arrived", title="I have arrived", context=_out(ms, "driver", lambda m: m["buttons"])["wamid"]); log += ms
    arrived = _out(ms, "guest", lambda m: m.get("template"))
    see = {"kind": "template", "title": "Yes, I can see him", "context": arrived["wamid"]}
    ms = _together(("guest", see), ("guest", see)); log += ms
    started = [m for m in ms if m["role"] == "driver" and "driver:started" in _ids(m)]
    _check("'Yes, I can see him' tapped twice at once: the driver gets ONE 'Ride started'", len(started) == 1, ["C30", "C14"])
    tap_started = {"kind": "button", "id": "driver:started", "title": "Ride started", "context": started[0]["wamid"] if started else None}
    ms = _together(("driver", tap_started), ("driver", tap_started)); log += ms
    reached = [m for m in ms if m["role"] == "driver" and "driver:reached" in _ids(m)]
    _check("'Ride started' double-tapped: one trip-started card to Anneli, ONE 'Reached destination'",
           sum(1 for m in ms if m["role"] == "ops" and m.get("template") == "kn_ops_trip_started") == 1 and len(reached) == 1, ["C14", "C31"])
    tap_reached = {"kind": "button", "id": "driver:reached", "title": "Reached destination", "context": reached[0]["wamid"] if reached else None}
    ms = _together(("driver", tap_reached), ("driver", tap_reached)); log += ms
    complete = _out(ms, "driver", lambda m: "driver:complete" in _ids(m))
    _check("'Reached destination' double-tapped (fare paid): exactly one 'Ride complete', and it is the driver's last question",
           complete and sum(1 for m in ms if "driver:complete" in _ids(m)) == 1
           and _ids(_out(log, "driver", lambda m: m["buttons"])) == ["driver:complete"], ["C14", "C23", "C31"])
    tap_complete = {"kind": "button", "id": "driver:complete", "title": "Ride complete", "context": complete["wamid"] if complete else None}
    ms = _together(("driver", tap_complete), ("driver", tap_complete)); log += ms
    _check("'Ride complete' double-tapped: trip closed once, one review, one closed card",
           _latest_trip()["status"] == "completed" and sum(1 for m in ms if m["role"] == "guest" and m.get("list")) == 1
           and sum(1 for m in ms if m["role"] == "ops" and m.get("template")) == 1, ["C14", "C23"])
    ms = _do("driver", kind="button", id="driver:complete", title="Ride complete", context=complete["wamid"] if complete else None); log += ms
    _check("A later tap on the closed trip says 'already closed' (not 'guest has not confirmed the pickup')",
           _out(ms, "driver", lambda m: "already closed" in m["text"]) and not any("has not confirmed the pickup" in m["text"] for m in log), ["C14"])
    _check("No button reaches the driver twice in this trip",
           all(sum(1 for m in log if m["role"] == "driver" and b in _ids(m)) <= 1
               for b in ("driver:started", "driver:reached", "driver:complete")), ["C30", "C14"])


def s_date_time_picker() -> None:
    """'Pick a day and time' opens the calendar with hour and minutes."""
    from datetime import timedelta
    from app.bot.when import SAST
    log: list[dict[str, Any]] = []
    ms = _do("guest", kind="text", text="hi"); log += ms
    ms = _do("guest", kind="button", id="book", title="Book a car", context=_out(ms, "guest")["wamid"]); log += ms
    ms = _do("guest", kind="button", id="when:later", title="Pick a day and time", context=_out(ms, "guest")["wamid"]); log += ms
    flow = _out(ms, "guest", lambda m: m.get("flow"))
    data = (flow or {}).get("flow", {}).get("data", {})
    _check("'Pick a day and time' opens the calendar", bool(flow and data.get("min_date") and data.get("max_date")), ["C03"])
    _check("Time picker has hour and minutes (00, 05 ... 55)",
           [x["id"] for x in data.get("minutes", [])] == [f"{m:02d}" for m in range(0, 60, 5)] and len(data.get("hours", [])) > 0, ["C03"])
    tomorrow = (hub_db.now().astimezone(SAST) + timedelta(days=1)).date().isoformat()
    ms = _do("guest", kind="flow", date=tomorrow, hour="10", minute="25"); log += ms
    ms = _do("guest", kind="list", id="from:farm", title="Kanaan Guest Farm", context=_out(ms, "guest", lambda m: m.get("list"))["wamid"]); log += ms
    ms = _do("guest", kind="list", id="to:preset:perrys", title="Perry's Bridge", context=_out(ms, "guest", lambda m: m.get("list"))["wamid"]); log += ms
    ms = _do("guest", kind="button", id="place:yes", title="Yes, that one", context=_out(ms, "guest", lambda m: m["buttons"])["wamid"]); log += ms
    ms = _do("guest", kind="text", text="Sam Botha"); log += ms
    _check("The picked time (10:25) is on the quote", _out(ms, "guest", lambda m: "at 10:25" in m["text"]), ["C03"])
    ms = _do("guest", kind="text", text="cancel"); log += ms


SCENARIOS: dict[str, tuple[str, Callable[[], None]]] = {
    "farm_pay_now": ("Farm -> Perry's Bridge, pay now, full ride", s_farm_pay_now),
    "between_places": ("Airport -> Perry's Bridge, paid at the destination", s_between_places_pay_at_destination),
    "too_far": ("Pickup past 50 km, then within range", s_pickup_too_far),
    "payments": ("Card declined, page closed, then paid", s_payment_outcomes),
    "double_taps": ("Double taps and old buttons (KN-1012)", s_double_taps),
    "date_time": ("Date and time picker with minutes", s_date_time_picker),
}


def _conversation_checks() -> None:
    """Across the whole run: every guest message either has something to tap or is one
    that needs a typed answer / nothing from the guest."""
    allowed = ("What is your full name", "Payment of R", "Thank you. ", "Your ride has started", "Your ride with",
               "No problem. We will send you the payment link", "That option is from an earlier message", "Sorry, I did not catch",
               "Your car (")  # a cancel turned down: the next step is a call to Anneli
    sim = _sim()
    with sim._lock:
        dead = [m["text"].splitlines()[0][:60] for m in sim._log
                if m["dir"] == "out" and m["role"] == "guest" and m["kind"] == "text" and not m["text"].startswith(allowed)]
    state["current"] = "Whole run"
    _check("No guest message leaves them with nothing to do" + (f" (check: {dead[:3]})" if dead else ""), not dead, ["C08"])
    with sim._lock:
        used = {m["template"] for m in sim._log if m.get("template")}
    missing = sorted(n for n in used if n not in sim.TEMPLATES)
    _check("Every template used is on Meta or written up as a proposal - none unknown" + (f" (missing: {missing})" if missing else ""),
           not missing, ["C20", "C08"])
    # A template not yet approved (in Meta's review, or only proposed) cannot be sent live:
    # the bot falls back to an approved earlier version of it, so the flow still works.
    waiting = sorted(n for n in used if (sim.TEMPLATES.get(n) or {}).get("status") in ("PENDING", "PROPOSED"))
    approved = {n for n, t in sim.TEMPLATES.items() if t["status"] == "APPROVED"}
    no_fallback = [n for n in waiting if not any(re.sub(r"_v\d+$", "", a) == re.sub(r"_v\d+$", "", n) for a in approved)]
    _check(f"Templates not yet approved on Meta: {waiting or 'none'}; "
           "each has an approved earlier version that goes live until then" + (f" (no fallback: {no_fallback})" if no_fallback else ""),
           not no_fallback, ["C20", "C27", "C28"])


def run(keys: list[str]) -> bool:
    if not _run_lock.acquire(blocking=False):
        return False

    def go():
        try:
            state.update(running=True, results=[], finished_at=None)
            state["current"] = "Simulator"
            try:
                _sim()._require_database()
                db_ok = True
            except Exception:
                db_ok = False
            _check("Simulator database is up - messages are answered, no 'Internal Server Error'", db_ok, ["C21"])
            if not db_ok:
                return
            for key in keys:
                title, fn = SCENARIOS[key]
                state["current"] = title
                _close_leftovers()
                try:
                    fn()
                except Exception as err:  # a crash is a failed check, not a stuck run
                    _check(f"Scenario crashed: {err}", False, [])
            if len(keys) > 1:
                _conversation_checks()
        finally:
            state.update(running=False, current=None, finished_at=time.strftime("%H:%M:%S"))
            _run_lock.release()

    threading.Thread(target=go, name="sim-scenarios", daemon=True).start()
    return True


def tracker() -> list[dict[str, Any]]:
    """Each correction with its verification status from the latest run."""
    out = []
    for c in corrections():
        checks = [r for r in state["results"] if c["id"] in r["corrections"]]
        status = "not run" if not checks else ("verified" if all(r["ok"] for r in checks) else "failing")
        out.append({**c, "verification": status, "checks": len(checks), "failed": [r["check"] for r in checks if not r["ok"]]})
    return out
