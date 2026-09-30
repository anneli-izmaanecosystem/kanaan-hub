"""Service-to-service writes into the admin UI's tables, gated by X-Internal-Secret.

These were how the Next.js app mirrored the booking conversation here when it ran the
bot. The bot now runs in this service (app/bot) and logs directly; the routes stay for
any other service that wants its messages shown in the admin UI.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.flow_state import get_or_create_active_flow
from app.models import WhatsAppFlow, WhatsAppLog
from app.schemas import MirrorFlowIn, MirrorMessageIn, MirrorStatusIn
from app.utils import utcnow

router = APIRouter(prefix="/internal", tags=["internal"])


def require_internal_secret(
    x_internal_secret: Optional[str] = Header(None),
    settings: Settings = Depends(get_settings),
):
    if not settings.internal_mirror_secret or x_internal_secret != settings.internal_mirror_secret:
        raise HTTPException(401, "Invalid or missing internal secret")


@router.post("/messages", status_code=201, dependencies=[Depends(require_internal_secret)])
def mirror_message(payload: MirrorMessageIn, db: Session = Depends(get_db)):
    if payload.wa_message_id:
        existing = db.scalar(select(WhatsAppLog).where(WhatsAppLog.wa_message_id == payload.wa_message_id))
        if existing:
            return {"status": "duplicate", "id": existing.id}

    flow = db.scalar(
        select(WhatsAppFlow)
        .where(WhatsAppFlow.phone_number == payload.phone_number, WhatsAppFlow.status == "active")
        .order_by(WhatsAppFlow.last_interaction_at.desc())
    )

    log = WhatsAppLog(
        wa_message_id=payload.wa_message_id,
        flow_id=flow.id if flow else None,
        direction=payload.direction,
        phone_number=payload.phone_number,
        message_type=payload.message_type,
        template_name=payload.template_name,
        body=payload.body,
        payload=payload.payload,
        status=payload.status,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return {"status": "ok", "id": log.id}


@router.post("/messages/status", dependencies=[Depends(require_internal_secret)])
def mirror_status(payload: MirrorStatusIn, db: Session = Depends(get_db)):
    log = db.scalar(select(WhatsAppLog).where(WhatsAppLog.wa_message_id == payload.wa_message_id))
    if not log:
        return {"status": "not_found"}
    log.status = payload.status
    if payload.error_message:
        log.error_message = payload.error_message
    db.commit()
    return {"status": "ok"}


@router.post("/flows", dependencies=[Depends(require_internal_secret)])
def mirror_flow(payload: MirrorFlowIn, db: Session = Depends(get_db)):
    flow = get_or_create_active_flow(db, payload.phone_number, payload.flow_name)
    flow.current_step = payload.current_step
    flow.context = payload.context
    flow.last_interaction_at = utcnow()
    if payload.status != "active" and flow.status != payload.status:
        flow.status = payload.status
        flow.completed_at = utcnow()
    db.commit()
    db.refresh(flow)
    return {"status": "ok", "id": flow.id}
