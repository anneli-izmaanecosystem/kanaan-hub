from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class TemplateComponentParam(BaseModel):
    type: Literal["text"] = "text"
    text: str


class TemplateComponent(BaseModel):
    """Mirrors the shape the Next.js app sends to Graph — see lib/whatsapp/client.ts."""

    type: Literal["HEADER", "BODY", "FOOTER", "BUTTONS"]
    format: Optional[Literal["TEXT", "IMAGE", "VIDEO", "DOCUMENT"]] = None
    text: Optional[str] = None
    buttons: Optional[list[dict[str, Any]]] = None


class TemplateCreate(BaseModel):
    name: str
    language: str = "en_GB"
    category: Literal["MARKETING", "UTILITY", "AUTHENTICATION"]
    components: list[TemplateComponent]
    body_preview: Optional[str] = None
    created_by: Optional[str] = None


class TemplateOut(BaseModel):
    id: str
    name: str
    language: str
    category: str
    status: str
    meta_template_id: Optional[str]
    components: list[dict[str, Any]]
    body_preview: Optional[str]
    rejected_reason: Optional[str]
    submitted_at: Optional[datetime]
    reviewed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class LogOut(BaseModel):
    id: str
    wa_message_id: Optional[str]
    flow_id: Optional[str]
    direction: str
    phone_number: str
    message_type: str
    template_name: Optional[str]
    body: Optional[str]
    status: str
    error_message: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class FlowOut(BaseModel):
    id: str
    phone_number: str
    flow_name: str
    status: str
    current_step: Optional[str]
    context: dict[str, Any]
    started_at: datetime
    last_interaction_at: datetime
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ConversationSummary(BaseModel):
    phone_number: str
    last_message_at: datetime
    last_body: Optional[str]
    last_direction: str
    flow_status: Optional[str]
    unread_inbound: int = Field(default=0)


class SendMessageRequest(BaseModel):
    to: str
    kind: Literal["text", "template"] = "text"
    body: Optional[str] = None
    template_name: Optional[str] = None
    template_language: str = "en_GB"
    template_body_params: list[str] = Field(default_factory=list)


# ── Mirroring (pushed by the Next.js app, which owns the live conversation) ─────────


class MirrorMessageIn(BaseModel):
    wa_message_id: Optional[str] = None
    direction: Literal["inbound", "outbound"]
    phone_number: str
    message_type: str
    template_name: Optional[str] = None
    body: Optional[str] = None
    payload: dict[str, Any] = Field(default_factory=dict)
    status: str = "sent"


class MirrorStatusIn(BaseModel):
    wa_message_id: str
    status: str
    error_message: Optional[str] = None


class MirrorFlowIn(BaseModel):
    phone_number: str
    flow_name: str = "kanaan_car_booking"
    status: str = "active"
    current_step: Optional[str] = None
    context: dict[str, Any] = Field(default_factory=dict)
