"""Keeps this service's admin UI (kanaan_whatsapp_logs / kanaan_whatsapp_flows) showing
the bot's conversations. The webhook already logs inbound messages; this adds what the
bot sends and where each conversation has got to. Failures are logged, never raised."""

import logging
from typing import Any, Optional

from sqlalchemy import select

from app.db import SessionLocal
from app.flow_state import get_or_create_active_flow
from app.models import WhatsAppFlow, WhatsAppLog
from app.utils import utcnow

log = logging.getLogger("kanaan.bot.admin_log")


def log_outbound(phone: str, kind: str, body: str, template_name: Optional[str], wamid: str,
                 payload: dict[str, Any]) -> None:
    with SessionLocal() as db:
        if db.scalar(select(WhatsAppLog).where(WhatsAppLog.wa_message_id == wamid)):
            return
        flow = db.scalar(
            select(WhatsAppFlow)
            .where(WhatsAppFlow.phone_number == phone, WhatsAppFlow.status == "active")
            .order_by(WhatsAppFlow.last_interaction_at.desc())
        )
        db.add(WhatsAppLog(
            wa_message_id=wamid, flow_id=flow.id if flow else None, direction="outbound",
            phone_number=phone, message_type=kind, template_name=template_name, body=body,
            payload=payload, status="sent",
        ))
        db.commit()


def log_flow(phone: str, role: str, step: str, context: dict[str, Any]) -> None:
    try:
        with SessionLocal() as db:
            flow = get_or_create_active_flow(db, phone, "kanaan_car_booking" if role == "guest" else f"kanaan_{role}")
            flow.current_step = step
            flow.context = context
            flow.last_interaction_at = utcnow()
            db.commit()
    except Exception:
        log.exception("could not update the admin flow for %s", phone)
