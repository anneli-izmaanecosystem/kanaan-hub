import secrets
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db import get_db
from app.models import WhatsAppFlow, WhatsAppLog, WhatsAppTemplate
from app.routers.conversations import list_conversations

router = APIRouter(prefix="/admin", tags=["admin"])
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent.parent / "templates"))
security = HTTPBasic(auto_error=False)


def require_admin(
    credentials: HTTPBasicCredentials = Depends(security),
    settings: Settings = Depends(get_settings),
):
    if not settings.admin_username:
        return  # no admin auth configured — open (dev use only, see README)
    valid = credentials and secrets.compare_digest(credentials.username, settings.admin_username) and secrets.compare_digest(
        credentials.password, settings.admin_password
    )
    if not valid:
        raise HTTPException(401, "Unauthorized", headers={"WWW-Authenticate": "Basic"})


@router.get("", response_class=HTMLResponse)
def dashboard(request: Request, db: Session = Depends(get_db), _=Depends(require_admin)):
    conversations = list_conversations(db)
    templates_list = db.scalars(select(WhatsAppTemplate).order_by(WhatsAppTemplate.created_at.desc())).all()
    return templates.TemplateResponse(
        "dashboard.html",
        {"request": request, "conversations": conversations, "templates_list": templates_list},
    )


@router.get("/conversations/{phone_number}", response_class=HTMLResponse)
def conversation_thread(
    phone_number: str, request: Request, db: Session = Depends(get_db), _=Depends(require_admin)
):
    messages = db.scalars(
        select(WhatsAppLog).where(WhatsAppLog.phone_number == phone_number).order_by(WhatsAppLog.created_at.asc())
    ).all()
    flow = db.scalar(
        select(WhatsAppFlow)
        .where(WhatsAppFlow.phone_number == phone_number)
        .order_by(WhatsAppFlow.last_interaction_at.desc())
    )
    return templates.TemplateResponse(
        "thread.html",
        {"request": request, "phone_number": phone_number, "messages": messages, "flow": flow},
    )


@router.get("/templates", response_class=HTMLResponse)
def templates_page(request: Request, db: Session = Depends(get_db), _=Depends(require_admin)):
    templates_list = db.scalars(select(WhatsAppTemplate).order_by(WhatsAppTemplate.created_at.desc())).all()
    return templates.TemplateResponse("templates.html", {"request": request, "templates_list": templates_list})
