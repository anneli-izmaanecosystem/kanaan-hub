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
import re
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
    # This service's public address, from which the Pay now consent page's link is made.
    "PAYSTACK_CALLBACK_URL": "https://kanaan.test/kanaan/payments/paystack/callback",
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


def code_for(phone):
    """The pickup code in the latest 'Driver Verification' message to this guest."""
    m = next((m for m in reversed(sent) if to(m) == phone and m["type"] == "text"
              and body_of(m).startswith("Driver Verification")), None)
    return re.search(r"\b(\d{6})\b", body_of(m)).group(1) if m else None


def read_out_code(guest, context=None):
    """The driver types the code the guest reads him."""
    return text(DRIVER, code_for(guest), context=context)


# ── 1. booking, pickup shared too far away, then within range ───────────────
print("1. guest books, pickup location too far, then within range")
out = text(GUEST, "hi")
check(buttons(out[-1]) == ["book"], "greeting offers Book a car")
out = tap(GUEST, "book")
check("When do you need the car?" in body_of(out[-1]), "asks when")
tap(GUEST, "when:later")
out = text(GUEST, "tomorrow 10:00")
check(buttons(out[-1]) == ["trip:day", "trip:one_way"] and "What kind of trip" in body_of(out[-1]),
      "time set: asks the trip type first - Day Trip / One Way Trip")
trips_before = trip_row()


def day_trips(phone=None):
    """The Day Trip Requests tab's data: (count, requests - for `phone` only if given)."""
    data = client.get("/dashboard/day-trips", headers={"X-Internal-Secret": "internal-test"}).json()
    return data["count"], [r for r in data["requests"] if phone is None or r["phone"] == phone]


out = tap(GUEST, "trip:day", "Day Trip")
check(body_of(out[-1]) == "What is your full name?" and day_trips(GUEST)[1] == [],
      "Day Trip from a new guest: their full name is asked - no request kept yet")
out = text(GUEST, "Sam Botha")
check(body_of(out[-1]).startswith("Day Trip Service – Coming Soon") and "currently unavailable" in body_of(out[-1])
      and buttons(out[-1]) == ["trip:one_way"], "Day Trip, then the name: coming soon, with One Way Trip to carry on")
check(not any(m.get("interactive", {}).get("type") == "list" for m in out) and not any("Fare" in body_of(m) for m in out),
      "Day Trip: no location list and no fare")
check(trip_row() == trips_before, "Day Trip: no trip created")
out = tap(GUEST, "trip:day", "Day Trip")  # tapped again for the same time
check(body_of(out[-1]).startswith("Day Trip Service – Coming Soon"), "Day Trip again: the name is not asked a second time")
_day_trips = day_trips(GUEST)[1]
check(len(_day_trips) == 1 and _day_trips[0]["guestName"] == "Sam Botha" and _day_trips[0]["leaveNow"] is False
      and _day_trips[0]["requestedFor"].endswith("T08:00:00.000Z"),
      "Day Trip: the request is kept for the admin portal - full name, number and the time chosen (10:00) - once, though tapped twice")
out = text(GUEST, "what?")
check(buttons(out[-1]) == ["trip:day", "trip:one_way"], "anything else at the trip type re-asks it")
out = tap(GUEST, "trip:one_way", "One Way Trip")
check(rows(out[-1]) == PICKUP_ROWS, "asks for pickup: farm, Perry's Bridge, Lowveld Mall, airport, my location, somewhere else")
from app.bot.conversation import load_conversation as _convo  # noqa: E402
check(_convo(GUEST).draft.get("tripType") == "ONE_WAY", "the chosen trip type is kept: ONE_WAY")
out = tap(GUEST, "from:location")
check(out[-1]["interactive"]["type"] == "location_request_message", "Send location opens the native location request")
out = location(GUEST, 19.0760, 72.8777)  # Mumbai
check("We can only book cars by chat within 50 km" in body_of(out[-1]) and buttons(out[-1]) == ["from:closer", "from:end"],
      "pickup past 50 km refused with Pick within 50 km / End")
out = tap(GUEST, "from:closer")
check(out[-1]["interactive"]["type"] == "location_request_message", "Pick within 50 km asks for the location again")
out = location(GUEST, -25.0450, 31.1250)  # Hazyview
check(not any(body_of(m).startswith("Estimated Driver Arrival") for m in out), "a booking for later: no driver arrival estimate")
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
pay_offer = next((m for m in out if to(m) == GUEST and buttons(m) == ["guest:pay:now", "guest:pay:later"]), None)
check(pay_offer is not None and guest_out.index(pay_offer) == 1,
      "then the fare, with Pay now and Pay later - offered only now, after acceptance")
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
from app.routers.payments import AGREED, PAYSTACK_PRIVACY_URL  # noqa: E402


def consent_path(msgs, guest):
    """The path of the page the guest's Pay now button opens."""
    url = next(m for m in msgs if to(m) == guest and m.get("interactive", {}).get("type") == "cta_url")["interactive"]["action"]["parameters"]["url"]
    return "/payments/pay/" + url.split("/payments/pay/", 1)[1] if "/payments/pay/" in url else url


link1 = next(m for m in out if m.get("interactive", {}).get("type") == "cta_url")["interactive"]["action"]["parameters"]["url"]
ref1 = trip_row(trip["ref"])["payment_ref"]
check(link1 == f"https://kanaan.test/kanaan/payments/pay/{ref1}", "Pay now opens this service's page first, not Paystack")
page = client.get(consent_path(out, GUEST))
check(page.status_code == 200 and PAYSTACK_PRIVACY_URL in page.text and "Privacy Policy" in page.text
      and ">Agree</button>" in page.text and f"R {float(trip['fare']):.2f}" in page.text,
      "the page shows Paystack's privacy policy, the amount and an Agree button")
res = client.post(consent_path(out, GUEST), follow_redirects=False)
with hub_db.begin() as c:
    from sqlalchemy import text as sql
    _agreed = c.execute(sql("select detail from trip_events where trip_id = :t and event = :e"), {"t": trip["id"], "e": AGREED}).scalars().all()
check(res.status_code == 303 and res.headers["location"].startswith("https://paystack.test/") and _agreed == [ref1],
      "Agree goes on to Paystack's payment page, and the agreement is noted on the trip")
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
check(code_for(GUEST) is not None and re.fullmatch(r"\d{6}", code_for(GUEST)), "the guest is sent a 6-digit verification code")
check(any("Guest Pickup Verification" in body_of(m) and not buttons(m) and code_for(GUEST) not in body_of(m) for m in out if to(m) == DRIVER),
      "the driver is asked to type the code - he is not sent it, and gets no Ride started yet")
out = read_out_code(GUEST)
check(any(buttons(m) == ["driver:started"] and body_of(m).startswith("Pickup Verified") for m in out if to(m) == DRIVER),
      "the right code: Pickup Verified, with Ride started")
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
tap(GUEST2, "trip:one_way")
out = tap(GUEST2, "from:farm")
check(not any(body_of(m).startswith("Estimated Driver Arrival") for m in out), "collected at the farm: no drive, so no arrival estimate")
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
tap(GUEST2, "trip:one_way")
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


def _pending_v2(payload, trip_id=None, redact=None):
    if payload.get("type") == "template" and payload["template"]["name"] == "kn_driver_new_trip_v2":
        raise wa.WhatsAppError("(#132001) Template name does not exist in the translation", 404)
    return _real_send(payload, trip_id, redact)


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


def _pending_new(payload, trip_id=None, redact=None):
    if payload.get("type") == "template" and payload["template"]["name"] in NEW_PENDING:
        raise wa.WhatsAppError("(#132001) Template name does not exist in the translation", 404)
    return _real_send(payload, trip_id, redact)


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
             lambda: text(GUEST4, "tomorrow 11:00"), lambda: tap(GUEST4, "trip:one_way"), lambda: tap(GUEST4, "from:farm"), lambda: text(GUEST4, "numbi"),
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
read_out_code(GUEST4)
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
             lambda: text(GUEST5, "tomorrow 12:00"), lambda: tap(GUEST5, "trip:one_way"), lambda: tap(GUEST5, "from:farm"), lambda: text(GUEST5, "sabie"),
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
check(any("did not go through (Declined)" in body_of(m) and buttons(m) == ["guest:pay:now", "guest:pay:later"] for m in g),
      "failed: guest told why, with Try again and Pay later")
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
check(any("has paid the R 320 fare by card via Paystack. Nothing to collect" in body_of(m) for m in new if to(m) == DRIVER), "paid: driver told")
check(any("R 320 paid by card" in body_of(m) for m in new if to(m) == OPS), "paid: Anneli told")
T.cancel_trip(trip5["id"], "ops", "test cleanup")

# ── 6e. the driver starts the ride ───────────────────────────────────────────
print("6e. driver taps Ride started")
GUEST6 = "+27000000008"
for step in (lambda: text(GUEST6, "hi"), lambda: tap(GUEST6, "book"), lambda: tap(GUEST6, "when:later"),
             lambda: text(GUEST6, "tomorrow 13:00"), lambda: tap(GUEST6, "trip:one_way"), lambda: tap(GUEST6, "from:farm"), lambda: text(GUEST6, "graskop"),
             lambda: tap(GUEST6, "place:yes"), lambda: text(GUEST6, "Ria"), lambda: tap(GUEST6, "quote:confirm")):
    step()
trip6 = trip_row()
T.allocate_driver(trip6["id"], 1, "board")
template_tap(DRIVER, "I have left")
out = tap(DRIVER, "driver:arrived")
check(not any(buttons(m) for m in out if to(m) == DRIVER)
      and any("they get a 6-digit verification code" in body_of(m) for m in out if to(m) == DRIVER),
      "after arriving the driver waits for the guest and their code - no Ride started yet")
# no way round the code: a typed "Ride started" before the guest confirms, or before the code
out = text(DRIVER, "Ride started")
check(trip_row(trip6["ref"])["status"] == "driver_waiting" and not any(to(m) == GUEST6 for m in out),
      "the guest has not confirmed: a typed Ride started does not start the ride")
template_tap(GUEST6, "Yes, I can see him")
out = text(DRIVER, "Ride started")
check(trip_row(trip6["ref"])["status"] == "driver_waiting" and any("verification code" in body_of(m) for m in out if to(m) == DRIVER),
      "code sent but not typed: Ride started is still refused, and the driver is told to type the code")
read_out_code(GUEST6)
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
tap(GUEST6, "trip:one_way"); tap(GUEST6, "from:farm"); text(GUEST6, "sabie"); tap(GUEST6, "place:yes"); text(GUEST6, "Ria"); tap(GUEST6, "quote:confirm")
trip7 = trip_row()
T.allocate_driver(trip7["id"], 1, "board")
template_tap(DRIVER, "I have left")
tap(DRIVER, "driver:arrived")
template_tap(GUEST6, "Yes, I can see him")
read_out_code(GUEST6)


def _pending_ride_started(payload, trip_id=None, redact=None):
    if payload.get("type") == "template" and payload["template"]["name"] == "kn_guest_ride_started":
        raise wa.WhatsAppError("(#132001) Template name does not exist in the translation", 404)
    return _real_send(payload, trip_id, redact)


wa._send = _pending_ride_started
out = tap(DRIVER, "driver:started", "Ride started")
wa._send = _real_send
check(any(m["type"] == "text" and "Your ride with Thabo Nkosi has started" in body_of(m) for m in out if to(m) == GUEST6),
      "template still in review: guest gets 'Your ride has started' as a plain message")
T.cancel_trip(trip7["id"], "ops", "test cleanup")

# ── 6f. no dead ends: every stopping point offers the next tap ───────────────
print("6f. interactive at every step")
GUEST7 = "+27000000009"
text(GUEST7, "hi"); tap(GUEST7, "book"); tap(GUEST7, "when:now"); tap(GUEST7, "trip:one_way"); tap(GUEST7, "from:farm")
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
tap(GUEST7, "when:now"); tap(GUEST7, "trip:one_way"); tap(GUEST7, "from:farm"); text(GUEST7, "hazyview"); tap(GUEST7, "place:yes"); text(GUEST7, "Zed")
tap(GUEST7, "quote:confirm")
trip8 = trip_row()
T.allocate_driver(trip8["id"], 1, "board")
template_tap(DRIVER, "I have left")
tap(DRIVER, "driver:arrived")
out = template_tap(GUEST7, "Not yet")
check(any(buttons(m) == ["guest:can_see"] for m in out if to(m) == GUEST7), "'Not yet' comes with a Yes, I can see him button")
check(not any(body_of(m).startswith("Driver Verification") for m in out), "'Not yet': no verification code")
out = tap(GUEST7, "guest:can_see", "Yes, I can see him")
check(trip_row(trip8["ref"])["status"] == "driver_waiting" and any("Guest Pickup Verification" in body_of(m) for m in out if to(m) == DRIVER),
      "that button sends the guest a code, and the driver is asked to type it")
out = read_out_code(GUEST7)
check(any(buttons(m) == ["driver:started"] for m in out if to(m) == DRIVER), "the code matches: the driver gets Ride started")
T.cancel_trip(trip8["id"], "ops", "test cleanup")

plain = sorted({body_of(m).split("\n")[0][:70] for m in sent if m["type"] == "text" and to(m).startswith("+2700000000")
                and to(m) not in (OPS, DRIVER)})
print("  guest messages without buttons (for review):")
for p in plain:
    print("     -", p)

# ── 6g. preset places ────────────────────────────────────────────────────────
print("6g. preset pickup and drop-off places")
GUEST8 = "+27000000010"
text(GUEST8, "hi"); tap(GUEST8, "book"); tap(GUEST8, "when:now"); tap(GUEST8, "trip:one_way")
# collected at the airport: the pin, then the same drop-off list as the pickup
_t0 = hub_db.now()
out = pick(GUEST8, "from:preset:airport", "Kruger Intl Airport")
_t1 = hub_db.now()
from app.bot.when import estimated_arrival as _arrive, format_arrival as _fmt_arrival, format_duration as _fmt_dur  # noqa: E402
_mins = _convo(GUEST8).draft["from"]["durationMin"]
eta = next((m for m in out if m["type"] == "text" and body_of(m).startswith("Estimated Driver Arrival")), None)
_eta_texts = {f"Your driver is estimated to reach your pickup location at {_fmt_arrival(_arrive(_mins, t_), t_)}." for t_ in (_t0, _t1)}
check(eta is not None and any(e in body_of(eta) for e in _eta_texts) and f"Estimated travel time: {_fmt_dur(_mins)}." in body_of(eta),
      f"car wanted now, collected at the airport: arrival = South African time now + the {_mins}-minute drive")
check(eta is not None and out.index(eta) < len(out) - 1, "the estimate comes before the drop-off question")
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
text(GUEST8, "hi"); tap(GUEST8, "book"); tap(GUEST8, "when:now"); tap(GUEST8, "trip:one_way")
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

# Driver arrival: South African time + the drive, rolling over the hour, midnight and the year
from datetime import datetime as _dt, timezone as _tz  # noqa: E402
from app.bot.when import SAST as _SAST  # noqa: E402


def _sa_now(*fields):
    """The server's clock (UTC) at the moment Johannesburg reads `fields`."""
    return _dt(*fields, tzinfo=_SAST).astimezone(_tz.utc)


def _eta(minutes, *fields):
    return _fmt_arrival(_arrive(minutes, _sa_now(*fields)), _sa_now(*fields))


check(str(_SAST) == "Africa/Johannesburg", "times are South African: the IANA zone Africa/Johannesburg, not a fixed offset")
check(_eta(35, 2026, 10, 3, 14, 15) == "14:50 South Africa time", "14:15 + 35 minutes = 14:50 South Africa time")
check(_eta(80, 2026, 10, 3, 16, 40) == "18:00 South Africa time" and _fmt_dur(80) == "1 hour 20 minutes",
      "16:40 + 1 hour 20 minutes = 18:00 (across the hour)")
check(_eta(30, 2026, 10, 3, 14, 15) == "14:45 South Africa time" and _eta(30, 2026, 10, 3, 14, 20) == "14:50 South Africa time",
      "worked out from the time of asking: 14:15 -> 14:45, 14:20 -> 14:50")
check(_eta(35, 2026, 10, 3, 23, 40) == "00:15 on 4 October 2026 (South Africa time)", "23:40 + 35 minutes: 00:15 with the next day's date")
check(_eta(20, 2026, 12, 31, 23, 50) == "00:10 on 1 January 2027 (South Africa time)", "across the new year")
check(_fmt_dur(1) == "1 minute" and _fmt_dur(60) == "1 hour" and _fmt_dur(125) == "2 hours 5 minutes", "travel time in words")

# a fixed price is used, and shown only at the quote
GUEST9 = "+27000000011"
text(GUEST9, "hi"); tap(GUEST9, "book")
tap(GUEST9, "when:now")
out = tap(GUEST9, "trip:one_way")
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
             lambda: tap(GUEST10, "trip:one_way"), lambda: tap(GUEST10, "from:farm"), lambda: text(GUEST10, "hazyview"), lambda: tap(GUEST10, "place:yes"),
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
check(sum(1 for m in new if to(m) == GUEST10 and body_of(m).startswith("Driver Verification")) == 1
      and sum(1 for m in new if to(m) == DRIVER and "Guest Pickup Verification" in body_of(m)) == 1,
      "'Yes, I can see him' double-tapped: ONE code for the guest, the driver asked ONCE")
# the right code typed twice at the same instant: verified once, ONE Ride started
_c10 = code_for(GUEST10)
new = together(*[(text, (DRIVER, _c10), {})] * 2)
started_prompts = [m for m in new if to(m) == DRIVER and buttons(m) == ["driver:started"]]
with hub_db.begin() as c:
    from sqlalchemy import text as sql
    _verified = c.execute(sql("select count(*) from trip_events where trip_id = :t and event = 'pickup_verified'"), {"t": trip11["id"]}).scalar()
check(len(started_prompts) == 1 and _verified == 1, "the right code sent twice at once: verified once, the driver gets ONE Ride started")
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
                 lambda: tap(GUEST10, "trip:one_way"), lambda: tap(GUEST10, "from:farm"), lambda: text(GUEST10, "hazyview"), lambda: tap(GUEST10, "place:yes"),
                 lambda: text(GUEST10, "Kai Moe"), lambda: tap(GUEST10, "quote:confirm")):
        step()
    t_n = trip_row()
    T.allocate_driver(t_n["id"], 1, "board")
    template_tap(DRIVER, "I have left")
    arr = tap(DRIVER, "driver:arrived")
    template_tap(GUEST10, "Yes, I can see him", context=next(m for m in arr if to(m) == GUEST10)["_id"])
    see = read_out_code(GUEST10)
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
trip_q = out[-1]
out = tap(GUEST11, "trip:one_way", "One Way Trip", context=trip_q["_id"])
pickup_q = out[-1]
out = tap(GUEST11, "trip:day", "Day Trip", context=trip_q["_id"])   # the trip type question again
check(any("earlier message and can no longer be used" in body_of(m) for m in out) and rows(out[-1]) == PICKUP_ROWS,
      "Day Trip tapped on the old trip type question: refused, the pickup question sent again")
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
check(buttons(out[-1]) == ["trip:day", "trip:one_way"], "confirmed date and time moves on to the trip type")
out = tap(GUEST3, "trip:one_way", "One Way Trip")
check(rows(out[-1]) == PICKUP_ROWS, "One Way Trip moves on to the pickup question")
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

# ── 6k. the pickup verification code (OTP) ───────────────────────────────────
print("6k. pickup verification code")
from sqlalchemy import text as sql  # noqa: E402
from app.bot import pickup_code as PC  # noqa: E402

GUEST12, GUEST13 = "+27000000014", "+27000000015"


def arrived_trip(guest):
    """A trip booked now by `guest` from the farm, allocated to the test driver, who has arrived."""
    for step in (lambda: text(guest, "hi"), lambda: tap(guest, "book"), lambda: tap(guest, "when:now"),
                 lambda: tap(guest, "trip:one_way"), lambda: tap(guest, "from:farm"), lambda: text(guest, "hazyview"),
                 lambda: tap(guest, "place:yes"), lambda: text(guest, "Otto Guest"), lambda: tap(guest, "quote:confirm")):
        step()
    t_ = trip_row()
    T.allocate_driver(t_["id"], 1, "board")
    T.driver_left(t_["id"], T.get_driver(1))
    arrived_ = T.driver_arrived(t_["id"], T.get_driver(1))  # noqa: F841
    return trip_row(t_["ref"])


def events(trip_id, name):
    with hub_db.begin() as c:
        return c.execute(sql("select * from trip_events where trip_id = :t and event = :e order by id"), {"t": trip_id, "e": name}).mappings().all()


def expire_code(trip_id):
    """The trip's latest code, as if its 10 minutes were up."""
    row = events(trip_id, PC.SENT)[-1]
    detail = json.loads(row["detail"]); detail["expires"] = "2000-01-01T00:00:00.000Z"
    with hub_db.begin() as c:
        c.execute(sql("update trip_events set detail = :d where id = :i"), {"d": json.dumps(detail), "i": row["id"]})


def age_code(trip_id, seconds=120):
    """The trip's codes, as if sent `seconds` earlier (past the double-tap window, still valid)."""
    with hub_db.begin() as c:
        c.execute(sql("update trip_events set at = at - make_interval(secs => :s) where trip_id = :t and event = :e"),
                  {"s": seconds, "t": trip_id, "e": PC.SENT})


# A: the right code, end to end - and the code reaches the guest only, and no log keeps it
tA = arrived_trip(GUEST12)
start = len(sent)
out = template_tap(GUEST12, "Yes, I can see him")
cA = code_for(GUEST12)
check(cA is not None and re.fullmatch(r"\d{6}", cA) is not None, "A: 'Yes, I can see him' sends the guest a 6-digit code")
check(all(cA not in json.dumps(m) for m in sent[start:] if to(m) != GUEST12), "A: the code goes to that guest only - not the driver, not Anneli")
with hub_db.begin() as c:
    kept = c.execute(sql("select body, payload from wa_messages where phone = :p and body like 'Driver Verification%' order by id desc limit 1"),
                     {"p": GUEST12}).mappings().first()
check(kept is not None and cA not in kept["body"] and cA not in kept["payload"], "A: the message log keeps a masked copy, never the code")
check(all(cA not in (e["detail"] or "") for e in events(tA["id"], PC.SENT)), "A: the trip keeps an HMAC of the code, never the code")
check("valid until" in body_of(next(m for m in reversed(sent) if to(m) == GUEST12)) and "South Africa time" in body_of(
    next(m for m in reversed(sent) if to(m) == GUEST12)), "A: the code says until when it is valid, in South African time")
out = text(DRIVER, cA)
check(any(body_of(m).startswith("Pickup Verified") and buttons(m) == ["driver:started"] for m in out if to(m) == DRIVER)
      and len(events(tA["id"], PC.VERIFIED)) == 1, "A: the right code verifies the pickup; the driver gets Ride started")
with hub_db.begin() as c:
    typed = c.execute(sql("select body from wa_messages where phone = :p and direction = 'inbound' order by id desc limit 1"), {"p": DRIVER}).scalar()
check(typed == "[verification code]", "A: the code the driver typed is masked in the message log too")
out = text(DRIVER, cA)
check(any("already verified" in body_of(m) for m in out if to(m) == DRIVER) and not any(buttons(m) for m in out)
      and len(events(tA["id"], PC.VERIFIED)) == 1, "H: the right code again: 'already verified' - nothing runs twice")
out = tap(DRIVER, "driver:started", "Ride started")
check(trip_row(tA["ref"])["status"] == "in_progress", "A: Ride started then starts the ride, as before")
T.cancel_trip(tA["id"], "ops", "test cleanup")

# B: wrong codes - refused, counted, and after 5 the code is used up
tB = arrived_trip(GUEST12)
template_tap(GUEST12, "Yes, I can see him")
cB = code_for(GUEST12)
wrong = f"{(int(cB) + 1) % 1_000_000:06d}"
out = text(DRIVER, wrong)
check(any("Invalid verification code" in body_of(m) and "4 tries left" in body_of(m) for m in out if to(m) == DRIVER)
      and trip_row(tB["ref"])["status"] == "driver_waiting" and len(events(tB["id"], PC.WRONG)) == 1,
      "B: a wrong code is refused, the ride does not move, the try is counted")
out = text(DRIVER, "Ride started")
check(trip_row(tB["ref"])["status"] == "driver_waiting", "B: a typed Ride started does not get round it")
for _ in range(4):
    out = text(DRIVER, wrong)
check(any("maximum number of attempts" in body_of(m) for m in out if to(m) == DRIVER)
      and any(buttons(m) == ["guest:code:new"] for m in out if to(m) == GUEST12), "B: the 5th wrong code uses it up; the guest is offered a new one")
out = text(DRIVER, cB)
check(any("maximum number of attempts" in body_of(m) for m in out if to(m) == DRIVER) and not events(tB["id"], PC.VERIFIED),
      "B: once used up, even the right code is refused")
tap(GUEST12, "guest:code:new", "Send a new code")
cB2 = code_for(GUEST12)
check(len(events(tB["id"], PC.SENT)) == 2, "B: Send a new code sends a fresh code")
out = text(DRIVER, cB2)
check(any(body_of(m).startswith("Pickup Verified") for m in out if to(m) == DRIVER), "B: the new code works")
T.cancel_trip(tB["id"], "ops", "test cleanup")

# C: an expired code is refused; the guest can get a new one
tC = arrived_trip(GUEST12)
template_tap(GUEST12, "Yes, I can see him")
cC = code_for(GUEST12)
expire_code(tC["id"])
out = text(DRIVER, cC)
check(any("expired" in body_of(m) for m in out if to(m) == DRIVER) and not events(tC["id"], PC.VERIFIED)
      and any(buttons(m) == ["guest:code:new"] and "expired" in body_of(m) for m in out if to(m) == GUEST12),
      "C: the right code after 10 minutes is refused, and the guest is offered a new one")
template_tap(GUEST12, "Yes, I can see him")
check(len(events(tC["id"], PC.SENT)) == 2, "C: 'Yes, I can see him' again after expiry sends a new code")
out = read_out_code(GUEST12)
check(any(body_of(m).startswith("Pickup Verified") for m in out if to(m) == DRIVER), "C: and that one works")
T.cancel_trip(tC["id"], "ops", "test cleanup")

# D: the guest cannot see the driver - no code, no way to start
tD = arrived_trip(GUEST12)
out = template_tap(GUEST12, "Not yet")
check(not any(body_of(m).startswith("Driver Verification") for m in out) and not events(tD["id"], PC.SENT), "D: 'Not yet' sends no code")
out = text(DRIVER, "123456")
check(any("has not confirmed they can see you" in body_of(m) for m in out if to(m) == DRIVER) and not events(tD["id"], PC.VERIFIED),
      "D: a code typed before the guest confirmed verifies nothing")
out = text(DRIVER, "Ride started")
check(trip_row(tD["ref"])["status"] == "driver_waiting", "D: the pickup is not verified, so Ride started is refused")
T.cancel_trip(tD["id"], "ops", "test cleanup")

# E, F: two guests, two rides, one driver - each code works for its own ride only
tE1 = arrived_trip(GUEST12)
tE2 = arrived_trip(GUEST13)
out1 = template_tap(GUEST12, "Yes, I can see him")
c1 = code_for(GUEST12)
start = len(sent)
out2 = template_tap(GUEST13, "Yes, I can see him")
c2 = code_for(GUEST13)
check(all(c2 not in json.dumps(m) for m in sent[start:] if to(m) != GUEST13), "F: guest B's code goes to guest B only")
prompt1 = next(m for m in out1 if to(m) == DRIVER and "Guest Pickup Verification" in body_of(m))
prompt2 = next(m for m in out2 if to(m) == DRIVER and "Guest Pickup Verification" in body_of(m))
out = text(DRIVER, c1, context=prompt2["_id"])
check(any("Invalid verification code" in body_of(m) for m in out if to(m) == DRIVER)
      and not events(tE2["id"], PC.VERIFIED) and not events(tE1["id"], PC.VERIFIED), "E: ride A's code does not verify ride B")
_s1 = PC.check(T.events_for(tE1["id"]))
check(PC.matches(tE1["id"], _s1.stored, c1) and not PC.matches(tE2["id"], _s1.stored, c1), "E: a code is bound to its own trip")
out = text(DRIVER, c2, context=prompt2["_id"])
check(any(body_of(m).startswith("Pickup Verified") for m in out if to(m) == DRIVER)
      and events(tE2["id"], PC.VERIFIED) and not events(tE1["id"], PC.VERIFIED), "F: ride B's own code verifies ride B only")
out = text(DRIVER, c1, context=prompt1["_id"])
check(events(tE1["id"], PC.VERIFIED), "F: and ride A's own code verifies ride A")
T.cancel_trip(tE1["id"], "ops", "test cleanup")
T.cancel_trip(tE2["id"], "ops", "test cleanup")

# G: repeated taps - one arrival, no flood of codes, at most 3 codes a ride
tG = arrived_trip(GUEST12)
out = tap(DRIVER, "driver:arrived")
check(any("already marked as driver waiting" in body_of(m) for m in out) and len(events(tG["id"], "driver_arrived")) == 1,
      "G: I have arrived again: one arrival, nothing changes")
template_tap(GUEST12, "Yes, I can see him")
first_code = code_for(GUEST12)
out = template_tap(GUEST12, "Yes, I can see him")
check(len(events(tG["id"], PC.SENT)) == 1 and not any(to(m) == GUEST12 for m in out), "G: 'Yes' again straight away: no second code")
age_code(tG["id"])
out = template_tap(GUEST12, "Yes, I can see him")
check(len(events(tG["id"], PC.SENT)) == 1 and any(buttons(m) == ["guest:code:new"] and "valid until" in body_of(m) for m in out if to(m) == GUEST12),
      "G: 'Yes' again later: pointed back to the code that still works - no new one")
out = tap(GUEST12, "guest:code:new", "Send a new code")
check(len(events(tG["id"], PC.SENT)) == 2 and any("no longer works" in body_of(m) for m in out if to(m) == DRIVER),
      "G: Send a new code replaces it, and the driver is told")
out = text(DRIVER, first_code)
check(any("Invalid verification code" in body_of(m) for m in out if to(m) == DRIVER), "G: the replaced code no longer works")
tap(GUEST12, "guest:code:new", "Send a new code")
check(len(events(tG["id"], PC.SENT)) == 2, "G: Send a new code tapped straight away again changes nothing")
age_code(tG["id"]); tap(GUEST12, "guest:code:new", "Send a new code")
age_code(tG["id"]); out = tap(GUEST12, "guest:code:new", "Send a new code")
check(len(events(tG["id"], PC.SENT)) == 3 and any("cannot send another" in body_of(m) for m in out if to(m) == GUEST12),
      "G: at most 3 codes a ride")
T.cancel_trip(tG["id"], "ops", "test cleanup")

# ── 6l. Pay later: on the driver's card machine, or by Paystack link ────────
print("6l. pay later")
GUEST14, GUEST15 = "+27000000016", "+27000000017"


def booked_trip(guest):
    """A trip booked for tomorrow by `guest` from the farm, confirmed with the test driver.
    Returns the trip and what the confirmation sent."""
    for step in (lambda: text(guest, "hi"), lambda: tap(guest, "book"), lambda: tap(guest, "when:later"),
                 lambda: text(guest, "tomorrow 16:00"), lambda: tap(guest, "trip:one_way"), lambda: tap(guest, "from:farm"),
                 lambda: text(guest, "hazyview"), lambda: tap(guest, "place:yes"), lambda: text(guest, "Lee Guest"),
                 lambda: tap(guest, "quote:confirm")):
        step()
    t_ = trip_row()
    start = len(sent)
    T.allocate_driver(t_["id"], 1, "board")
    return trip_row(t_["ref"]), sent[start:]


def to_destination(guest):
    """The driver collects `guest` (code and all) and reaches the destination."""
    template_tap(DRIVER, "I have left")
    tap(DRIVER, "driver:arrived")
    template_tap(guest, "Yes, I can see him")
    read_out_code(guest)
    started_ = tap(DRIVER, "driver:started", "Ride started")
    return started_, tap(DRIVER, "driver:reached", "Reached destination")


def board_method(ref):
    res = client.get("/dashboard/trips", params={"scope": "all"}, headers={"X-Internal-Secret": "internal-test"})
    return next(t_ for t_ in res.json() if t_["ref"] == ref)["paymentMethod"]


# L: Card payment - the driver takes the fare on his card machine at the drop-off
tL, out = booked_trip(GUEST14)
offer = next(m for m in out if to(m) == GUEST14 and m["type"] == "interactive" and buttons(m))
check(buttons(offer) == ["guest:pay:now", "guest:pay:later"], "L: the fare comes with Pay now and Pay later")
out = tap(GUEST14, "guest:pay:now", "Pay now", context=offer["_id"])
early_link = consent_path(out, GUEST14)  # opened, but not paid
out = tap(GUEST14, "guest:pay:later", "Pay later", context=offer["_id"])
how = next(m for m in out if to(m) == GUEST14)
check(buttons(how) == ["guest:pay:card", "guest:pay:paystack"] and "card machine" in body_of(how) and "Paystack link" in body_of(how),
      "L: Pay later offers Card payment (the driver's card machine) and Paystack payment")
out = tap(GUEST14, "guest:pay:card", "Card payment", context=how["_id"])
check(any("card machine when you reach your destination" in body_of(m) for m in out if to(m) == GUEST14)
      and not any(m.get("interactive", {}).get("type") == "cta_url" for m in out),
      "L: Card payment - the guest will pay on the machine at the destination; no link")
check(any("on your card machine at the drop-off" in body_of(m) for m in out if to(m) == DRIVER)
      and any("card machine" in body_of(m) for m in out if to(m) == OPS), "L: the driver (who brings the machine) and Anneli are told")
out = tap(GUEST14, "guest:pay:card", "Card payment", context=how["_id"])
check(not any(to(m) in (DRIVER, OPS) for m in out) and trip_row(tL["ref"])["captured_at"] is None,
      "L: Card payment again tells the driver and Anneli nothing new; choosing marks nothing paid")
started, out = to_destination(GUEST14)
check(any(body_of(m).startswith("Ride started.") and "card machine at the drop-off" in body_of(m) for m in started if to(m) == DRIVER),
      "L: Ride started reminds the driver the guest pays on his card machine")
check(not any(m.get("interactive", {}).get("type") == "cta_url" for m in out)
      and any("by card on the driver's card machine" in body_of(m) for m in out if to(m) == GUEST14),
      "L: at the destination the guest is asked to pay on the card machine - no Paystack link")
card_q = next((m for m in out if to(m) == DRIVER and buttons(m)), None)
check(card_q is not None and buttons(card_q) == ["driver:card_paid"] and any("card machine" in body_of(m) for m in out if to(m) == OPS),
      "L: the driver gets Card payment done (no Ride complete yet); Anneli is told")
out = tap(DRIVER, "driver:complete", "Ride complete")
check(trip_row(tL["ref"])["status"] == "in_progress" and any("Card payment done" in body_of(m) for m in out if to(m) == DRIVER),
      "L: Ride complete before the card payment is refused")
new = together(*[(tap, (DRIVER, "driver:card_paid", "Card payment done"), {"context": card_q["_id"]})] * 2)
check(sum(1 for m in new if to(m) == GUEST14 and body_of(m).startswith("Payment received via Card.")) == 1,
      "L: guest - 'Payment received via Card.' (once, though tapped twice)")
check(sum(1 for m in new if to(m) == OPS and body_of(m).startswith("Payment received — Card Payment.")) == 1,
      "L: Anneli - 'Payment received — Card Payment.'")
check(sum(1 for m in new if to(m) == DRIVER and body_of(m).startswith("Payment Status: Paid — Card Payment.") and buttons(m) == ["driver:complete"]) == 1,
      "L: driver - 'Payment Status: Paid — Card Payment.' with Ride complete, once")
check(trip_row(tL["ref"])["captured_at"] is not None and len(events(tL["id"], T.CARD_PAID_EVENT)) == 1 and board_method(tL["ref"]) == "card",
      "L: the trip is paid, by card - and the admin board shows it")
res = client.get(early_link)
check(res.status_code == 200 and "already paid" in res.text and ">Agree</button>" not in res.text,
      "L: the Paystack link opened earlier now says the trip is paid - no second charge")
out = tap(DRIVER, "driver:complete", "Ride complete")
closed_card = next((m for m in out if to(m) == OPS and m["type"] == "template"), None)
check(trip_row(tL["ref"])["status"] == "completed" and any("already paid" in body_of(m) for m in out if to(m) == GUEST14)
      and any(m.get("interactive", {}).get("type") == "list" for m in out if to(m) == GUEST14),
      "L: Ride complete closes the trip as after any payment - the review follows")
check(closed_card is not None and "paid by card on the driver's card machine" in params_of(closed_card)[2],
      "L: Anneli's trip-closed card says it was paid on the card machine")

# P: Paystack payment - the link comes at the destination, through Paystack's privacy page
tP, out = booked_trip(GUEST15)
offer = next(m for m in out if to(m) == GUEST15 and m["type"] == "interactive" and buttons(m))
out = tap(GUEST15, "guest:pay:later", "Pay later", context=offer["_id"])
how = next(m for m in out if to(m) == GUEST15)
out = tap(GUEST15, "guest:pay:paystack", "Paystack payment", context=how["_id"])
check(any("Paystack payment link when you reach your destination" in body_of(m) for m in out if to(m) == GUEST15)
      and not any(m.get("interactive", {}).get("type") == "cta_url" for m in out) and not any(to(m) == DRIVER for m in out),
      "P: Paystack payment - the link comes at the destination; nothing sent now")
started, out = to_destination(GUEST15)
check(not any("card machine" in body_of(m) for m in started if to(m) == DRIVER), "P: no card machine for the driver")
refP = trip_row(tP["ref"])["payment_ref"]
check(consent_path(out, GUEST15) == f"/payments/pay/{refP}" and not any(buttons(m) for m in out if to(m) == DRIVER),
      "P: at the destination Pay now opens the Paystack privacy page; Ride complete waits")
page = client.get(f"/payments/pay/{refP}")
res = client.post(f"/payments/pay/{refP}", follow_redirects=False)
check(">Agree</button>" in page.text and res.status_code == 303 and res.headers["location"].startswith("https://paystack.test/"),
      "P: Agree goes on to Paystack")
start = len(sent)
T.payment_received({"status": "success", "reference": refP, "amount": 28000, "metadata": {"tripId": tP["id"], "purpose": "fare"}})
new = sent[start:]
check(any("received" in body_of(m) for m in new if to(m) == GUEST15) and any(buttons(m) == ["driver:complete"] for m in new if to(m) == DRIVER)
      and any("via Paystack" in body_of(m) for m in new if to(m) == OPS) and board_method(tP["ref"]) == "paystack",
      "P: paid - guest, driver (Ride complete) and Anneli told; the board shows Paystack")
res = client.get(f"/payments/pay/{refP}")
check("already" in res.text and ">Agree</button>" not in res.text, "P: the link cannot be paid twice")
T.cancel_trip(tP["id"], "ops", "test cleanup")

# ── 6m. Day Trip requests: full name, kept once, counted, shown on the tab ───
print("6m. day trip requests")
GUEST16, GUEST17, GUEST18, GUEST19 = "+27000000018", "+27000000019", "+27000000020", "+27000000021"


def to_trip_type(guest, when="tomorrow 09:30"):
    """`guest` starts a booking for `when`, up to the trip type question."""
    text(guest, "hi"); tap(guest, "book"); tap(guest, "when:later")
    return text(guest, when)


def stored_requests():
    """Day Trip requests in the database itself, not as the tab reports them."""
    from app.db import SessionLocal
    with SessionLocal() as db:
        return db.execute(sql("select count(*) from kanaan_day_trip_requests")).scalar()


def trips_of(phone):
    with hub_db.begin() as c:
        return c.execute(sql("select count(*) from trips where guest_phone = :p"), {"p": phone}).scalar()


# Test 1: Day Trip, then the full name - one request, and the count goes up by one
count0 = day_trips()[0]
to_trip_type(GUEST16)
out = tap(GUEST16, "trip:day", "Day Trip")
check(body_of(out[-1]) == "What is your full name?" and day_trips()[0] == count0,
      "1: Day Trip from a new guest asks their full name; nothing is kept before it")
out = text(GUEST16, "Ann Daytrip")
count1, mine = day_trips(GUEST16)
check(body_of(out[-1]).startswith("Day Trip Service – Coming Soon") and buttons(out[-1]) == ["trip:one_way"],
      "1: then the existing 'coming soon' reply, unchanged")
check(count1 == count0 + 1 and len(mine) == 1 and mine[0]["guestName"] == "Ann Daytrip" and mine[0]["phone"] == GUEST16
      and mine[0]["requestType"] == "DAY_TRIP" and mine[0]["status"] == "requested" and mine[0]["createdAt"].endswith("Z"),
      "1: kept - full name, WhatsApp number, type DAY_TRIP, status requested, time created - count up by 1")
check(trips_of(GUEST16) == 0, "1: no ride booked, no fare, no pickup or drop-off")

# Test 2: One Way Trip - the booking goes on exactly as before, and no Day Trip request
to_trip_type(GUEST17)
out = tap(GUEST17, "trip:one_way", "One Way Trip")
check(rows(out[-1]) == PICKUP_ROWS, "2: One Way Trip goes straight to the pickup list, as before")
tap(GUEST17, "from:farm"); text(GUEST17, "hazyview"); tap(GUEST17, "place:yes")
out = text(GUEST17, "Ola Oneway")
check(buttons(out[-1]) == ["quote:confirm", "quote:change"] and "Fare: R" in body_of(out[-1]),
      "2: then the destination, the name and the fare quote, as before")
tap(GUEST17, "quote:confirm")
check(trips_of(GUEST17) == 1 and trip_row()["status"] == "requested", "2: and the booking is made, as before")
check(day_trips(GUEST17)[1] == [] and day_trips()[0] == count1, "2: no Day Trip request for a One Way Trip")
T.cancel_trip(trip_row()["id"], "ops", "test cleanup")

# Test 3: the same name delivered twice (Meta's retry) and typed twice at once - one request
to_trip_type(GUEST18)
tap(GUEST18, "trip:day", "Day Trip")
retry = {"id": "wamid.in-daytrip-retry", "type": "text", "text": {"body": "Dup Guest"}}
new = post(GUEST18, retry) + post(GUEST18, retry)
check(len(day_trips(GUEST18)[1]) == 1 and sum(1 for m in new if body_of(m).startswith("Day Trip Service")) == 1,
      "3: the same webhook delivered twice: one request, one reply")
to_trip_type(GUEST19)
tap(GUEST19, "trip:day", "Day Trip")
new = together(*[(text, (GUEST19, "Twin Typer"), {})] * 2)
check(len(day_trips(GUEST19)[1]) == 1 and sum(1 for m in new if body_of(m).startswith("Day Trip Service")) == 1,
      "3: the name sent twice at the same instant: one request, one reply")

# A later request from the same guest, for another day, is a new one - and their name is not asked again
to_trip_type(GUEST16, "tomorrow 15:45")
out = tap(GUEST16, "trip:day", "Day Trip")
check(body_of(out[-1]).startswith("Day Trip Service – Coming Soon") and len(day_trips(GUEST16)[1]) == 2,
      "3: the same guest asking again for another time: a second request, name not asked again")

# Test 5: a guest the chat already knows (Kim, from an earlier trip) - their name is reused, nothing duplicated
kim_trips = trips_of(GUEST4)
to_trip_type(GUEST4, "tomorrow 17:15")
out = tap(GUEST4, "trip:day", "Day Trip")
kim = day_trips(GUEST4)[1]
check(body_of(out[-1]).startswith("Day Trip Service – Coming Soon") and len(kim) == 1 and kim[0]["guestName"] == "Kim",
      "5: a returning guest is not asked their name - the one on their earlier trip is used")
check(trips_of(GUEST4) == kim_trips, "5: and no trip or other record is created for them")

# Test 4 and 6: the tab's count is the database's, newest first, with every field shown
count, all_requests = day_trips()
check(count == stored_requests() == count0 + 5, f"4: Day Trip Requests ({count}) is the number stored - five more than before this section")
check([r["createdAt"] for r in all_requests] == sorted((r["createdAt"] for r in all_requests), reverse=True),
      "6: newest first")
check(all(r["guestName"] and r["phone"].startswith("+27") and r["requestType"] == "DAY_TRIP" and r["status"] and r["createdAt"]
          for r in all_requests), "6: every request has its full name, WhatsApp number, type, status and time")

# ── 6n. the Dispatch board: status and pickup-date filters, newest request first ──
print("6n. dispatch board filters")


def board(**params):
    res = client.get("/dashboard/trips", params=params, headers={"X-Internal-Secret": "internal-test"})
    return res.status_code, res.json()


def board_ids(**params):
    return [t_["id"] for t_ in board(**params)[1]]


with hub_db.begin() as c:
    from sqlalchemy import text as sql
    # Every trip is over by now, so give three of them the statuses Upcoming and Running list.
    for status, ref in zip(("requested", "allocated", "in_progress"),
                           c.execute(sql("select ref from trips where status = 'completed' order by id limit 3")).scalars().all()):
        c.execute(sql("update trips set status = :s where ref = :r"), {"s": status, "r": ref})
    stored = c.execute(sql("select id, status from trips where status <> 'draft' order by created_at desc, id desc")).mappings().all()
check(board_ids() == [r["id"] for r in stored], f"board: All lists all {len(stored)} trips but abandoned drafts, newest request first")
GROUPS = {"upcoming": ("requested", "allocated"), "running": ("driver_en_route", "driver_waiting", "in_progress"),
          "completed": ("completed",)}  # what the portal's Status filter promises
for name, statuses in GROUPS.items():
    expected = [r["id"] for r in stored if r["status"] in statuses]
    check(board_ids(status=name) == expected and len(expected) > 0, f"board: {name} lists its {len(expected)} trips only")

# The pickup day is the farm's (SAST, UTC+2): 23:59 belongs to that day, midnight to the next.
late, midnight = stored[0], stored[1]
with hub_db.begin() as c:
    c.execute(sql("update trips set scheduled_at = '2030-01-15 21:59' where id = :i"), {"i": late["id"]})
    c.execute(sql("update trips set scheduled_at = '2030-01-15 22:00' where id = :i"), {"i": midnight["id"]})
check(board_ids(date="2030-01-15") == [late["id"]] and board_ids(date="2030-01-16") == [midnight["id"]],
      "board: a pickup at 23:59 SAST is on that day; one at midnight is on the next")
other = next(name for name, statuses in GROUPS.items() if late["status"] not in statuses)
check(board_ids(date="2030-01-15", status=other) == [], "board: status and date filters combine")
check(board(status="soon")[0] == 400 and board(date="15/01/2030")[0] == 400, "board: an unknown status or a malformed date is refused")

unexpected = [r for r in bot_errors.records if "Template name does not exist" not in r.getMessage()]
for r in unexpected:
    print(f"  bot logged an error: {r.name}: {r.getMessage()}" + (f" ({r.exc_info[1]!r})" if r.exc_info else ""))
check(not unexpected, "no errors logged by the bot (every send and recording succeeded)")

print()
print("ALL PASSED" if not failures else f"{len(failures)} FAILED: {failures}")
sys.exit(1 if failures else 0)
