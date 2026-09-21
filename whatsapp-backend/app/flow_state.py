from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import WhatsAppFlow


def get_or_create_active_flow(db: Session, phone: str, flow_name: str = "kanaan_chatbot") -> WhatsAppFlow:
    """Shared by the webhook receiver and the Next.js mirror endpoints — both need
    'the current active session for this phone', created on first contact."""
    flow = db.scalar(
        select(WhatsAppFlow).where(
            WhatsAppFlow.phone_number == phone,
            WhatsAppFlow.flow_name == flow_name,
            WhatsAppFlow.status == "active",
        )
    )
    if not flow:
        flow = WhatsAppFlow(phone_number=phone, flow_name=flow_name, status="active")
        db.add(flow)
        db.flush()
    return flow
