"""Entry point for Meta's webhook payloads: record each message, then route it by who sent
it. Called in the background after the webhook has answered Meta."""

import json
import logging
from types import SimpleNamespace
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.bot import hub_db, wa
from app.bot.conversation import STEPS, handle_guest_message, load_conversation, start_conversation
from app.bot.driver import handle_driver_message
from app.bot.hub_db import db_time, now
from app.bot.ops import handle_ops_message
from app.bot.reply import context_id, read_reply
from app.bot.roles import is_start_keyword, role_for
from app.config import get_settings

log = logging.getLogger("kanaan.bot.inbound")


def process_webhook(payload: dict[str, Any]) -> None:
    """Never raises: Meta has already been answered, and a half-applied state change must
    not be retried."""
    if not get_settings().bot_configured:
        log.warning("KANAAN_HUB_DATABASE_URL is not set - message logged but not answered")
        return
    configured_id = get_settings().whatsapp_phone_number_id
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value") or {}
            # Only messages to this deployment's number reach the booking flow.
            if configured_id and (value.get("metadata") or {}).get("phone_number_id") != configured_id:
                log.warning("ignoring webhook for an unconfigured phone number")
                continue
            for message in value.get("messages", []):
                try:
                    handle_message(message)
                except Exception:
                    log.exception("could not handle message %s", message.get("id"))


# The kinds of message that ask a question with buttons, a list or a picker. A tap on one of
# these is only accepted from the latest one sent to that phone.
PROMPTS = ("button", "list", "flow")


def _latest_prompt(phone: str) -> Optional[Any]:
    m = hub_db.wa_messages
    with hub_db.begin() as c:
        rows = c.execute(
            select(m.c.wa_message_id, m.c.payload, m.c.trip_id)
            .where(m.c.phone == phone, m.c.direction == "outbound", m.c.kind == "interactive")
            .order_by(m.c.id.desc()).limit(15)
        ).all()
    for r in rows:
        try:
            payload = json.loads(r.payload or "{}")
        except ValueError:
            continue
        if (payload.get("interactive") or {}).get("type") in PROMPTS:
            return SimpleNamespace(wamid=r.wa_message_id, payload=payload, trip_id=r.trip_id)
    return None


def _choice_ids(payload: dict[str, Any]) -> set[str]:
    action = (payload.get("interactive") or {}).get("action") or {}
    ids = {b["reply"]["id"] for b in action.get("buttons", [])}
    ids |= {r["id"] for s in action.get("sections", []) for r in s.get("rows", [])}
    return ids


def _is_stale_tap(phone: str, message: dict[str, Any]) -> bool:
    """A button, list or picker reply to an earlier question, choosing something the latest
    question does not offer: say so, send the current question again, and do not act on
    it. Template buttons (trip cards) are not covered - each trip step checks the trip's
    state instead."""
    interactive = message.get("interactive") or {}
    if message.get("type") != "interactive" or interactive.get("type") not in ("button_reply", "list_reply", "nfm_reply"):
        return False
    tapped = context_id(message)
    if not tapped:
        return False
    latest = _latest_prompt(phone)
    if not latest or latest.wamid == tapped:
        return False
    # The same choice as the current question offers (e.g. "Ride started" from the arrival
    # message just as the guest's confirmation sent a new one) is that answer - accept it.
    # Each trip step still acts only once (trip.claim_status).
    offered = _choice_ids(latest.payload)
    reply = interactive.get("button_reply") or interactive.get("list_reply") or {}
    if reply.get("id") and reply["id"] in offered:
        return False
    log.info("stale tap from %s on %s (latest question is %s)", phone, tapped, latest.wamid)
    to = wa.to_wa_id(phone)
    try:
        wa.send_text(to, "That option is from an earlier message and can no longer be used. Please use the latest one below.")
        wa._send({**latest.payload, "to": to}, latest.trip_id)
    except Exception:
        log.exception("could not re-send the current question to %s", phone)
    return True


def handle_message(message: dict[str, Any]) -> None:
    """The insert into wa_messages doubles as the idempotency claim: Meta retries, and a
    retry that re-ran the state machine would double-book a car."""
    phone = wa.to_e164(message["from"])
    reply = read_reply(message)
    role = role_for(phone)

    with hub_db.begin() as c:
        claimed = c.execute(
            pg_insert(hub_db.wa_messages)
            .values(wa_message_id=message["id"], phone=phone, role=role, direction="inbound",
                    kind=message.get("type", "other"), body=reply.text or None, payload=json.dumps(message),
                    created_at=db_time(now()))
            .on_conflict_do_nothing(index_elements=["wa_message_id"])
            .returning(hub_db.wa_messages.c.id)
        ).first()
    if not claimed:
        log.info("ignoring repeat delivery of %s", message["id"])
        return

    wa.mark_read(message["id"])

    # Buttons on an earlier question are dead: WhatsApp cannot grey them out, so a tap on
    # one is answered here and the current question sent again, rather than acted on.
    if _is_stale_tap(phone, message):
        return

    if role == "guest":
        convo = load_conversation(phone)
        # "nii" and the greetings start (or restart) a booking. Typed only: a tapped button
        # whose title happens to be a greeting is a reply, not a restart.
        if not reply.reply_id and is_start_keyword(reply.text):
            start_conversation(phone)
            return
        # Unrelated messages are ignored until the guest opts in — except taps on the
        # buttons of an earlier trip, which the conversation handles at any step.
        if convo.step == STEPS.idle and not (reply.reply_id or message.get("type") == "button"):
            return
        handle_guest_message(phone, message)
        return

    if role == "ops":
        handle_ops_message(phone, message)
        return
    handle_driver_message(phone, message)
