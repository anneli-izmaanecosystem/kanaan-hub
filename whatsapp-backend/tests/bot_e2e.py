"""End-to-end test of the booking bot against a throwaway Postgres.

Drives whole conversations through the real /webhook endpoint (signed like Meta signs
them) and checks what each party is sent and what lands in the database. Nothing goes to
Meta or Paystack: sends are captured (app.bot.wa.capture) and Paystack is stubbed.

    KANAAN_HUB_DATABASE_URL=postgresql://...  DATABASE_URL=postgresql://... \
        python tests/bot_e2e.py

Both databases must be empty and disposable. Create the kanaan_hub schema from the
dashboard's current Drizzle schema first (the migration history does not replay from
zero), pointing drizzle-kit at the throwaway database only:

    npx drizzle-kit push --force --config <a config whose url is the test database>

This service's own tables are created here from migrations/.
"""

import hashlib
import hmac
import json
import os
import sys
import time
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

SECRET = "test-app-secret"
PHONE_ID = "1311435335391879"
OPS, DRIVER, GUEST, GUEST2 = "+27000000001", "+27000000002", "+27000000003", "+27000000004"

os.environ.update({
    "WHATSAPP_APP_SECRET": SECRET,
    "WHATSAPP_PHONE_NUMBER_ID": PHONE_ID,
    "WHATSAPP_ACCESS_TOKEN": "test",
    "PAYSTACK_SECRET_KEY": "sk_test_stub",
    "GOOGLE_MAPS_API_KEY": "",
    "BOT_SCHEDULER_ENABLED": "false",
    "INTERNAL_MIRROR_SECRET": "internal-test",
    "KANAAN_OPS_WHATSAPP": OPS,
    "KANAAN_OPS_PHONE": "063 794 3880",
    "KANAAN_FIXED_FARES": "airport=750, nonsense, phabeni=abc",
    "KANAAN_DATETIME_FLOW_ID": "test-flow",
})

import logging  # noqa: E402

import psycopg2  # noqa: E402


class _ErrorCounter(logging.Handler):
    """Sends and recordings are guarded (they log instead of raising), so a check can
    pass while something underneath failed. Any error the bot logs fails the run."""

    def __init__(self):
        super().__init__(logging.ERROR)
        self.records: list[logging.LogRecord] = []

    def emit(self, record):
        self.records.append(record)


bot_errors = _ErrorCounter()
logging.getLogger("kanaan").addHandler(bot_errors)


def migrate() -> None:
    with psycopg2.connect(os.environ["KANAAN_HUB_DATABASE_URL"]) as conn, conn.cursor() as cur:
        cur.execute("show server_encoding")
        encoding = cur.fetchone()[0]
        # Production is UTF8; a WIN1252 test database (Windows' default) cannot store the
        # emoji in the star rating and would fail recordings that production never would.
        assert encoding == "UTF8", f"test database must be UTF8 (initdb --encoding=UTF8), got {encoding}"
    with psycopg2.connect(os.environ["KANAAN_HUB_DATABASE_URL"]) as conn, conn.cursor() as cur:
        # No transfer_settings row, as in production: fares and Anneli's number come from
        # the service's own settings (KANAAN_OPS_WHATSAPP above).
        cur.execute("insert into drivers (name, phone, plate, vehicle) values ('Thabo Nkosi', %s, 'JHV 421 MP', 'white Toyota Quantum')", (DRIVER,))
    with psycopg2.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        for path in sorted((ROOT / "migrations").glob("*.sql")):
            cur.execute(path.read_text(encoding="utf-8"))


migrate()

from fastapi.testclient import TestClient  # noqa: E402

from app import paystack  # noqa: E402
from app.bot import hub_db, scheduler, trip as T, wa  # noqa: E402
from app.main import app  # noqa: E402

sent: list[dict] = []
wa.capture = sent

# Paystack: a link per request, no network.
_links = iter(range(1, 10_000))
paystack.start_payment = lambda settings, trip_id, ref, email, amount, purpose: (lambda n: {
    "authorization_url": f"https://paystack.test/{ref}-{purpose}-{n}", "access_code": "x", "reference": f"{ref}-{purpose}-{n}"})(next(_links))

client = TestClient(app)
_ids = iter(range(1, 10_000))
failures: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("  ok   " if cond else "  FAIL ") + what)
    if not cond:
        failures.append(what)


def post(phone: str, message: dict) -> list[dict]:
    """Delivers one inbound message as Meta would; returns what the bot sent back."""
    start = len(sent)
    message = {"from": phone.lstrip("+"), "id": f"wamid.in-{next(_ids)}", "timestamp": str(int(time.time())), **message}
    body = json.dumps({"object": "whatsapp_business_account", "entry": [{"id": "1", "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp", "metadata": {"display_phone_number": "27642116345", "phone_number_id": PHONE_ID},
        "messages": [message]}}]}]}).encode()
    sig = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    res = client.post("/webhook", content=body, headers={"X-Hub-Signature-256": sig, "Content-Type": "application/json"})
    assert res.status_code == 200, res.text
    return sent[start:]


def text(phone, body, context=None):
    m = {"type": "text", "text": {"body": body}}
    if context:
        m["context"] = {"from": "27642116345", "id": context}
    return post(phone, m)


def tap(phone, button_id, title="x", context=None):
    m = {"type": "interactive", "interactive": {"type": "button_reply", "button_reply": {"id": button_id, "title": title}}}
    if context:
        m["context"] = {"from": "27642116345", "id": context}
    return post(phone, m)


def pick(phone, row_id, title="x"):
    return post(phone, {"type": "interactive", "interactive": {"type": "list_reply", "list_reply": {"id": row_id, "title": title}}})


def template_tap(phone, label, context=None):
    m = {"type": "button", "button": {"text": label, "payload": label}}
    if context:
        m["context"] = {"from": "27642116345", "id": context}
    return post(phone, m)


def location(phone, lat, lng, name=None):
    loc = {"latitude": lat, "longitude": lng}
    if name:
        loc["name"] = name
    return post(phone, {"type": "location", "location": loc})


def body_of(m: dict) -> str:
    if m["type"] == "text":
        return m["text"]["body"]
    if m["type"] == "interactive":
        return m["interactive"]["body"]["text"]
    if m["type"] == "template":
        return m["template"]["name"]
    return m["type"]


def params_of(m: dict) -> list[str]:
    """A template's body parameters."""
    return [p.get("text", "") for c_ in m.get("template", {}).get("components", []) if c_["type"] == "body" for p in c_["parameters"]]


def buttons(m: dict) -> list[str]:
    return [b["reply"]["id"] for b in m.get("interactive", {}).get("action", {}).get("buttons", [])]


def rows(m: dict) -> list[str]:
    return [r["id"] for s_ in m.get("interactive", {}).get("action", {}).get("sections", []) for r in s_["rows"]]


PICKUP_ROWS = ["from:farm", "from:preset:perrys", "from:preset:lowveld", "from:preset:airport", "from:location", "from:other"]


def to(m: dict) -> str:
    return "+" + m["to"]


def trip_row(ref=None):
    with hub_db.begin() as c:
        q = "select * from trips order by id desc limit 1" if not ref else "select * from trips where ref = :r"
        from sqlalchemy import text as sql
        return c.execute(sql(q), {"r": ref}).mappings().first()


# ── 1. booking, pickup shared too far away, then within range ───────────────
print("1. guest books, pickup location too far, then within range")
out = text(GUEST, "hi")
check(buttons(out[-1]) == ["book"], "greeting offers Book a car")
out = tap(GUEST, "book")
check("When do you need the car?" in body_of(out[-1]), "asks when")
tap(GUEST, "when:later")
out = text(GUEST, "tomorrow 10:00")
check(rows(out[-1]) == PICKUP_ROWS, "asks for pickup: farm, Perry's Bridge, Lowveld Mall, airport, my location, somewhere else")
out = tap(GUEST, "from:location")
check(out[-1]["interactive"]["type"] == "location_request_message", "Send location opens the native location request")
out = location(GUEST, 19.0760, 72.8777)  # Mumbai
check("We can only book cars by chat within 50 km" in body_of(out[-1]) and buttons(out[-1]) == ["from:closer", "from:end"],
      "pickup past 50 km refused with Pick within 50 km / End")
out = tap(GUEST, "from:closer")
check(out[-1]["interactive"]["type"] == "location_request_message", "Pick within 50 km asks for the location again")
out = location(GUEST, -25.0450, 31.1250)  # Hazyview
check("We will collect you at the location you shared.\nWhere are you going?" in body_of(out[-1])
      and out[-1]["interactive"]["type"] == "list", "pickup within range: the drop-off pick-list")
check(" km" not in body_of(out[-1]).split("\n")[0], "the pickup message shows no distance from the farm")
out = tap(GUEST, "to:farm")
check("Is this the right spot?" in body_of(out[-1]), "confirms the far end")
out = tap(GUEST, "place:yes")
check("What is your full name?" in body_of(out[-1]), "asks for the full name")
out = text(GUEST, "Sam Botha")
quote = out[-1]
check("\nName: Sam Botha\nPhone: +27 00 000 0003\n" in body_of(quote), "quote shows the guest's full name and phone number")
check(buttons(quote) == ["quote:confirm", "quote:change"], "quote has Send request / Change something - no payment")
check("We are checking driver availability and will confirm your booking as soon as possible. "
      "No payment is required until your car is confirmed." in body_of(quote), "quote says nothing to pay yet")
out = tap(GUEST, "quote:confirm")
trip = trip_row()
check(trip["status"] == "requested" and trip["ref"].startswith("KN-"), f"trip {trip['ref']} requested")
guest_msgs = [m for m in out if to(m) == GUEST]
check(any("Request sent to Anneli" in body_of(m) for m in guest_msgs), "guest told request sent")
check(not any("pay" in body_of(m).lower() for m in guest_msgs), "no payment mentioned to the guest before acceptance")
card = next(m for m in out if to(m) == OPS)
check(card["template"]["name"] == "kn_ops_new_request_v2", "Anneli gets the request card")

# ── 2. Anneli accepts and allocates ──────────────────────────────────────────
print("2. Anneli accepts and picks a driver")
out = template_tap(OPS, "Accept", context=card["_id"])
check(out and out[-1]["interactive"]["type"] == "list", "Accept sends the driver picker")
out = pick(OPS, "driver:1")
trip = trip_row(trip["ref"])
check(trip["status"] == "allocated" and trip["driver_id"] == 1, "trip allocated to Thabo")
names = [(to(m), body_of(m)) for m in out]
guest_out = [m for m in out if to(m) == GUEST]
check(guest_out and body_of(guest_out[0]) == "kn_guest_trip_confirmed_v4", "guest gets the confirmation template first (v4: no cancel button)")
pay_offer = next((m for m in out if to(m) == GUEST and buttons(m) == ["guest:pay:now"]), None)
check(pay_offer is not None and guest_out.index(pay_offer) == 1,
      "then the fare, with only Pay now - offered only now, after acceptance")
check(not any("cancel" in b for m in guest_out for b in buttons(m)), "no cancel button for the guest once the car is confirmed")
driver_out = [m for m in out if to(m) == DRIVER]
new_trip = next((m for m in driver_out if m["type"] == "template" and m["template"]["name"] == "kn_driver_new_trip_v2"), None)
check(new_trip is not None and params_of(new_trip)[2] == "Sam Botha - +27 00 000 0003",
      "driver's trip card (Noted only) shows the guest's full name and phone number")
pins = [m for m in driver_out if m["type"] == "location"]
check(len(pins) == 1 and driver_out.index(pins[0]) == driver_out.index(new_trip) + 1
      and pins[0]["location"]["name"].startswith("Pickup: ") and abs(pins[0]["location"]["latitude"] + 25.0450) < 0.001,
      "after the card, one map pin: the guest's pickup point")
out = template_tap(DRIVER, "I cannot take it")
check(trip_row(trip["ref"])["status"] == "allocated" and trip_row(trip["ref"])["driver_id"] == 1
      and any("please call Anneli" in body_of(m) for m in out) and not any(to(m) == OPS for m in out),
      "I cannot take it (old card) no longer hands the trip back")
out = template_tap(DRIVER, "I cannot make it")
check(trip_row(trip["ref"])["status"] == "allocated" and trip_row(trip["ref"])["driver_id"] == 1
      and any("please call Anneli" in body_of(m) for m in out) and not any(to(m) == OPS for m in out),
      "I cannot make it (old reminder) no longer hands the trip back")
check(any("Done. The guest and Thabo Nkosi" in b for p, b in names if p == OPS), "Anneli told it is done")
# the guest cannot cancel a confirmed car: typed, or on an older card's button
out = text(GUEST, "cancel")
check(trip_row(trip["ref"])["status"] == "allocated"
      and any("can no longer be cancelled in the chat" in body_of(m) and "063 794 3880" in body_of(m) for m in out if to(m) == GUEST)
      and any("asked to cancel" in body_of(m) for m in out if to(m) == OPS)
      and not any(buttons(m) == ["cancel:yes", "cancel:no"] for m in out),
      "typed cancel after confirmation: turned down (call Anneli), Anneli told, the trip stands")
out = template_tap(GUEST, "Cancel this trip")
check(trip_row(trip["ref"])["status"] == "allocated" and any("can no longer be cancelled" in body_of(m) for m in out),
      "'Cancel this trip' on an older confirmation: turned down")
out = text(GUEST, "ok thanks")
check(not any("cancel" in b for m in out for b in buttons(m)), "a stray message once confirmed: no cancel button")

# ── 3. the day: pay now, driver stages, guest confirms, ride complete ────────
print("3. on the day")
out = tap(GUEST, "guest:pay:now", context=pay_offer["_id"])
check(any(m["type"] == "interactive" and m["interactive"]["type"] == "cta_url" for m in out), "Pay now sends the Paystack link")
T.payment_received({"status": "success", "reference": "ref-1", "amount": 28000, "metadata": {"tripId": trip["id"], "purpose": "fare"}})
T.payment_received({"status": "success", "reference": "ref-1", "amount": 28000, "metadata": {"tripId": trip["id"], "purpose": "fare"}})
check(trip_row(trip["ref"])["captured_at"] is not None, "payment marks the trip paid (and is safe to repeat)")
out = template_tap(DRIVER, "I have left")
check(trip_row(trip["ref"])["status"] == "driver_en_route", "driver left")
check(any("Guest: Sam Botha - +27 00 000 0003" in body_of(m) for m in out if to(m) == DRIVER), "on the way: driver has the guest's name and number")
out = tap(DRIVER, "driver:arrived")
check(trip_row(trip["ref"])["status"] == "driver_waiting", "driver arrived")
check(not any(buttons(m) for m in out if to(m) == DRIVER), "arrived: no Ride started yet - the guest is asked first")
arrived = next(m for m in out if to(m) == GUEST)
out = template_tap(GUEST, "Yes, I can see him", context=arrived["_id"])
check(trip_row(trip["ref"])["status"] == "driver_waiting", "guest can see the driver - the ride does not start on that")
check(any(buttons(m) == ["driver:started"] and "The guest can see you" in body_of(m) for m in out if to(m) == DRIVER),
      "driver told the guest can see them, with Ride started")
out = tap(DRIVER, "driver:started", "Ride started")
check(trip_row(trip["ref"])["status"] == "in_progress", "the driver's Ride started starts the ride")
check([buttons(m) for m in out if to(m) == DRIVER and buttons(m)] == [["driver:reached"]],
      "ride started: the driver gets Reached destination, not Ride complete")
check(not any(m["type"] == "location" for m in out if to(m) == DRIVER), "trip to the farm: no drop-off pin")
out = tap(DRIVER, "driver:reached", "Reached destination")
check(any(buttons(m) == ["driver:complete"] for m in out if to(m) == DRIVER)
      and not any(m.get("interactive", {}).get("type") == "cta_url" for m in out),
      "fare already paid: Reached destination brings Ride complete, no payment link")
out = tap(DRIVER, "driver:complete")
check(trip_row(trip["ref"])["status"] == "completed", "ride completed")
check(any("already paid" in body_of(m) for m in out if to(m) == GUEST), "paid guest is not asked again")
review = next((m for m in out if to(m) == GUEST and m.get("interactive", {}).get("type") == "list"), None)
check(review is not None and len(review["interactive"]["action"]["sections"][0]["rows"]) == 5,
      "already paid: the 1-5 star review goes out at ride complete")
out = pick(GUEST, "guest:rating:5")
check(any("Thank you for the rating" in body_of(m) for m in out), "5 stars thanked")
out = tap(GUEST, "guest:feedback:good")
check(any("Safe onward travels" in body_of(m) for m in out), "feedback handled after the trip closed")

# ── 4. farm pickup: destination prompt, too-far destination, cancel ─────────
print("4. farm pickup, too-far destination, cancellation")
text(GUEST2, "hello")
tap(GUEST2, "book")
tap(GUEST2, "when:now")
out = tap(GUEST2, "from:farm")
check(out[-1]["interactive"]["type"] == "list" and "to:farm" not in rows(out[-1]) and "to:preset:airport" in rows(out[-1]),
      "picked up at the farm: destination list without the farm")
out = text(GUEST2, "blyde river canyon")
check(buttons(out[-1]) == ["place:closer", "place:end"] and "Blyde River Canyon is about" in body_of(out[-1]),
      "destination past 50 km refused with Pick within 50 km / End")
out = tap(GUEST2, "place:closer")
out = text(GUEST2, "phabeni")
check("Phabeni Gate" in body_of(out[-1]), "a closer destination is accepted")
tap(GUEST2, "place:yes")
text(GUEST2, "Ann")
tap(GUEST2, "quote:confirm")
trip2 = trip_row()
out = text(GUEST2, "cancel")
check(buttons(out[-1]) == ["cancel:yes", "cancel:no"], "typing cancel asks to confirm")
out = tap(GUEST2, "cancel:yes")
check(trip_row(trip2["ref"])["status"] == "cancelled", "trip cancelled")
check(any("Nothing has been charged" in body_of(m) for m in out if to(m) == GUEST2), "unpaid cancel says nothing charged")

# ── 5. scheduler: Anneli has not answered ────────────────────────────────────
print("5. scheduler")
text(GUEST2, "hi")
tap(GUEST2, "book")
tap(GUEST2, "when:later")
text(GUEST2, "tomorrow 09:00")
tap(GUEST2, "from:farm")
text(GUEST2, "hazyview")
tap(GUEST2, "place:yes")
text(GUEST2, "Ann")
tap(GUEST2, "quote:confirm")
trip3 = trip_row()
report = scheduler.tick(hub_db.now() + timedelta(minutes=20))
check(trip3["ref"] in report["opsChased"], "unanswered request chased after 15 minutes")
report = scheduler.tick(hub_db.now() + timedelta(minutes=40))
check(trip3["ref"] not in report["opsChased"], "and only once")

# ── 6. repeat delivery and the dashboard endpoints ───────────────────────────
print("6. idempotency and dashboard endpoints")
dup = {"from": GUEST2.lstrip("+"), "id": "wamid.dup", "timestamp": "1", "type": "text", "text": {"body": "hi"}}
first, second = post(GUEST2, dict(dup)), post(GUEST2, dict(dup))
check(len(first) > 0 and len(second) == 0, "a retried delivery is not processed twice")
res = client.post(f"/bot/trips/{trip3['id']}/allocate", json={"driver_id": 1}, headers={"X-Internal-Secret": "internal-test"})
check(res.status_code == 200 and trip_row(trip3["ref"])["status"] == "allocated", "dashboard can allocate a driver")
res = client.post(f"/bot/trips/{trip3['id']}/cancel", json={}, headers={"X-Internal-Secret": "internal-test"})
check(res.status_code == 200 and trip_row(trip3["ref"])["status"] == "cancelled", "dashboard can cancel")
check(client.post("/bot/tick").status_code == 401, "bot endpoints refuse calls without the internal secret")

# ── 6b. a template still in review falls back to the approved one ────────────
print("6b. template fallback")
_real_send = wa._send


def _pending_v2(payload, trip_id=None):
    if payload.get("type") == "template" and payload["template"]["name"] == "kn_driver_new_trip_v2":
        raise wa.WhatsAppError("(#132001) Template name does not exist in the translation", 404)
    return _real_send(payload, trip_id)


with hub_db.begin() as c:  # a fresh request to allocate (trip3 was cancelled above)
    from sqlalchemy import text as sql
    c.execute(sql("update trips set status = 'requested', driver_id = null where id = :i"), {"i": trip3["id"]})
wa._send = _pending_v2
start = len(sent)
T.allocate_driver(trip3["id"], 1, "board")
wa._send = _real_send
check(any(m["type"] == "template" and m["template"]["name"] == "kn_driver_new_trip" for m in sent[start:]),
      "while kn_driver_new_trip_v2 is pending, the approved kn_driver_new_trip goes instead")
T.cancel_trip(trip3["id"], "ops", "test cleanup")

# the reworded templates (in Meta's review, or only proposed): the approved originals go instead
NEW_PENDING = {"kn_guest_trip_confirmed_v4", "kn_guest_trip_confirmed_v3", "kn_guest_driver_on_way_v2", "kn_ops_trip_closed_v3",
               "kn_driver_trip_reminder_v2", "kn_guest_trip_reminder_evening_v3", "kn_guest_driver_waiting_v2"}


def _pending_new(payload, trip_id=None):
    if payload.get("type") == "template" and payload["template"]["name"] in NEW_PENDING:
        raise wa.WhatsAppError("(#132001) Template name does not exist in the translation", 404)
    return _real_send(payload, trip_id)


with hub_db.begin() as c:
    from sqlalchemy import text as sql
    c.execute(sql("update trips set status = 'requested', driver_id = null where id = :i"), {"i": trip3["id"]})
wa._send = _pending_new
start = len(sent)
T.allocate_driver(trip3["id"], 1, "board")
_t3, _d1 = T.get_trip(trip3["id"]), T.get_driver(1)
T.send_evening_reminder(_t3, _d1)
T.send_driver_reminder(_t3, _d1)
T.driver_left(trip3["id"], _d1)
T.driver_arrived(trip3["id"], _d1)
T.ask_about_no_show(T.get_trip(trip3["id"]), _d1, 15)
wa._send = _real_send
used = {m["template"]["name"] for m in sent[start:] if m["type"] == "template"}
check({"kn_guest_trip_confirmed_v2", "kn_guest_driver_on_way", "kn_driver_trip_reminder",
       "kn_guest_trip_reminder_evening_v2", "kn_guest_driver_waiting"} <= used and not (used & NEW_PENDING),
      "while the new templates are not approved, the approved originals are sent instead")
# and once approved, the new versions go: no cancel button for the guest, no "I cannot make it" for the driver
start = len(sent)
T.send_evening_reminder(_t3, _d1)
T.send_driver_reminder(_t3, _d1)
T.ask_about_no_show(T.get_trip(trip3["id"]), _d1, 30)
used = {m["template"]["name"] for m in sent[start:] if m["type"] == "template"}
check({"kn_guest_trip_reminder_evening_v3", "kn_driver_trip_reminder_v2", "kn_guest_driver_waiting_v2"} <= used,
      "the new versions are tried first")
T.cancel_trip(trip3["id"], "ops", "test cleanup")

# ── 6c. paid at the destination: Ride complete waits for the payment ─────────
print("6c. Reached destination asks an unpaid guest to pay; Ride complete waits for it")
GUEST4 = "+27000000006"
for step in (lambda: text(GUEST4, "hi"), lambda: tap(GUEST4, "book"), lambda: tap(GUEST4, "when:later"),
             lambda: text(GUEST4, "tomorrow 11:00"), lambda: tap(GUEST4, "from:farm"), lambda: text(GUEST4, "numbi"),
             lambda: tap(GUEST4, "place:yes"), lambda: text(GUEST4, "Kim"), lambda: tap(GUEST4, "quote:confirm")):
    step()
trip4 = trip_row()
start = len(sent)
T.allocate_driver(trip4["id"], 1, "board")
pins = [m for m in sent[start:] if to(m) == DRIVER and m["type"] == "location"]
check(len(pins) == 1 and pins[0]["location"]["name"] == "Pickup: Kanaan Guest Farm - tap for directions",
      "trip from the farm: the driver's only pin is the farm, not the drop-off")
out = tap(GUEST4, "guest:pay:after", "Pay during ride")
check(any("when you reach your destination" in body_of(m) for m in out), "Pay during ride (older offer): link will come at the destination")
template_tap(DRIVER, "I have left")
out = tap(DRIVER, "driver:arrived")
template_tap(GUEST4, "Yes, I can see him", context=next(m for m in out if to(m) == GUEST4)["_id"])
out = tap(DRIVER, "driver:started", "Ride started")
check(not any(m.get("interactive", {}).get("type") == "cta_url" for m in out), "ride started unpaid: no payment link yet")
d4 = [m for m in out if to(m) == DRIVER]
check([m["type"] for m in d4] == ["location", "interactive"] and "Drop-off: Numbi" in d4[0]["location"]["name"]
      and buttons(d4[1]) == ["driver:reached"], "ride started: the drop-off pin, then Reached destination")
out = tap(DRIVER, "driver:started", "Ride started")
check(any("already started" in body_of(m) for m in out) and not any(buttons(m) for m in out) and not any(to(m) == GUEST4 for m in out),
      "a second Ride started does not start it again, and sends no second button")
out = tap(DRIVER, "driver:reached", "Reached destination")
g4 = [m for m in out if to(m) == GUEST4]
check(len(g4) == 1 and g4[0].get("interactive", {}).get("type") == "cta_url"
      and g4[0]["interactive"]["action"]["parameters"]["display_text"] == "Pay now" and "You have reached Numbi" in body_of(g4[0]),
      "Reached destination: the unpaid guest gets Pay now")
check(not any("driver:complete" in buttons(m) for m in out if to(m) == DRIVER)
      and any("Ride complete will appear here as soon as they have paid" in body_of(m) for m in out if to(m) == DRIVER),
      "no Ride complete for the driver until the guest pays")
out = tap(DRIVER, "driver:reached", "Reached destination")
check(any("has not paid" in body_of(m) for m in out) and not any(to(m) == GUEST4 for m in out),
      "a second Reached destination does not send the guest another link")
out = tap(DRIVER, "driver:complete", "Ride complete")
check(trip_row(trip4["ref"])["status"] == "in_progress" and any("has not paid" in body_of(m) for m in out),
      "a Ride complete tap before payment is refused")
start = len(sent)
T.payment_received({"status": "success", "reference": "ref-4", "amount": 30000, "metadata": {"tripId": trip4["id"], "purpose": "fare"}})
T.payment_received({"status": "success", "reference": "ref-4", "amount": 30000, "metadata": {"tripId": trip4["id"], "purpose": "fare"}})
new = sent[start:]
check(any("Payment of R 300 received" in body_of(m) for m in new if to(m) == GUEST4), "payment confirmed to the guest")
check(sum(1 for m in new if to(m) == DRIVER and buttons(m) == ["driver:complete"]) == 1,
      "paid: the driver gets Ride complete - once, though Paystack confirmed twice")
out = tap(DRIVER, "driver:complete", "Ride complete")
check(trip_row(trip4["ref"])["status"] == "completed", "ride completed after payment")
check(sum(1 for m in out if to(m) == GUEST4 and m.get("interactive", {}).get("type") == "list") == 1, "the review is asked, once")
out = pick(GUEST4, "guest:rating:2")
check(any("What went wrong" in body_of(m) for m in out if to(m) == GUEST4) and any("rated it 2/5" in body_of(m) for m in out if to(m) == OPS),
      "2 stars: guest asked what went wrong, Anneli told the rating")
out = text(GUEST4, "Driver was 20 minutes late")
check(any("Driver was 20 minutes late" in body_of(m) for m in out if to(m) == OPS), "the note reaches Anneli")
with hub_db.begin() as c:
    from sqlalchemy import text as sql
    ev = dict(c.execute(sql("select event, detail from trip_events where trip_id = :t and event like 'review%'"), {"t": trip4["id"]}).all())
check(ev.get("review_rating") == "2" and ev.get("review_comment") == "Driver was 20 minutes late", "rating and note saved on the trip")

# ── 6d. payment failed / cancelled / succeeded: everyone is told ─────────────
print("6d. payment outcomes")
GUEST5 = "+27000000007"
for step in (lambda: text(GUEST5, "hi"), lambda: tap(GUEST5, "book"), lambda: tap(GUEST5, "when:later"),
             lambda: text(GUEST5, "tomorrow 12:00"), lambda: tap(GUEST5, "from:farm"), lambda: text(GUEST5, "sabie"),
             lambda: tap(GUEST5, "place:yes"), lambda: text(GUEST5, "Max"), lambda: tap(GUEST5, "quote:confirm")):
    step()
trip5 = trip_row()
T.allocate_driver(trip5["id"], 1, "board")
tap(GUEST5, "guest:pay:now")
ref5 = trip_row(trip5["ref"])["payment_ref"]
paystack_state = {}
paystack.verify_transaction = lambda settings, reference: {
    "reference": reference, "amount": 32000, "currency": "ZAR", "metadata": {"tripId": trip5["id"], "purpose": "fare"},
    **paystack_state}


def who(msgs):
    return {to(m) for m in msgs}


# failed card, found by the scheduler's check
paystack_state.update(status="failed", gateway_response="Declined")
start = len(sent)
report = scheduler.tick()
new = sent[start:]
g = [m for m in new if to(m) == GUEST5]
check(trip5["ref"] in report.get("paymentsFailed", []), "scheduler finds the declined payment")
check(any("did not go through (Declined)" in body_of(m) and buttons(m) == ["guest:pay:now"] for m in g),
      "failed: guest told why, with Try again only")
check(any("did not go through" in body_of(m) for m in new if to(m) == DRIVER), "failed: driver told")
check(any("failed: Declined" in body_of(m) for m in new if to(m) == OPS), "failed: Anneli told with the reason")
start = len(sent)
scheduler.tick()
check(not [m for m in sent[start:] if to(m) == GUEST5], "the same failure is reported only once")

# guest retries, then taps Cancel on Paystack's page
tap(GUEST5, "guest:pay:now")
ref5b = trip_row(trip5["ref"])["payment_ref"]
paystack_state.update(status="abandoned", gateway_response=None)
start = len(sent)
res = client.get("/payments/paystack/callback", params={"reference": ref5b, "cancelled": "1"})
new = sent[start:]
check(res.status_code == 200 and "Payment cancelled" in res.text, "cancel lands on a 'Payment cancelled' page")
check(any("You closed the payment page without paying - nothing was taken" in body_of(m)
          and "is still confirmed" in body_of(m) and "guest:pay:now" in buttons(m) for m in new if to(m) == GUEST5),
      "cancelled: guest told the booking still stands, with Pay now")
check(any("is still on - the guest closed the payment page" in body_of(m) for m in new if to(m) == DRIVER), "cancelled: driver told")
check(any("cancelled the R 320 fare payment" in body_of(m) for m in new if to(m) == OPS), "cancelled: Anneli told")

# the guest pays; the webhook never arrives, the scheduler's check finds it
tap(GUEST5, "guest:pay:now")
paystack_state.update(status="success", gateway_response="Approved")
start = len(sent)
report = scheduler.tick()
new = sent[start:]
check(trip_row(trip5["ref"])["captured_at"] is not None and trip5["ref"] in report.get("paymentsFound", []),
      "a success whose webhook went missing is found and marks the trip paid")
check(any("Payment of R 320 received" in body_of(m) for m in new if to(m) == GUEST5), "paid: guest told")
check(any("has paid the R 320 fare by card. No cash to collect" in body_of(m) for m in new if to(m) == DRIVER), "paid: driver told")
check(any("R 320 paid by card" in body_of(m) for m in new if to(m) == OPS), "paid: Anneli told")
T.cancel_trip(trip5["id"], "ops", "test cleanup")

# ── 6e. the driver starts the ride ───────────────────────────────────────────
print("6e. driver taps Ride started")
GUEST6 = "+27000000008"
for step in (lambda: text(GUEST6, "hi"), lambda: tap(GUEST6, "book"), lambda: tap(GUEST6, "when:later"),
             lambda: text(GUEST6, "tomorrow 13:00"), lambda: tap(GUEST6, "from:farm"), lambda: text(GUEST6, "graskop"),
             lambda: tap(GUEST6, "place:yes"), lambda: text(GUEST6, "Ria"), lambda: tap(GUEST6, "quote:confirm")):
    step()
trip6 = trip_row()
T.allocate_driver(trip6["id"], 1, "board")
template_tap(DRIVER, "I have left")
out = tap(DRIVER, "driver:arrived")
check(not any(buttons(m) for m in out if to(m) == DRIVER)
      and any("once they confirm they can see you" in body_of(m) for m in out if to(m) == DRIVER),
      "after arriving the driver waits for the guest - no Ride started yet")
# the guest gets in without tapping "Yes, I can see him": a typed "Ride started" still starts it
out = text(DRIVER, "Ride started")
check(trip_row(trip6["ref"])["status"] == "in_progress", "Ride started puts the trip in progress")
started = next((m for m in out if to(m) == GUEST6), None)
check(started is not None and started["type"] == "template" and started["template"]["name"] == "kn_guest_ride_started",
      "the guest is told the ride has started")
check(any(m["type"] == "template" and m["template"]["name"] == "kn_ops_trip_started" for m in out if to(m) == OPS), "Anneli gets trip started")
check(not any("driver:complete" in buttons(m) for m in out if to(m) == DRIVER), "unpaid: no Ride complete yet for the driver")
check(not any(m.get("interactive", {}).get("type") == "cta_url" for m in out if to(m) == GUEST6), "unpaid: no payment link at the start")
out = tap(DRIVER, "driver:started", "Ride started")
check(any("already started" in body_of(m) for m in out) and not any(buttons(m) for m in out) and not any(to(m) == GUEST6 for m in out),
      "a second tap does not start it again, and sends no button")
out = template_tap(GUEST6, "Yes, I can see him")
check(trip_row(trip6["ref"])["status"] == "in_progress" and not any(to(m) == DRIVER for m in out),
      "the guest's late 'I can see him' changes nothing - no Ride started for the driver")
out = T.payment_received({"status": "success", "reference": "ref-6", "amount": 30000, "metadata": {"tripId": trip6["id"], "purpose": "fare"}})
d6 = [m for m in sent if to(m) == DRIVER][-1]
check("has paid the R 300 fare by card" in body_of(d6) and not buttons(d6), "paid on the road: the driver is told, Ride complete waits for the destination")
out = tap(DRIVER, "driver:reached", "Reached destination")
check(any(buttons(m) == ["driver:complete"] for m in out if to(m) == DRIVER) and not any(to(m) == GUEST6 for m in out),
      "already paid: Reached destination brings Ride complete, nothing for the guest to pay")
out = tap(DRIVER, "driver:complete")
check(trip_row(trip6["ref"])["status"] == "completed", "once paid, Ride complete closes the trip")

# while kn_guest_ride_started is in review, the guest gets the same news as a plain message
text(GUEST6, "hi"); tap(GUEST6, "book"); tap(GUEST6, "when:later"); text(GUEST6, "tomorrow 15:00")
tap(GUEST6, "from:farm"); text(GUEST6, "sabie"); tap(GUEST6, "place:yes"); text(GUEST6, "Ria"); tap(GUEST6, "quote:confirm")
trip7 = trip_row()
T.allocate_driver(trip7["id"], 1, "board")
template_tap(DRIVER, "I have left")
tap(DRIVER, "driver:arrived")


def _pending_ride_started(payload, trip_id=None):
    if payload.get("type") == "template" and payload["template"]["name"] == "kn_guest_ride_started":
        raise wa.WhatsAppError("(#132001) Template name does not exist in the translation", 404)
    return _real_send(payload, trip_id)


wa._send = _pending_ride_started
out = tap(DRIVER, "driver:started", "Ride started")
wa._send = _real_send
check(any(m["type"] == "text" and "Your ride with Thabo Nkosi has started" in body_of(m) for m in out if to(m) == GUEST6),
      "template still in review: guest gets 'Your ride has started' as a plain message")
T.cancel_trip(trip7["id"], "ops", "test cleanup")

# ── 6f. no dead ends: every stopping point offers the next tap ───────────────
print("6f. interactive at every step")
GUEST7 = "+27000000009"
text(GUEST7, "hi"); tap(GUEST7, "book"); tap(GUEST7, "when:now"); tap(GUEST7, "from:farm")
out = text(GUEST7, "zzzz nowhere")
check(out[-1]["interactive"]["type"] == "location_request_message", "place not found: Send location offered with the retry")
text(GUEST7, "hazyview"); tap(GUEST7, "place:yes"); text(GUEST7, "Zed")
out = tap(GUEST7, "quote:confirm")
sent_msg = next(m for m in out if to(m) == GUEST7)
check(buttons(sent_msg) == ["guest:cancel"], "request sent: Cancel the request button")
out = text(GUEST7, "ok thanks")
check(buttons(out[-1]) == ["guest:cancel"], "waiting on Anneli: a stray message gets Cancel the request")
out = tap(GUEST7, "guest:cancel", "Cancel the request", context=out[-1]["_id"])
check(buttons(out[-1]) == ["cancel:yes", "cancel:no"], "Cancel the request asks to confirm")
out = tap(GUEST7, "cancel:yes")
check(any(buttons(m) == ["book"] for m in out if to(m) == GUEST7), "cancelled: Book a car button")
out = tap(GUEST7, "book")
check("When do you need the car?" in body_of(out[-1]), "Book a car starts a fresh booking")
# on the day: not yet -> the retry button is right there
tap(GUEST7, "when:now"); tap(GUEST7, "from:farm"); text(GUEST7, "hazyview"); tap(GUEST7, "place:yes"); text(GUEST7, "Zed")
tap(GUEST7, "quote:confirm")
trip8 = trip_row()
T.allocate_driver(trip8["id"], 1, "board")
template_tap(DRIVER, "I have left")
tap(DRIVER, "driver:arrived")
out = template_tap(GUEST7, "Not yet")
check(any(buttons(m) == ["guest:can_see"] for m in out if to(m) == GUEST7), "'Not yet' comes with a Yes, I can see him button")
out = tap(GUEST7, "guest:can_see", "Yes, I can see him")
check(trip_row(trip8["ref"])["status"] == "driver_waiting" and any(buttons(m) == ["driver:started"] for m in out if to(m) == DRIVER),
      "that button tells the driver, who gets Ride started")
T.cancel_trip(trip8["id"], "ops", "test cleanup")

plain = sorted({body_of(m).split("\n")[0][:70] for m in sent if m["type"] == "text" and to(m).startswith("+2700000000")
                and to(m) not in (OPS, DRIVER)})
print("  guest messages without buttons (for review):")
for p in plain:
    print("     -", p)

# ── 6g. preset places ────────────────────────────────────────────────────────
print("6g. preset pickup and drop-off places")
GUEST8 = "+27000000010"
text(GUEST8, "hi"); tap(GUEST8, "book"); tap(GUEST8, "when:now")
# collected at the airport: the pin, then the same drop-off list as the pickup
out = pick(GUEST8, "from:preset:airport", "Kruger Intl Airport")
pin = next((m for m in out if m["type"] == "location"), None)
check(pin is not None and pin["location"]["name"] == "Kruger Mpumalanga International Airport"
      and abs(pin["location"]["latitude"] + 25.3832) < 0.001, "picking the airport sends its map pin")
check(out[-1]["interactive"]["type"] == "list"
      and body_of(out[-1]).startswith("We will collect you at Kruger Mpumalanga International Airport.\nWhere are you going?")
      and " km" not in body_of(out[-1]), "pickup away from the farm: the drop-off pick-list, no distance")
check({"to:farm", "to:preset:perrys", "to:preset:lowveld", "to:location", "to:other"} <= set(rows(out[-1]))
      and "to:preset:airport" not in rows(out[-1]), "drop-off list: the farm and the other places, not the pickup")
out = pick(GUEST8, "to:farm", "Kanaan Guest Farm")
check(buttons(out[-1]) == ["place:yes", "place:no"] and not any(m["type"] == "location" for m in out),
      "airport pickup confirmed (not refused for distance), pin not sent twice")
tap(GUEST8, "place:no")
# between two places, neither the farm: airport -> Perry's Bridge
out = pick(GUEST8, "from:preset:airport", "Kruger Intl Airport")
out = pick(GUEST8, "to:preset:perrys", "Perry's Bridge")
from app.bot.places import distance_between as _between  # noqa: E402
_leg = _between(-25.3832, 31.1056, -25.0360270, 31.1248174)["distanceKm"]
check("Perry's Bridge Trading Post, Hazyview" in body_of(out[-1]) and f"{_leg:g} km" in body_of(out[-1]),
      f"airport -> Perry's Bridge: confirmed with the drive between them ({_leg} km), not from the farm")
tap(GUEST8, "place:yes")
out = text(GUEST8, "Pat Lee")
from app.bot.settings_store import js_round as _js_round  # noqa: E402
_expected = max(20, _js_round(5 + 8.3 * _leg))
check("Kruger Mpumalanga International Airport to Perry's Bridge Trading Post, Hazyview" in body_of(out[-1])
      and f"Fare: R {_expected}\n" in body_of(out[-1]),
      f"quote: airport to Perry's Bridge, R {_expected} on the {_leg} km between them")
start = len(sent)
out = tap(GUEST8, "quote:confirm")
trip_p2p = trip_row()
check(trip_p2p["pickup_name"] == "Kruger Mpumalanga International Airport" and trip_p2p["place_name"] == "Perry's Bridge Trading Post, Hazyview",
      "trip stores both points")
card = next(m for m in sent[start:] if to(m) == OPS)
check("collect from Kruger Mpumalanga International Airport" in body_of(card) or
      any("collect from Kruger Mpumalanga International Airport" in p.get("text", "") for c_ in card["template"].get("components", [])
          for p in c_.get("parameters", [])), "Anneli's card shows where to collect")
start = len(sent)
T.allocate_driver(trip_p2p["id"], 1, "board")
pins = [m for m in sent[start:] if to(m) == DRIVER and m["type"] == "location"]
check(len(pins) == 1 and "Pickup: Kruger" in pins[0]["location"]["name"], "the driver gets a pin for the pickup only, not the drop-off")
T.cancel_trip(trip_p2p["id"], "ops", "test cleanup")
text(GUEST8, "hi"); tap(GUEST8, "book"); tap(GUEST8, "when:now")
out = pick(GUEST8, "from:farm", "Kanaan Guest Farm")
check(out[-1]["interactive"]["type"] == "list" and "to:farm" not in rows(out[-1])
      and {"to:preset:perrys", "to:preset:lowveld", "to:preset:airport", "to:location", "to:other"} <= set(rows(out[-1])),
      "collected at the farm: every preset offered as destination, not the farm")
out = pick(GUEST8, "to:other", "Somewhere else")
check(out[-1]["interactive"]["type"] == "location_request_message", "Somewhere else: type it or drop a pin")
out = pick(GUEST8, "to:location", "Share my location")
check(out[-1]["interactive"]["type"] == "location_request_message", "Share my location opens the location picker")
out = pick(GUEST8, "to:preset:lowveld", "Lowveld Mall (Engen)")
pin = next((m for m in out if m["type"] == "location"), None)
check(pin is not None and pin["location"]["name"] == "Lowveld Mall (Engen), Hazyview" and "Is this the right spot?" in body_of(out[-1]),
      "Lowveld Mall (Engen): pin shown, then 'Is this the right spot?'")
tap(GUEST8, "place:no")
out = pick(GUEST8, "to:preset:perrys", "Perry's Bridge")
check("Perry's Bridge Trading Post, Hazyview" in body_of(out[-1]), "Perry's Bridge picked as destination")
tap(GUEST8, "place:yes")
out = text(GUEST8, "Ana")
check("The farm gate to Perry's Bridge Trading Post, Hazyview" in body_of(out[-1]), "the quote names the preset place")
check("about 5 minutes" in body_of(out[-1]) and "Fare: R 20\n" in body_of(out[-1]),
      "short hop: quote shows the minutes and the R 20 minimum fare")

# One rate: base R5 + R8.30/km, minimum R20, to the whole rand
from app.bot.settings_store import fare_for as _fare, fixed_fares as _fixed, load_settings as _ls  # noqa: E402
_s = _ls()
check(_fare(16, _s) == 138, "16 km: R5 + R132.80 = R137.80 -> R138")
check(_fare(16.6, _s) == 143, "Phabeni Gate 16.6 km: R143")
check(_fare(1.5, _s) == 20, "1.5 km: R20 minimum")
check(_fare(49, _s) == 412, "airport by formula, 49 km: R412")
check(_fare(49, _s, fixed_fare=750) == 750, "a fixed price wins over the formula")
check(_fixed() == {"airport": 750.0}, "fixed prices read from the backend setting; malformed entries skipped")

# a fixed price is used, and shown only at the quote
GUEST9 = "+27000000011"
text(GUEST9, "hi"); tap(GUEST9, "book")
out = tap(GUEST9, "when:now")
check(not any("R " in r.get("description", "") + r.get("title", "") for m in out if m.get("interactive", {}).get("type") == "list"
              for s_ in m["interactive"]["action"]["sections"] for r in s_["rows"]), "the pick-list shows no prices")
pick(GUEST9, "from:preset:airport", "Kruger Intl Airport")
tap(GUEST9, "to:farm", "Kanaan Guest Farm")
tap(GUEST9, "place:yes")
out = text(GUEST9, "Jo Doe")
check("Fare: R 750\n" in body_of(out[-1]), "airport with a fixed price: the quote shows R 750")
text(GUEST9, "cancel")
text(GUEST8, "cancel")

# ── 6h. simultaneous taps (the KN-1012 case) ─────────────────────────────────
print("6h. taps that land at the same moment act once")
import threading  # noqa: E402

GUEST10 = "+27000000012"
for step in (lambda: text(GUEST10, "hi"), lambda: tap(GUEST10, "book"), lambda: tap(GUEST10, "when:now"),
             lambda: tap(GUEST10, "from:farm"), lambda: text(GUEST10, "hazyview"), lambda: tap(GUEST10, "place:yes"),
             lambda: text(GUEST10, "Kai Moe")):
    step()
# "Send request" tapped twice at once: one trip
before = trip_row()["id"]
start = len(sent)
threads = [threading.Thread(target=tap, args=(GUEST10, "quote:confirm")) for _ in range(2)]
[t_.start() for t_ in threads]; [t_.join() for t_ in threads]
with hub_db.begin() as c:
    from sqlalchemy import text as sql
    made = c.execute(sql("select count(*) from trips where guest_phone = :p and id > :i"), {"p": GUEST10, "i": before}).scalar()
check(made == 1, f"double-tapped Send request creates one trip (made {made})")
trip11 = trip_row()
T.allocate_driver(trip11["id"], 1, "board")
template_tap(DRIVER, "I have left")
arr = tap(DRIVER, "driver:arrived")
arrived_card = next(m for m in arr if to(m) == GUEST10)
check(not any(buttons(m) for m in arr if to(m) == DRIVER), "arrived: no Ride started for the driver yet")


def together(*calls):
    """Runs the calls at the same instant; returns everything sent meanwhile."""
    start = len(sent)
    threads = [threading.Thread(target=fn, args=args, kwargs=kw) for fn, args, kw in calls]
    [t_.start() for t_ in threads]; [t_.join() for t_ in threads]
    return sent[start:]


# guest "Yes, I can see him" double-tapped
new = together(*[(template_tap, (GUEST10, "Yes, I can see him"), {"context": arrived_card["_id"]})] * 2)
started_prompts = [m for m in new if to(m) == DRIVER and buttons(m) == ["driver:started"]]
check(len(started_prompts) == 1, "'Yes, I can see him' double-tapped: the driver gets ONE Ride started")
# "Ride started" double-tapped
new = together(*[(tap, (DRIVER, "driver:started", "Ride started"), {"context": started_prompts[0]["_id"]})] * 2)
check(trip_row(trip11["ref"])["status"] == "in_progress", "the ride is started")
check(sum(1 for m in new if to(m) == OPS and m["type"] == "template" and m["template"]["name"] == "kn_ops_trip_started") == 1,
      "Anneli gets ONE trip-started card")
reached_prompts = [m for m in new if to(m) == DRIVER and buttons(m)]
check([buttons(m) for m in reached_prompts] == [["driver:reached"]], "the driver gets ONE Reached destination, and no other button")
check(not any(to(m) == GUEST10 and m.get("interactive", {}).get("type") == "cta_url" for m in new), "no payment link at the start")
# unpaid: "Reached destination" double-tapped
new = together(*[(tap, (DRIVER, "driver:reached", "Reached destination"), {"context": reached_prompts[0]["_id"]})] * 2)
check(sum(1 for m in new if to(m) == GUEST10 and m.get("interactive", {}).get("type") == "cta_url") == 1,
      "Reached destination double-tapped: the guest gets ONE Pay now link")
check(not any("driver:complete" in buttons(m) for m in new if to(m) == DRIVER), "no Ride complete before payment")
# paid, then "Ride complete" double-tapped
start = len(sent)
T.payment_received({"status": "success", "reference": "ref-11", "amount": 5000, "metadata": {"tripId": trip11["id"], "purpose": "fare"}})
complete_prompts = [m for m in sent[start:] if to(m) == DRIVER and buttons(m) == ["driver:complete"]]
check(len(complete_prompts) == 1, "paid: the driver gets ONE Ride complete prompt")
new = together(*[(tap, (DRIVER, "driver:complete", "Ride complete"), {"context": complete_prompts[0]["_id"]})] * 2)
check(trip_row(trip11["ref"])["status"] == "completed", "double-tapped Ride complete closes the trip")
check(sum(1 for m in new if to(m) == GUEST10 and m.get("interactive", {}).get("type") == "list") == 1, "ONE review request")
check(sum(1 for m in new if to(m) == OPS and m["type"] == "template") == 1, "Anneli gets ONE trip-closed card")
out = tap(DRIVER, "driver:complete", "Ride complete", context=complete_prompts[0]["_id"])
check(any("is already closed" in body_of(m) for m in out), "a later tap on the closed trip: 'already closed'")

# "Reached destination" and the guest's payment landing together, repeated: exactly one
# "Ride complete", it is the driver's last question, and it works
bad_orders = 0
for n in range(8):
    for step in (lambda: text(GUEST10, "hi"), lambda: tap(GUEST10, "book"), lambda: tap(GUEST10, "when:now"),
                 lambda: tap(GUEST10, "from:farm"), lambda: text(GUEST10, "hazyview"), lambda: tap(GUEST10, "place:yes"),
                 lambda: text(GUEST10, "Kai Moe"), lambda: tap(GUEST10, "quote:confirm")):
        step()
    t_n = trip_row()
    T.allocate_driver(t_n["id"], 1, "board")
    template_tap(DRIVER, "I have left")
    arr = tap(DRIVER, "driver:arrived")
    see = template_tap(GUEST10, "Yes, I can see him", context=next(m for m in arr if to(m) == GUEST10)["_id"])
    go = tap(DRIVER, "driver:started", "Ride started", context=next(m for m in see if to(m) == DRIVER and buttons(m))["_id"])
    reach_n = next(m for m in go if to(m) == DRIVER and buttons(m) == ["driver:reached"])
    paid = {"status": "success", "reference": f"ref-race-{n}", "amount": 5000, "metadata": {"tripId": t_n["id"], "purpose": "fare"}}
    new = together((tap, (DRIVER, "driver:reached", "Reached destination"), {"context": reach_n["_id"]}),
                   (T.payment_received, (paid,), {}))
    prompts = [m for m in new if to(m) == DRIVER and buttons(m)]
    if [buttons(m) for m in prompts] != [["driver:complete"]]:
        bad_orders += 1
    last = prompts[-1] if prompts else None
    tap(DRIVER, "driver:complete", "Ride complete", context=last["_id"] if last else None)
    if trip_row(t_n["ref"])["status"] != "completed":
        bad_orders += 1
check(bad_orders == 0, f"8 times 'Reached destination' + the guest's payment at the same instant: exactly one 'Ride complete', and it works ({bad_orders} bad)")

# ── 6i. buttons on an earlier question are dead ──────────────────────────────
print("6i. old buttons are refused, the current question is sent again")
GUEST11 = "+27000000013"
out = text(GUEST11, "hi")
first = out[-1]
out = tap(GUEST11, "book", "Book a car", context=first["_id"])
when_q = out[-1]
out = tap(GUEST11, "when:now", "Now", context=when_q["_id"])
pickup_q = out[-1]
start = len(sent)
out = tap(GUEST11, "when:later", "Pick a day and time", context=when_q["_id"])   # the "When?" question again
check(any("earlier message and can no longer be used" in body_of(m) for m in out)
      and rows(out[-1]) == PICKUP_ROWS, "tap on an old question: refused, and the current (pickup) question sent again")
with hub_db.begin() as c:
    from sqlalchemy import text as sql
    step = c.execute(sql("select step from wa_conversations where phone = :p"), {"p": GUEST11}).scalar()
check(step == "awaiting_from", "the booking did not move on the old tap")
out = pick(GUEST11, "from:farm", "Kanaan Guest Farm")   # no context: typed-style taps still work
check("Where are you going?" in body_of(out[-1]), "the current question still works")
text(GUEST11, "cancel")

# ── 6j. a follow-up waits for its template's delivery receipt ────────────────
print("6j. a message that must follow a template waits for the template's delivery receipt")
tpl = next(m for m in reversed(sent) if m["type"] == "template")


def receipt(wamid, status, delay):
    """Meta's status webhook for an outbound message, after `delay` seconds."""
    time.sleep(delay)
    body = json.dumps({"object": "whatsapp_business_account", "entry": [{"id": "1", "changes": [{"field": "messages", "value": {
        "messaging_product": "whatsapp", "metadata": {"display_phone_number": "27642116345", "phone_number_id": PHONE_ID},
        "statuses": [{"id": wamid, "status": status, "timestamp": str(int(time.time())), "recipient_id": "27000000003"}]}}]}]}).encode()
    sig = "sha256=" + hmac.new(SECRET.encode(), body, hashlib.sha256).hexdigest()
    client.post("/webhook", content=body, headers={"X-Hub-Signature-256": sig, "Content-Type": "application/json"})


wa.capture = None  # await_delivery waits only on a live line; nothing is sent while it is off
try:
    t0 = time.monotonic()
    th = threading.Thread(target=receipt, args=(tpl["_id"], "delivered", 0.8))
    th.start()
    wa.await_delivery(tpl["_id"], timeout=5)
    waited = time.monotonic() - t0
    th.join()
    check(0.7 <= waited < 3, f"waits for Meta's 'delivered' receipt, then carries on ({waited:.1f}s)")
    t0 = time.monotonic()
    wa.await_delivery("wamid.never-delivered", timeout=1)
    waited = time.monotonic() - t0
    check(1 <= waited < 2, f"no receipt (phone offline): carries on after the cap ({waited:.1f}s)")
finally:
    wa.capture = sent

# ── 7. the date/time picker (WhatsApp Flow) ──────────────────────────────────
print("7. date and time picker")
from app.bot.when import SAST  # noqa: E402


def flow_done(phone, date, hour=None, minute=None, time_=None):
    answer = {"date": date, "flow_token": "x", **({"time": time_} if time_ else {"hour": hour, "minute": minute})}
    return post(phone, {"type": "interactive", "interactive": {"type": "nfm_reply", "nfm_reply": {
        "name": "flow", "body": "Sent", "response_json": json.dumps(answer)}}})


GUEST3 = "+27000000005"
text(GUEST3, "hi")
tap(GUEST3, "book")
out = tap(GUEST3, "when:later")
opened = out[-1]["interactive"] if out and out[-1]["type"] == "interactive" else {}
params = opened.get("action", {}).get("parameters", {})
data = params.get("flow_action_payload", {}).get("data", {})
today = hub_db.now().astimezone(SAST).date()
check(opened.get("type") == "flow" and params.get("flow_id") == "test-flow" and params.get("flow_cta") == "Choose day and time",
      "Pick a day and time opens the calendar flow")
check(data.get("min_date") == today.isoformat() and data.get("max_date") == (today + timedelta(days=60)).isoformat(),
      "calendar runs from today to the booking limit")
hours = [o["id"] for o in data.get("hours", [])]
minutes = [o["id"] for o in data.get("minutes", [])]
check(hours[:1] == ["05"] and hours[-1:] == ["20"], f"hours offered {hours[:1]}..{hours[-1:]}")
check(minutes == [f"{m:02d}" for m in range(0, 60, 5)], "minutes offered 00, 05 ... 55")
out = flow_done(GUEST3, today.isoformat(), "05", "00")
past = hub_db.now().astimezone(SAST).hour >= 5
if past:
    check("already passed" in body_of(out[0]) and out[-1]["interactive"]["type"] == "flow", "a slot already gone today reopens the picker")
tomorrow = (today + timedelta(days=1)).isoformat()
out = flow_done(GUEST3, tomorrow, "10", "25")
check(rows(out[-1]) == PICKUP_ROWS, "confirmed date and time moves on to the pickup question")
tap(GUEST3, "from:farm")
text(GUEST3, "phabeni")
tap(GUEST3, "place:yes")
out = text(GUEST3, "Lee")
check("at 10:25" in body_of(out[-1]), "the quote shows the picked hour and minutes")
# a guest who still has the first version of the picker open (single "HH:MM" answer)
from app.bot import flows as _flows  # noqa: E402
check(_flows.picked_datetime({"date": tomorrow, "time": "14:00"}) is not None
      and _flows.picked_datetime({"date": tomorrow, "hour": "14", "minute": "45"}).minute == 45,
      "answers from both picker versions are understood")

unexpected = [r for r in bot_errors.records if "Template name does not exist" not in r.getMessage()]
for r in unexpected:
    print(f"  bot logged an error: {r.name}: {r.getMessage()}" + (f" ({r.exc_info[1]!r})" if r.exc_info else ""))
check(not unexpected, "no errors logged by the bot (every send and recording succeeded)")

print()
print("ALL PASSED" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
