from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC now — matches the database's `timestamp without time zone` columns,
    same convention the rest of notification_service uses (see users.created_at)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
