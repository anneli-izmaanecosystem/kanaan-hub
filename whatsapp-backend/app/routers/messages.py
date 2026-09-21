from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.meta_client import MetaClient, MetaGraphError
from app.models import WhatsAppLog
from app.schemas import LogOut, SendMessageRequest
from app.supabase_auth import require_supabase_user

router = APIRouter(prefix="/messages", tags=["messages"], dependencies=[Depends(require_supabase_user)])


@router.post("/send", response_model=LogOut, status_code=201)
def send_message(
    payload: SendMessageRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Manual send from the admin UI — a resend, or a one-off template outside the app's
    own booking flow. Outbound sends from the booking flow itself still go through the
    Next.js app; this exists for admin/ops use."""
    if not settings.whatsapp_configured:
        raise HTTPException(400, "WhatsApp credentials not configured")

    client = MetaClient(settings)
    try:
        if payload.kind == "template":
            if not payload.template_name:
                raise HTTPException(422, "template_name is required for kind=template")
            wa_message_id = client.send_template(
                payload.to, payload.template_name, payload.template_language, payload.template_body_params
            )
        else:
            if not payload.body:
                raise HTTPException(422, "body is required for kind=text")
            wa_message_id = client.send_text(payload.to, payload.body)
    except MetaGraphError as exc:
        raise HTTPException(502, str(exc)) from exc

    log = WhatsAppLog(
        wa_message_id=wa_message_id,
        direction="outbound",
        phone_number=payload.to,
        message_type=payload.kind,
        template_name=payload.template_name,
        body=payload.body or f"[template: {payload.template_name}]",
        payload=payload.model_dump(),
        status="sent",
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log
