"""Local WhatsApp simulator: test the whole booking flow on one machine, with no message
sent to Meta, no card charged and no template created.

Enabled only with SIMULATOR=true (never set on the server). Then:
  - every send is captured (app.bot.wa.capture) instead of going to Meta;
  - Paystack links open a local page with Pay / Decline / Cancel;
  - the scheduler does not run by itself - the page has a "move time forward" button;
  - /sim shows three phones - Guest, Anneli, Driver - side by side.

Templates are shown with the text Meta approved (templates.json, a read-only copy).
A template the bot sends that is not in that copy is flagged: it would have to be
created on Meta before the flow could work live. Entries marked PROPOSED are new
versions written here for review only - not created on Meta - and are flagged as such.
"""

import json
import threading
import uuid
import time
from datetime import timedelta
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import text

from app import paystack
from app.bot import hub_db, inbound, scheduler, trip as T, wa
from app.config import get_settings

router = APIRouter(prefix="/sim", tags=["simulator"])

HERE = Path(__file__).parent
TEMPLATES: dict[str, dict[str, Any]] = json.loads((HERE / "templates.json").read_text(encoding="utf-8"))

GUEST, OPS, DRIVER = "+27000000003", "+27000000001", "+27000000002"
PHONES = {"guest": GUEST, "ops": OPS, "driver": DRIVER}
ROLE_OF = {v: k for k, v in PHONES.items()}

_lock = threading.Lock()
_log: list[dict[str, Any]] = []        # every message, in and out, in order
_payments: dict[str, dict[str, Any]] = {}
_clock = {"offset_min": 0}             # "move time forward"
_ids = iter(range(1, 10**9))
# Per-run prefix for fake WhatsApp ids: the bot rightly ignores a message id it has seen
# before, so ids must not repeat across simulator restarts on the same database.
_RUN = uuid.uuid4().hex[:8]


# ── wiring (called once at startup when SIMULATOR=true) ──────────────────────


def enable() -> None:
    # Refuse to run against anything but databases on this machine: .env holds the live
    # database addresses, and a simulator writing test trips there would be a real mess.
    from urllib.parse import urlparse

    s = get_settings()
    for label, url in (("KANAAN_HUB_DATABASE_URL", s.kanaan_hub_database_url), ("DATABASE_URL", s.database_url)):
        host = urlparse(url.replace("postgresql+psycopg2", "postgresql")).hostname
        if host not in ("localhost", "127.0.0.1", "::1"):
            raise RuntimeError(f"SIMULATOR refuses to start: {label} points at {host}, not a local database")
    wa.capture = _Capture()
    paystack.start_payment = _fake_start_payment
    paystack.verify_transaction = _fake_verify


class _Capture(list):
    """wa.capture: every outbound payload lands here, and in the conversation log."""

    def append(self, payload: dict[str, Any]) -> None:  # type: ignore[override]
        super().append(payload)
        if "_upload" in payload:
            return
        with _lock:
            _log.append(_render_outbound(payload))


def _fake_start_payment(settings, trip_id, trip_ref, email, amount_rand, purpose):
    reference = f"{trip_ref}-{purpose}-sim{next(_ids)}"
    _payments[reference] = {"reference": reference, "amount": round(amount_rand * 100),
                            "metadata": {"tripId": trip_id, "purpose": purpose}, "status": "abandoned"}
    return {"authorization_url": f"/sim/pay/{reference}", "access_code": "sim", "reference": reference}


def _fake_verify(settings, reference):
    tx = _payments.get(reference)
    if not tx:
        raise paystack.PaystackError("Transaction reference not found")
    return dict(tx)


# ── rendering what the bot sent, as each phone would show it ─────────────────


def _render_outbound(p: dict[str, Any]) -> dict[str, Any]:
    to = wa.to_e164(p["to"])
    m: dict[str, Any] = {"n": next(_ids), "at": time.strftime("%H:%M:%S"), "dir": "out", "phone": to,
                         "role": ROLE_OF.get(to, "guest"), "wamid": p.get("_id"), "trip_id": p.get("_trip_id"),
                         "kind": p["type"], "text": "", "buttons": [], "warn": None}
    kind = p["type"]
    if kind == "text":
        m["text"] = p["text"]["body"]
    elif kind == "location":
        loc = p["location"]
        m["text"] = f"📍 {loc.get('name') or 'Location'}"
        m["map"] = f"https://www.google.com/maps?q={loc['latitude']},{loc['longitude']}"
    elif kind == "template":
        name = p["template"]["name"]
        params = [x.get("text", "") for c in p["template"].get("components", []) for x in c.get("parameters", [])
                  if c.get("type") == "body"]
        t = TEMPLATES.get(name)
        m["template"] = name
        if not t:
            m["warn"] = f"Template {name} is NOT on Meta - it would have to be created first."
            m["text"] = " · ".join(params)
        else:
            body = t["body"]
            for i, val in enumerate(params, start=1):
                body = body.replace("{{%d}}" % i, val)
            m["text"] = "\n".join(filter(None, [f"*{t['header']}*" if t.get("header") else None, body, t.get("footer")]))
            m["buttons"] = [{"kind": "template", "id": b, "title": b} for b in t.get("buttons", [])]
            if t["status"] == "PROPOSED":
                m["warn"] = (f"Template {name} is proposed - not created on Meta yet (needs your go-ahead). "
                             "Live, its approved earlier version is sent until then.")
            elif t["status"] != "APPROVED":
                m["warn"] = f"Template {name} is {t['status']} on Meta, not approved."
    elif kind == "interactive":
        i = p["interactive"]
        m["text"] = (i.get("body") or {}).get("text", "")
        a = i.get("action") or {}
        if i["type"] == "button":
            m["buttons"] = [{"kind": "button", "id": b["reply"]["id"], "title": b["reply"]["title"]} for b in a["buttons"]]
        elif i["type"] == "list":
            m["list"] = {"label": a["button"], "rows": [r for s in a["sections"] for r in s["rows"]]}
        elif i["type"] == "location_request_message":
            m["location_request"] = True
        elif i["type"] == "cta_url":
            m["cta"] = {"label": a["parameters"]["display_text"], "url": a["parameters"]["url"]}
        elif i["type"] == "flow":
            fp = a["parameters"]
            m["flow"] = {"cta": fp["flow_cta"], "data": fp.get("flow_action_payload", {}).get("data", {})}
    elif kind == "document":
        m["text"] = f"📄 {p['document'].get('filename')}"
    # the same message to the same phone within a few seconds = a duplicate (the KN-1012 bug)
    m["ts"] = time.time()
    # A duplicate is the same message sent to the same phone twice for ONE action: no tap or
    # message from anyone in between. (Asking again after the guest answered is not.)
    # The current question re-sent on purpose after a tap on an old button is not either.
    previous = next((x for x in reversed(_log) if x["dir"] == "out" and x["phone"] == to), None)
    resent = bool(previous and previous["text"].startswith("That option is from an earlier message"))
    with_same = []
    if not resent and m["text"]:
        for x in reversed(_log):
            if x["dir"] == "in":
                break
            if x["phone"] == to and x["text"] == m["text"] and x.get("template") == m.get("template"):
                with_same.append(x)
                break
    if with_same:
        m["warn"] = (m["warn"] + " " if m["warn"] else "") + "DUPLICATE: the same message was just sent to this phone."
    return m


# ── the page's API ───────────────────────────────────────────────────────────


class Send(BaseModel):
    role: str
    kind: str                      # text | button | list | template | location | flow
    text: Optional[str] = None
    id: Optional[str] = None
    title: Optional[str] = None
    context: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    name: Optional[str] = None
    date: Optional[str] = None
    hour: Optional[str] = None
    minute: Optional[str] = None


@router.get("/messages")
def messages(since: int = 0):
    with _lock:
        return {"messages": [m for m in _log if m["n"] > since], "offset_min": _clock["offset_min"]}


@router.post("/send")
def send(s: Send):
    phone = PHONES.get(s.role)
    if not phone:
        raise HTTPException(400, "role must be guest, ops or driver")
    msg: dict[str, Any] = {"from": phone.lstrip("+"), "id": f"wamid.sim-in-{_RUN}-{next(_ids)}", "timestamp": str(int(time.time()))}
    shown = s.text or s.title or ""
    if s.kind == "text":
        msg.update(type="text", text={"body": s.text or ""})
    elif s.kind == "button":
        msg.update(type="interactive", interactive={"type": "button_reply", "button_reply": {"id": s.id, "title": s.title}})
    elif s.kind == "list":
        msg.update(type="interactive", interactive={"type": "list_reply", "list_reply": {"id": s.id, "title": s.title}})
    elif s.kind == "template":
        msg.update(type="button", button={"text": s.title, "payload": s.title})
    elif s.kind == "location":
        loc = {"latitude": s.lat, "longitude": s.lng}
        if s.name:
            loc["name"] = s.name
        msg.update(type="location", location=loc)
        shown = f"📍 {s.name or f'{s.lat:.4f}, {s.lng:.4f}'}"
    elif s.kind == "flow":
        answer = {"date": s.date, "hour": s.hour, "minute": s.minute, "flow_token": "sim"}
        msg.update(type="interactive", interactive={"type": "nfm_reply", "nfm_reply": {
            "name": "flow", "body": "Sent", "response_json": json.dumps(answer)}})
        shown = f"🗓 {s.date} {s.hour}:{s.minute}"
    else:
        raise HTTPException(400, "unknown kind")
    if s.context:
        msg["context"] = {"from": "27642116345", "id": s.context}
    _require_database()
    with _lock:
        _log.append({"n": next(_ids), "at": time.strftime("%H:%M:%S"), "dir": "in", "phone": phone, "role": s.role,
                     "kind": s.kind, "text": shown, "buttons": [], "warn": None})
    inbound.handle_message(msg)
    return {"ok": True}


def _require_database() -> None:
    """A plain answer instead of a 500 when the simulator's local database has stopped."""
    try:
        with hub_db.engine().connect() as c:
            c.execute(text("select 1"))
    except Exception:
        raise HTTPException(503, "The simulator's local database has stopped. Close the simulator window and "
                                 "start it again: sh whatsapp-backend/sim/run.sh (or run-simulator.cmd)")


@router.get("/status")
def status():
    try:
        _require_database()
        return {"database": "up"}
    except HTTPException as err:
        return {"database": "down", "detail": err.detail}


@router.post("/pay/{reference}/{outcome}")
def pay(reference: str, outcome: str):
    tx = _payments.get(reference)
    if not tx:
        raise HTTPException(404, "unknown payment")
    if outcome == "success":
        tx.update(status="success", gateway_response="Approved", paid_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                  authorization={"brand": "visa", "last4": "4081"})
        T.payment_received(dict(tx))
    elif outcome == "failed":
        tx.update(status="failed", gateway_response="Declined")
        T.payment_failed(dict(tx))
    elif outcome == "cancelled":
        T.payment_cancelled(dict(tx))
    else:
        raise HTTPException(400, "outcome must be success, failed or cancelled")
    return {"ok": True, "status": tx["status"]}


@router.post("/tick")
def tick(minutes: int = 0):
    """Moves the simulated clock forward and runs the scheduled sends as of then."""
    _clock["offset_min"] += max(0, minutes)
    return scheduler.tick(hub_db.now() + timedelta(minutes=_clock["offset_min"]))


@router.post("/reset")
def reset():
    with hub_db.begin() as c:
        c.execute(text("truncate trip_events, wa_messages, wa_conversations, trips restart identity cascade"))
    from app.db import SessionLocal
    with SessionLocal() as db:
        db.execute(text("delete from kanaan_whatsapp_logs")); db.execute(text("delete from kanaan_whatsapp_flows"))
        db.execute(text("delete from kanaan_payments")); db.commit()
    with _lock:
        _log.clear()
    _payments.clear()
    _clock["offset_min"] = 0
    return {"ok": True}


@router.get("/templates-used")
def templates_used():
    """Every template the bot sent in this session, and whether Meta has it approved."""
    used: dict[str, int] = {}
    with _lock:
        for m in _log:
            if m.get("template"):
                used[m["template"]] = used.get(m["template"], 0) + 1
    return [{"template": n, "sent": c, "on_meta": (TEMPLATES.get(n) or {}).get("status", "MISSING")} for n, c in sorted(used.items())]


@router.get("/scenarios")
def scenario_list():
    from app.sim import scenarios
    return [{"key": k, "title": t} for k, (t, _) in scenarios.SCENARIOS.items()]


@router.post("/scenarios/run")
def scenario_run(key: str = "all"):
    """Plays a scenario (or all of them) through the three phones, live."""
    from app.sim import scenarios
    keys = list(scenarios.SCENARIOS) if key == "all" else [key]
    if any(k not in scenarios.SCENARIOS for k in keys):
        raise HTTPException(404, "unknown scenario")
    _require_database()
    if not scenarios.run(keys):
        raise HTTPException(409, "A test is already running - wait for it to finish.")
    return {"ok": True, "running": keys}


@router.get("/scenarios/status")
def scenario_status():
    from app.sim import scenarios
    return {**scenarios.state, "tracker": scenarios.tracker()}


@router.get("", response_class=HTMLResponse)
def page():
    return HTMLResponse((HERE / "page.html").read_text(encoding="utf-8"))


@router.get("/pay/{reference}", response_class=HTMLResponse)
def pay_page(reference: str):
    tx = _payments.get(reference)
    if not tx:
        raise HTTPException(404, "unknown payment")
    amount = tx["amount"] / 100
    return HTMLResponse(f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Simulated Paystack</title>
<style>body{{font-family:system-ui;background:#f0f2f5;margin:0}}main{{max-width:360px;margin:12vh auto;background:#fff;border-radius:12px;padding:24px;text-align:center}}
button{{display:block;width:100%;margin:8px 0;padding:12px;border:0;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}}
.ok{{background:#0ba360;color:#fff}}.bad{{background:#e5484d;color:#fff}}.no{{background:#e8ecef}}p{{color:#555}}</style>
<main><h2>Simulated Paystack</h2><p>{reference}</p><h1>R {amount:,.2f}</h1><p>No real card is charged.</p>
<button class="ok" onclick="go('success')">Pay (card approved)</button>
<button class="bad" onclick="go('failed')">Card declined</button>
<button class="no" onclick="go('cancelled')">Cancel payment</button></main>
<script>async function go(o){{await fetch('/sim/pay/{reference}/'+o,{{method:'POST'}});document.querySelector('main').innerHTML='<h2>Done: '+o+'</h2><p>Go back to the simulator.</p>';setTimeout(()=>window.close(),800)}}</script>""")
