"""Pulls every template's current status from Meta and updates the local rows.

Run on a schedule (cron / task scheduler) so PENDING templates flip to APPROVED /
REJECTED without an admin having to click sync on each one.

Usage: python scripts/sync_templates.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.meta_client import MetaClient
from app.models import WhatsAppTemplate
from app.utils import utcnow


def main():
    settings = get_settings()
    if not settings.whatsapp_configured:
        print("WhatsApp credentials not configured — nothing to sync.")
        return

    remote = MetaClient(settings).list_templates()
    remote_by_key = {(t["name"], t["language"]): t for t in remote}

    db = SessionLocal()
    try:
        local = db.scalars(select(WhatsAppTemplate)).all()
        for template in local:
            match = remote_by_key.get((template.name, template.language))
            if not match or match.get("status") == template.status:
                continue
            print(f"{template.name} ({template.language}): {template.status} -> {match['status']}")
            template.status = match["status"]
            template.meta_template_id = match.get("id", template.meta_template_id)
            if match.get("status") == "REJECTED":
                reason = match.get("rejected_reason")
                template.rejected_reason = reason.get("description") if isinstance(reason, dict) else reason
            template.reviewed_at = utcnow()
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
