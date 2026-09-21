import json
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from app.db import Base


def _new_id() -> str:
    """UUID-string primary keys, generated app-side — matches every other table in
    notification_service (users, alert, crm_email_template, ...), all of which use
    varchar ids with no DB-level default."""
    return str(uuid.uuid4())


class JSONText(TypeDecorator):
    """Stores a dict/list as a TEXT column, serialized as JSON. notification_service has
    no jsonb columns anywhere (alert.data, crm_email_template.body_html etc. are all
    TEXT) — this keeps the new tables consistent with that rather than introducing the
    first native json column in the database."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> str:
        return json.dumps(value if value is not None else {})

    def process_result_value(self, value: Optional[str], dialect: Any) -> Any:
        return json.loads(value) if value else {}


class WhatsAppTemplate(Base):
    __tablename__ = "kanaan_whatsapp_templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    name: Mapped[str] = mapped_column(String, nullable=False)
    language: Mapped[str] = mapped_column(String, nullable=False, default="en_GB")
    category: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="DRAFT")
    meta_template_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    components: Mapped[list[Any]] = mapped_column(JSONText, nullable=False, default=list)
    body_preview: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rejected_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class WhatsAppFlow(Base):
    __tablename__ = "kanaan_whatsapp_flows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    phone_number: Mapped[str] = mapped_column(String, nullable=False)
    flow_name: Mapped[str] = mapped_column(String, nullable=False, default="kanaan_chatbot")
    status: Mapped[str] = mapped_column(String, nullable=False, default="active")
    current_step: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    context: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False, default=dict)
    started_at: Mapped[datetime] = mapped_column(server_default=func.now())
    last_interaction_at: Mapped[datetime] = mapped_column(server_default=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    logs: Mapped[list["WhatsAppLog"]] = relationship(back_populates="flow")


class WhatsAppLog(Base):
    __tablename__ = "kanaan_whatsapp_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_new_id)
    wa_message_id: Mapped[Optional[str]] = mapped_column(String, unique=True, nullable=True)
    flow_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("kanaan_whatsapp_flows.id", ondelete="SET NULL"), nullable=True
    )
    direction: Mapped[str] = mapped_column(String, nullable=False)
    phone_number: Mapped[str] = mapped_column(String, nullable=False)
    message_type: Mapped[str] = mapped_column(String, nullable=False)
    template_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String, nullable=False, default="received")
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    flow: Mapped[Optional[WhatsAppFlow]] = relationship(back_populates="logs")
