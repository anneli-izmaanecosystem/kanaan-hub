from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.flow_state import get_or_create_active_flow
from app.meta_client import verify_webhook_signature
from app.models import WhatsAppLog
from app.utils import utcnow

router = APIRouter(prefix="/webhook", tags=["webhook"])


@router.get("")
def verify(
    hub_mode: Optional[str] = Query(None, alias="hub.mode"),
    hub_verify_token: Optional[str] = Query(None, alias="hub.verify_token"),
    hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
    settings: Settings = Depends(get_settings),
):
    """Meta's one-time webhook handshake, done when the callback URL is configured in
    the App Dashboard."""
    if hub_mode == "subscribe" and hub_verify_token == settings.whatsapp_verify_token and hub_challenge:
        return Response(content=hub_challenge, media_type="text/plain")
    raise HTTPException(403, "Verification failed")


def _extract_body(message: dict[str, Any]) -> Optional[str]:
    msg_type = message.get("type")
    if msg_type == "text":
        return message.get("text", {}).get("body")
    if msg_type == "interactive":
        interactive = message.get("interactive", {})
        if interactive.get("type") == "button_reply":
            return interactive["button_reply"]["title"]
        if interactive.get("type") == "list_reply":
            return interactive["list_reply"]["title"]
    if msg_type == "location":
        loc = message.get("location", {})
        return loc.get("name") or loc.get("address") or f"{loc.get('latitude')},{loc.get('longitude')}"
    return None


@router.post("")
async def receive(request: Request, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    raw = await request.body()

    if settings.whatsapp_app_secret:
        signature = request.headers.get("X-Hub-Signature-256")
        if not verify_webhook_signature(raw, signature, settings.whatsapp_app_secret):
            raise HTTPException(401, "Invalid signature")

    payload = await request.json()

    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})

            for message in value.get("messages", []):
                phone = message.get("from")
                if not phone:
                    continue
                phone = f"+{phone}" if not phone.startswith("+") else phone
                flow = get_or_create_active_flow(db, phone)
                ts = message.get("timestamp")
                if ts:
                    flow.last_interaction_at = datetime.fromtimestamp(int(ts), tz=timezone.utc).replace(tzinfo=None)
                else:
                    flow.last_interaction_at = utcnow()

                exists = db.scalar(select(WhatsAppLog).where(WhatsAppLog.wa_message_id == message.get("id")))
                if exists:
                    continue  # Meta retried a delivery we've already recorded
                db.add(
                    WhatsAppLog(
                        wa_message_id=message.get("id"),
                        flow_id=flow.id,
                        direction="inbound",
                        phone_number=phone,
                        message_type=message.get("type", "other"),
                        body=_extract_body(message),
                        payload=message,
                        status="received",
                    )
                )

            for status_update in value.get("statuses", []):
                log = db.scalar(select(WhatsAppLog).where(WhatsAppLog.wa_message_id == status_update.get("id")))
                if not log:
                    continue
                log.status = status_update.get("status", log.status)
                errors = status_update.get("errors")
                if errors:
                    log.error_message = "; ".join(e.get("message", "") for e in errors)

    db.commit()
    return {"status": "ok"}
