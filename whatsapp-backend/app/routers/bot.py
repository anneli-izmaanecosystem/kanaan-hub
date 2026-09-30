"""Service-to-service calls into the booking bot, gated by X-Internal-Secret.

The Next.js dashboard uses these for the board's manual interventions — allocating a
driver or cancelling a trip for a guest who phoned instead of replying — so the guest,
driver and Anneli are told exactly as they would be from WhatsApp.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.routers.internal import require_internal_secret

router = APIRouter(prefix="/bot", tags=["bot"], dependencies=[Depends(require_internal_secret)])


def _require_bot(settings: Settings = Depends(get_settings)) -> None:
    if not settings.bot_configured:
        raise HTTPException(503, "Booking bot not configured (KANAAN_HUB_DATABASE_URL)")


class AllocateIn(BaseModel):
    driver_id: int


class CancelIn(BaseModel):
    reason: Optional[str] = None


@router.post("/trips/{trip_id}/allocate", dependencies=[Depends(_require_bot)])
def allocate(trip_id: int, payload: AllocateIn):
    from app.bot import trip as T

    trip = T.get_trip(trip_id)
    if not trip:
        raise HTTPException(404, "Trip not found")
    if not T.get_driver(payload.driver_id):
        raise HTTPException(400, "Driver not found")
    T.allocate_driver(trip.id, payload.driver_id, "board", reassign=bool(trip.driver_id))
    return {"status": "ok"}


@router.post("/trips/{trip_id}/cancel", dependencies=[Depends(_require_bot)])
def cancel(trip_id: int, payload: CancelIn):
    from app.bot import trip as T

    if not T.get_trip(trip_id):
        raise HTTPException(404, "Trip not found")
    T.cancel_trip(trip_id, "ops", payload.reason or "cancelled from the board")
    return {"status": "ok"}


@router.post("/tick", dependencies=[Depends(_require_bot)])
def tick():
    """Runs the scheduled sends now. The background loop does this on its own."""
    from app.bot.scheduler import tick as run

    return run()
