from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.meta_client import MetaClient, MetaGraphError
from app.models import WhatsAppTemplate
from app.schemas import TemplateCreate, TemplateOut
from app.supabase_auth import require_supabase_user
from app.utils import utcnow

router = APIRouter(prefix="/templates", tags=["templates"], dependencies=[Depends(require_supabase_user)])


@router.get("", response_model=list[TemplateOut])
def list_templates(db: Session = Depends(get_db)):
    return db.scalars(select(WhatsAppTemplate).order_by(WhatsAppTemplate.created_at.desc())).all()


@router.post("", response_model=TemplateOut, status_code=201)
def create_template(
    payload: TemplateCreate,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Saves the template as a draft and, if Meta credentials are configured, submits it
    for review immediately. Registration failures don't lose the draft — the row is kept
    with status DRAFT and the Graph error surfaced to the caller."""
    template = WhatsAppTemplate(
        name=payload.name,
        language=payload.language,
        category=payload.category,
        components=[c.model_dump(exclude_none=True) for c in payload.components],
        body_preview=payload.body_preview,
        created_by=payload.created_by,
        status="DRAFT",
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    if settings.whatsapp_configured and settings.whatsapp_business_account_id:
        try:
            result = MetaClient(settings).create_template(
                name=template.name,
                language=template.language,
                category=template.category,
                components=template.components,
            )
            template.meta_template_id = result.get("id")
            template.status = result.get("status", "PENDING")
            template.submitted_at = utcnow()
            db.commit()
            db.refresh(template)
        except MetaGraphError as exc:
            template.status = "REJECTED"
            template.rejected_reason = str(exc)
            db.commit()
            db.refresh(template)

    return template


@router.post("/{template_id}/sync", response_model=TemplateOut)
def sync_template_status(
    template_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Pulls the latest status for one template from Meta — use after a PENDING template
    may have been approved or rejected."""
    template = db.get(WhatsAppTemplate, template_id)
    if not template:
        raise HTTPException(404, "Template not found")
    if not settings.whatsapp_configured:
        raise HTTPException(400, "WhatsApp credentials not configured")

    remote = MetaClient(settings).list_templates()
    match = next((t for t in remote if t.get("name") == template.name and t.get("language") == template.language), None)
    if match:
        template.status = match.get("status", template.status)
        template.meta_template_id = match.get("id", template.meta_template_id)
        if match.get("status") == "REJECTED":
            template.rejected_reason = (match.get("rejected_reason") or {}).get("description") if isinstance(match.get("rejected_reason"), dict) else match.get("rejected_reason")
        template.reviewed_at = utcnow()
        db.commit()
        db.refresh(template)
    return template


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: str,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    template = db.get(WhatsAppTemplate, template_id)
    if not template:
        raise HTTPException(404, "Template not found")
    if settings.whatsapp_configured and template.meta_template_id:
        try:
            MetaClient(settings).delete_template(template.name)
        except MetaGraphError:
            pass  # already gone on Meta's side, or never made it — still clear locally
    db.delete(template)
    db.commit()
