from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import WhatsAppFlow, WhatsAppLog
from app.schemas import ConversationSummary, FlowOut, LogOut
from app.supabase_auth import require_supabase_user

router = APIRouter(prefix="/conversations", tags=["conversations"], dependencies=[Depends(require_supabase_user)])


@router.get("", response_model=list[ConversationSummary])
def list_conversations(db: Session = Depends(get_db)):
    """One row per phone number, most recently active first — the inbox view."""
    latest_id_per_phone = (
        select(func.max(WhatsAppLog.id).label("id"))
        .group_by(WhatsAppLog.phone_number)
        .subquery()
    )
    latest_logs = db.scalars(
        select(WhatsAppLog).join(latest_id_per_phone, WhatsAppLog.id == latest_id_per_phone.c.id)
    ).all()

    summaries = []
    for log in sorted(latest_logs, key=lambda log: log.created_at, reverse=True):
        flow = db.scalar(
            select(WhatsAppFlow)
            .where(WhatsAppFlow.phone_number == log.phone_number)
            .order_by(WhatsAppFlow.last_interaction_at.desc())
        )
        summaries.append(
            ConversationSummary(
                phone_number=log.phone_number,
                last_message_at=log.created_at,
                last_body=log.body or f"[{log.message_type}]",
                last_direction=log.direction,
                flow_status=flow.status if flow else None,
            )
        )
    return summaries


@router.get("/{phone_number}/messages", response_model=list[LogOut])
def get_thread(phone_number: str, db: Session = Depends(get_db)):
    return db.scalars(
        select(WhatsAppLog)
        .where(WhatsAppLog.phone_number == phone_number)
        .order_by(WhatsAppLog.created_at.asc())
    ).all()


@router.get("/{phone_number}/flow", response_model=FlowOut)
def get_active_flow(phone_number: str, db: Session = Depends(get_db)):
    flow = db.scalar(
        select(WhatsAppFlow)
        .where(WhatsAppFlow.phone_number == phone_number)
        .order_by(WhatsAppFlow.last_interaction_at.desc())
    )
    if not flow:
        raise HTTPException(404, "No flow for this number")
    return flow
