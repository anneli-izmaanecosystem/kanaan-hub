"""The kanaan_hub database — where the bot keeps trips, drivers, conversations and fare
settings, and where the Next.js dashboard reads them.

The tables are owned by the dashboard's Drizzle schema (lib/db/schema.ts) and created by
its migrations; these are Core definitions of the columns the bot touches, never used to
create anything. Keep them in step with that file.

Timestamps are `timestamp without time zone` holding UTC, as Drizzle writes them. Rows
are handed out as plain objects (`Row`) with naive datetimes converted to aware UTC, and
everything written back goes through `db_time` to strip the zone again.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Optional

from sqlalchemy import (
    Boolean, Column, DateTime, Integer, MetaData, Numeric, String, Table, Text, create_engine,
)
from sqlalchemy.dialects.postgresql import ENUM
from sqlalchemy.engine import Connection, Engine

from app.config import get_settings

metadata = MetaData()


def _enum(name: str, *values: str) -> ENUM:
    return ENUM(*values, name=name, create_type=False)


TRIP_STATUS = _enum(
    "trip_status", "draft", "requested", "declined", "allocated", "driver_en_route",
    "driver_waiting", "in_progress", "completed", "cancelled", "no_show",
)
TRIP_DIRECTION = _enum("trip_direction", "pickup", "drop")
WA_ROLE = _enum("wa_role", "guest", "ops", "driver")
WA_DIRECTION = _enum("wa_direction", "inbound", "outbound")
TRIP_ACTOR = _enum("trip_actor", "guest", "ops", "driver", "system")

drivers = Table(
    "drivers", metadata,
    Column("id", Integer, primary_key=True),
    Column("name", Text, nullable=False),
    Column("phone", Text, nullable=False),
    Column("plate", Text, nullable=False),
    Column("vehicle", Text),
    Column("active", Boolean, nullable=False),
    Column("on_duty", Boolean, nullable=False),
    Column("created_at", DateTime),
)

trips = Table(
    "trips", metadata,
    Column("id", Integer, primary_key=True),
    Column("ref", Text, nullable=False),
    Column("direction", TRIP_DIRECTION, nullable=False),
    Column("status", TRIP_STATUS, nullable=False),
    Column("guest_phone", Text, nullable=False),
    Column("guest_name", Text),
    Column("room_label", Text),
    Column("place_name", Text),
    Column("place_lat", Numeric(10, 7)),
    Column("place_lng", Numeric(10, 7)),
    Column("distance_km", Numeric(6, 2)),
    Column("duration_min", Integer),
    Column("scheduled_at", DateTime),
    Column("fare", Numeric(10, 2)),
    Column("driver_id", Integer),
    Column("payment_ref", Text),
    Column("held_at", DateTime),
    Column("captured_at", DateTime),
    Column("released_at", DateTime),
    Column("cancelled_at", DateTime),
    Column("completed_at", DateTime),
    Column("created_at", DateTime),
    Column("updated_at", DateTime),
)

trip_events = Table(
    "trip_events", metadata,
    Column("id", Integer, primary_key=True),
    Column("trip_id", Integer, nullable=False),
    Column("actor", TRIP_ACTOR, nullable=False),
    Column("event", Text, nullable=False),
    Column("detail", Text),
    Column("at", DateTime),
)

wa_conversations = Table(
    "wa_conversations", metadata,
    Column("id", Integer, primary_key=True),
    Column("phone", Text, nullable=False),
    Column("role", WA_ROLE, nullable=False),
    Column("step", Text, nullable=False),
    Column("draft", Text),
    Column("trip_id", Integer),
    Column("last_inbound_at", DateTime),
    Column("updated_at", DateTime),
)

wa_messages = Table(
    "wa_messages", metadata,
    Column("id", Integer, primary_key=True),
    Column("wa_message_id", Text),
    Column("phone", Text, nullable=False),
    Column("role", WA_ROLE, nullable=False),
    Column("direction", WA_DIRECTION, nullable=False),
    Column("kind", Text, nullable=False),
    Column("template_name", Text),
    Column("body", Text),
    Column("payload", Text),
    Column("trip_id", Integer),
    Column("created_at", DateTime),
)

destinations = Table(
    "destinations", metadata,
    Column("id", Integer, primary_key=True),
    Column("name", Text, nullable=False),
    Column("aliases", Text),
    Column("lat", Numeric(10, 7), nullable=False),
    Column("lng", Numeric(10, 7), nullable=False),
    Column("fixed_fare", Numeric(10, 2)),
    Column("active", Boolean, nullable=False),
)

transfer_settings = Table(
    "transfer_settings", metadata,
    Column("id", Integer, primary_key=True),
    Column("fare_base", Numeric(10, 2)),
    Column("fare_per_km", Numeric(10, 2)),
    Column("fare_minimum", Numeric(10, 2)),
    Column("max_chat_km", Integer),
    Column("ops_response_min", Integer),
    Column("no_show_wait_min", Integer),
    Column("hold_before_min", Integer),
    Column("driver_nudge_min", Integer),
    Column("charge_no_show", Boolean),
    Column("no_show_fee", Numeric(10, 2)),
    Column("service_start", String),
    Column("service_end", String),
    Column("max_lead_days", Integer),
    Column("ops_whatsapp", Text),
    Column("ops_phone", Text),
    Column("ops_escalation_whatsapp", Text),
    Column("mute_ops_commentary", Boolean),
)


_engine: Optional[Engine] = None


def engine() -> Engine:
    """Created on first use, so the service still boots (and logs webhooks) without it."""
    global _engine
    if _engine is None:
        url = get_settings().kanaan_hub_database_url
        if not url:
            raise RuntimeError("KANAAN_HUB_DATABASE_URL is not set - the booking bot is disabled")
        # The dashboard's URL carries node-postgres's sslmode=no-verify, which libpq
        # rejects; "require" is the libpq spelling of the same thing (encrypted, unverified).
        url = url.replace("sslmode=no-verify", "sslmode=require")
        _engine = create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5)
    return _engine


def begin() -> Any:
    """A connection in a transaction, committed on exit: `with begin() as c: ...`."""
    return engine().begin()


# ── rows and time ────────────────────────────────────────────────────────────


class Row(SimpleNamespace):
    """A row as a plain, mutable object: trip.guest_phone, trip.scheduled_at."""


def _aware(value: Any) -> Any:
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def row(r: Any) -> Optional[Row]:
    if r is None:
        return None
    return Row(**{k: _aware(v) for k, v in r._mapping.items()})


def rows(rs: Any) -> list[Row]:
    return [row(r) for r in rs]


def now() -> datetime:
    return datetime.now(timezone.utc)


def db_time(value: Optional[datetime]) -> Optional[datetime]:
    """Aware -> naive UTC, the shape the timestamp columns hold."""
    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def one(c: Connection, stmt: Any) -> Optional[Row]:
    return row(c.execute(stmt).first())
