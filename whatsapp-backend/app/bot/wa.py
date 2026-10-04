"""Sending side of the WhatsApp Cloud API, one function per message shape the bot uses.

Every send is recorded twice: in kanaan_hub.wa_messages (the dashboard's thread view, and
how a later tap on a card is traced back to its trip) and in this service's own
kanaan_whatsapp_logs (the admin UI). Recording never fails a send Meta has accepted.

Two limits fail silently at Meta, so they are checked here: a reply button title is
capped at 20 characters and a list row title at 24.
"""

import itertools
import json
import time
import uuid
import logging
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.bot import hub_db
from app.config import get_settings

log = logging.getLogger("kanaan.bot.wa")

Button = tuple[str, str]  # (id, title)


class WhatsAppError(Exception):
    def __init__(self, message: str, status: int = 0, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


# Tests set this to a list: sends are captured there instead of going to Meta, and get a
# fake wamid so replies to them can still be traced.
capture: Optional[list[dict[str, Any]]] = None
_fake_ids = itertools.count(1)
_RUN = uuid.uuid4().hex[:8]  # captured ids stay unique across restarts on one database


def to_e164(wa_id: str) -> str:
    return wa_id if wa_id.startswith("+") else f"+{wa_id}"


def to_wa_id(phone: str) -> str:
    return phone.removeprefix("+")


def _send(payload: dict[str, Any], trip_id: Optional[int] = None, redact: Optional[str] = None) -> Optional[str]:
    settings = get_settings()
    if capture is not None:
        wamid = f"wamid.test-{_RUN}-{next(_fake_ids)}"
        capture.append({**payload, "_id": wamid, "_trip_id": trip_id})
    elif not settings.whatsapp_configured:
        log.warning("WhatsApp not configured - would have sent: %s", json.dumps(_masked(payload, redact)))
        return None
    else:
        url = f"{settings.graph_base_url}/{settings.whatsapp_phone_number_id}/messages"
        with httpx.Client(timeout=20) as client:
            res = client.post(
                url,
                headers={"Authorization": f"Bearer {settings.whatsapp_access_token}"},
                json={"messaging_product": "whatsapp", **payload},
            )
        body = res.json() if res.content else {}
        if res.is_error:
            detail = (body.get("error") or {}).get("message", res.text) if isinstance(body, dict) else res.text
            raise WhatsAppError(f"WhatsApp send failed: {detail}", res.status_code, body)
        wamid = ((body.get("messages") or [{}])[0]).get("id")

    if wamid and "to" in payload:
        _record(payload, wamid, trip_id, redact)
    return wamid


# ── recording ────────────────────────────────────────────────────────────────


def _masked(payload: dict[str, Any], redact: Optional[str]) -> dict[str, Any]:
    """The payload as logs may keep it: a secret that went to one person (a pickup code)
    is masked in the message text."""
    if not redact or payload.get("type") != "text":
        return payload
    text_ = payload["text"]
    return {**payload, "text": {**text_, "body": text_["body"].replace(redact, "•" * len(redact))}}


def _describe(p: dict[str, Any]) -> tuple[str, str, Optional[str]]:
    """(kind, body, template name) — what a payload reads as in a thread."""
    kind = str(p.get("type", "other"))
    if kind == "text":
        return kind, p["text"]["body"], None
    if kind == "interactive":
        i = p["interactive"]
        action = i.get("action") or {}
        choices = [b["reply"]["title"] for b in action.get("buttons", [])]
        choices += [r["title"] for s in action.get("sections", []) for r in s.get("rows", [])]
        params = action.get("parameters") or {}
        if params.get("display_text"):
            choices.append(params["display_text"])
        if i.get("type") == "location_request_message":
            choices.append("Send location")
        if i.get("type") == "flow":
            choices.append(action.get("parameters", {}).get("flow_cta", "Open"))
        body = (i.get("body") or {}).get("text", "")
        return kind, body + (f"\n[{' | '.join(choices)}]" if choices else ""), None
    if kind == "template":
        t = p["template"]
        params = [x.get("text", "") for c in t.get("components", []) for x in c.get("parameters", [])]
        return kind, " · ".join(params), t["name"]
    if kind == "location":
        loc = p["location"]
        return kind, loc.get("name") or loc.get("address") or "location", None
    return kind, "", None


def _record(payload: dict[str, Any], wamid: str, trip_id: Optional[int], redact: Optional[str] = None) -> None:
    from app.bot.roles import role_for  # late: roles reads settings through hub_db

    phone = to_e164(payload["to"])
    payload = _masked(payload, redact)
    kind, body, template_name = _describe(payload)
    try:
        with hub_db.begin() as c:
            c.execute(
                pg_insert(hub_db.wa_messages)
                .values(
                    wa_message_id=wamid, phone=phone, role=role_for(phone), direction="outbound",
                    kind=kind, template_name=template_name, body=body, payload=json.dumps(payload),
                    trip_id=trip_id, created_at=hub_db.db_time(hub_db.now()),
                )
                .on_conflict_do_nothing(index_elements=["wa_message_id"])
            )
    except Exception:
        log.exception("could not record outbound message in wa_messages")

    try:
        from app.bot.admin_log import log_outbound
        log_outbound(phone, kind, body, template_name, wamid, payload)
    except Exception:
        log.exception("could not record outbound message in the admin log")


def link_to_trip(wamid: Optional[str], trip_id: Optional[int]) -> None:
    """Ties an already-recorded message to a trip, for sends made before the trip id was known."""
    if not wamid or not trip_id:
        return
    with hub_db.begin() as c:
        c.execute(hub_db.wa_messages.update().where(hub_db.wa_messages.c.wa_message_id == wamid).values(trip_id=trip_id))


# ── message shapes ───────────────────────────────────────────────────────────


def send_text(to: str, body: str, trip_id: Optional[int] = None, redact: Optional[str] = None) -> Optional[str]:
    """Plain text. Only valid inside the 24-hour window. `redact` is sent but not recorded."""
    return _send({"to": to, "type": "text", "text": {"body": body, "preview_url": False}}, trip_id, redact)


def send_buttons(to: str, body: str, buttons: list[Button], trip_id: Optional[int] = None) -> Optional[str]:
    """Up to three quick-reply buttons. In-session only."""
    if not 1 <= len(buttons) <= 3:
        raise ValueError(f"WhatsApp allows 1-3 reply buttons, got {len(buttons)}")
    for _, title in buttons:
        if len(title) > 20:
            raise ValueError(f'Reply button "{title}" is {len(title)} characters; the limit is 20')
    return _send({
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "button",
            "body": {"text": body},
            "action": {"buttons": [{"type": "reply", "reply": {"id": i, "title": t}} for i, t in buttons]},
        },
    }, trip_id)


def send_list(to: str, body: str, button_label: str, rows: list[dict[str, str]], trip_id: Optional[int] = None) -> Optional[str]:
    """A scrolling list, for more than three choices (the driver picker)."""
    if not 1 <= len(rows) <= 10:
        raise ValueError(f"A WhatsApp list allows 1-10 rows, got {len(rows)}")
    for r in rows:
        if len(r["title"]) > 24:
            raise ValueError(f'List row "{r["title"]}" is {len(r["title"])} characters; the limit is 24')
    return _send({
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "list",
            "body": {"text": body},
            "action": {"button": button_label, "sections": [{"title": "Choose", "rows": rows}]},
        },
    }, trip_id)


def send_cta_url(to: str, body: str, display_text: str, url: str, trip_id: Optional[int] = None) -> Optional[str]:
    """A single link button — the Paystack payment link."""
    return _send({
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "cta_url",
            "body": {"text": body},
            "action": {"name": "cta_url", "parameters": {"display_text": display_text, "url": url}},
        },
    }, trip_id)


def send_location_request(to: str, body: str, trip_id: Optional[int] = None) -> Optional[str]:
    """A "Send location" button that opens WhatsApp's own location picker. In-session only."""
    return _send({
        "to": to,
        "type": "interactive",
        "interactive": {"type": "location_request_message", "body": {"text": body}, "action": {"name": "send_location"}},
    }, trip_id)


def send_flow(to: str, body: str, cta: str, flow_id: str, flow_token: str, screen: str,
              data: Optional[dict[str, Any]] = None, trip_id: Optional[int] = None) -> Optional[str]:
    """Opens a WhatsApp Flow (the date/time picker) on `screen`, handing it `data`. In-session only."""
    if len(cta) > 20:
        raise ValueError(f'Flow button "{cta}" is {len(cta)} characters; the limit is 20')
    action_payload: dict[str, Any] = {"screen": screen}
    if data:
        action_payload["data"] = data
    return _send({
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "flow",
            "body": {"text": body},
            "action": {
                "name": "flow",
                "parameters": {
                    "flow_message_version": "3",
                    "flow_id": flow_id,
                    "flow_token": flow_token,
                    "flow_cta": cta,
                    "flow_action": "navigate",
                    "flow_action_payload": action_payload,
                },
            },
        },
    }, trip_id)


def send_location(to: str, latitude: float, longitude: float, name: Optional[str] = None,
                  address: Optional[str] = None, trip_id: Optional[int] = None) -> Optional[str]:
    """A pin the recipient can tap through to their maps app."""
    location: dict[str, Any] = {"latitude": latitude, "longitude": longitude}
    if name:
        location["name"] = name
    if address:
        location["address"] = address
    return _send({"to": to, "type": "location", "location": location}, trip_id)


def send_template(to: str, name: str, body: list[str], trip_id: Optional[int] = None,
                  header: Optional[list[str]] = None, url_button_param: Optional[str] = None) -> Optional[str]:
    """A pre-approved template — the only thing that may go outside the 24-hour window.

    en_GB throughout: WhatsApp has no en_ZA and en_GB matches South African spelling.
    """
    components: list[dict[str, Any]] = []
    if header:
        components.append({"type": "header", "parameters": [{"type": "text", "text": t} for t in header]})
    if body:
        components.append({"type": "body", "parameters": [{"type": "text", "text": t} for t in body]})
    if url_button_param:
        components.append({"type": "button", "sub_type": "url", "index": "0",
                           "parameters": [{"type": "text", "text": url_button_param}]})
    template: dict[str, Any] = {"name": name, "language": {"code": "en_GB"}}
    if components:
        template["components"] = components
    return _send({"to": to, "type": "template", "template": template}, trip_id)


DELIVERED = ("delivered", "read", "failed")


def await_delivery(wamid: Optional[str], timeout: float = 6.0) -> None:
    """Waits until Meta reports `wamid` delivered (or read, or failed) - at most `timeout`
    seconds, then carries on. WhatsApp does not keep a template and the plain message sent
    straight after it in order: the plain one can overtake it on the phone. A message that
    must come after a template ("Pay now" after "Your car is confirmed", the pickup pin
    after the new-trip card) waits here first. The receipt arrives on the webhook, which
    updates the admin log row. Returns at once when sends are captured (tests, simulator)."""
    if not wamid or capture is not None or not get_settings().whatsapp_configured:
        return
    from app.db import SessionLocal  # late: the admin log's database, not the hub's
    from app.models import WhatsAppLog

    deadline = time.monotonic() + timeout
    while True:
        try:
            with SessionLocal() as db:
                status = db.scalar(select(WhatsAppLog.status).where(WhatsAppLog.wa_message_id == wamid))
        except Exception:
            log.exception("could not read the delivery status of %s", wamid)
            return
        if status in DELIVERED:
            return
        if time.monotonic() >= deadline:
            log.info("no delivery receipt for %s after %ss - sending the next message anyway", wamid, timeout)
            return
        time.sleep(0.3)


def mark_read(wamid: str) -> None:
    """Grey ticks turn blue. Courtesy only."""
    if capture is not None or not get_settings().whatsapp_configured:
        return
    try:
        _send({"status": "read", "message_id": wamid})
    except Exception:
        log.exception("could not mark %s read", wamid)


def wamid_trip(wamid: Optional[str]) -> Optional[int]:
    """The trip a sent message belongs to — how a tap on a card finds its trip."""
    if not wamid:
        return None
    with hub_db.begin() as c:
        r = hub_db.one(c, select(hub_db.wa_messages.c.trip_id).where(hub_db.wa_messages.c.wa_message_id == wamid))
    return r.trip_id if r else None
