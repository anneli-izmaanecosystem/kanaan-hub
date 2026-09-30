"""Entry point for Meta's webhook payloads: record each message, then route it by who sent
it. Called in the background after the webhook has answered Meta."""

import json
import logging
from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.bot import hub_db, wa
from app.bot.conversation import STEPS, handle_guest_message, load_conversation, start_conversation
from app.bot.driver import handle_driver_message
from app.bot.hub_db import db_time, now
from app.bot.ops import handle_ops_message
from app.bot.reply import read_reply
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
