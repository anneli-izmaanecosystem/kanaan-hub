"""The sends nobody triggers by hand: the evening reminder, the driver's "I have left"
card, the (skipped) hold, the chaser when Anneli has not answered, and the no-show
question when the driver has waited too long.

`tick` is idempotent through trip_events: each send writes a marker event first and skips
trips that already carry it. It runs in a background thread every few minutes; a Postgres
advisory lock keeps two replicas (or an overlapping manual run) from ticking at once.
"""

import logging
import threading
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, text

from app.bot import hub_db, trip as T
from app.bot.hub_db import now
from app.bot.settings_store import load_settings
from app.bot.when import format_when_short, sa_date, sa_hour
from app.config import get_settings

log = logging.getLogger("kanaan.bot.scheduler")

LOCK_KEY = 747_597  # arbitrary, fixed: pg_try_advisory_lock key for the tick
MIN = 60


def tick(at: Optional[datetime] = None) -> dict[str, list[str]]:
    at = at or now()
    report: dict[str, list[str]] = {
        "eveningReminders": [], "driverReminders": [], "holds": [], "opsChased": [], "noShowsAsked": [], "errors": []}

    with hub_db.engine().connect() as lock_conn:
        if not lock_conn.execute(text("select pg_try_advisory_lock(:k)"), {"k": LOCK_KEY}).scalar():
            report["errors"].append("another tick is running")
            return report
        try:
            _run(at, report)
        finally:
            lock_conn.execute(text("select pg_advisory_unlock(:k)"), {"k": LOCK_KEY})
            lock_conn.commit()
    return report


def _check_payments(at: datetime, report: dict[str, list[str]]) -> None:
    """Paystack sends a webhook only for successful charges. A declined card is found by
    asking Paystack about each open payment link (and a success whose webhook went
    missing is caught the same way). Links older than two days are left alone."""
    if not T.payments_configured():
        return
    from app import paystack
    from app.db import SessionLocal
    from app.routers.payments import record as record_payment

    t = hub_db.trips
    with hub_db.begin() as c:
        unpaid = hub_db.rows(c.execute(select(t).where(
            t.c.payment_ref.is_not(None), t.c.captured_at.is_(None),
            t.c.status.in_(list(T.ACTIVE_STATUSES) + ["completed", "no_show"]))))
    for trip in unpaid:
        requested = [e.at for e in T.events_for(trip.id) if e.event.endswith("_payment_requested") and e.detail == trip.payment_ref]
        if not requested or at - max(requested) > timedelta(days=2):
            continue
        try:
            tx = paystack.verify_transaction(get_settings(), trip.payment_ref)
        except Exception as err:
            # A link made with the test key is invisible to the live key (and the other way
            # round) - after switching modes that is expected, not an error.
            if not paystack.is_not_found(err):
                report["errors"].append(f"{trip.ref}: paystack verify {err}")
            continue
        status = tx.get("status")
        if status not in ("success", "failed"):
            continue  # "abandoned" = link not paid yet; "ongoing" = guest mid-payment
        try:
            with SessionLocal() as db:
                record_payment(db, tx, event="scheduler")
        except Exception:
            log.exception("could not record the payment check for %s", trip.ref)
        if status == "success":
            T.payment_received(tx)
            report.setdefault("paymentsFound", []).append(trip.ref)
        else:
            T.payment_failed(tx)
            report.setdefault("paymentsFailed", []).append(trip.ref)


def _run(at: datetime, report: dict[str, list[str]]) -> None:
    try:
        _check_payments(at, report)
    except Exception as err:
        log.exception("payment check failed")
        report["errors"].append(f"payment check: {err}")
    settings = load_settings()
    with hub_db.begin() as c:
        open_trips = hub_db.rows(c.execute(select(hub_db.trips).where(
            hub_db.trips.c.status.in_(["requested", "allocated", "driver_en_route", "driver_waiting"]))))

    for trip in open_trips:
        try:
            events = T.events_for(trip.id)
            has = lambda name: any(e.event == name for e in events)  # noqa: E731

            def latest(*names: str) -> Optional[datetime]:
                times = [e.at for e in events if e.event in names]
                return max(times) if times else None

            until_pickup = (trip.scheduled_at - at).total_seconds()

            # Anneli has not answered.
            if trip.status == "requested":
                if not has("ops_chased"):
                    sent_at = latest("sent_to_ops", "time_accepted")
                    if sent_at and (at - sent_at).total_seconds() >= settings.ops_response_min * MIN:
                        T.record(trip.id, "system", "ops_chased")
                        minutes = round((at - sent_at).total_seconds() / MIN)
                        if settings.ops_whatsapp:
                            T.notify("ops", settings.ops_whatsapp, trip.id, "kn_ops_request_unanswered", [trip.ref, str(minutes)])
                        T.notify("guest", trip.guest_phone, trip.id, "kn_guest_still_waiting", [format_when_short(trip.scheduled_at)])
                        report["opsChased"].append(trip.ref)
                continue

            driver = T.driver_for(trip)
            if not driver:
                continue

            # The evening before, from 20:00 South African time.
            if (trip.status == "allocated" and not has("guest_reminder_sent")
                    and sa_date(trip.scheduled_at) == sa_date(at + timedelta(days=1)) and sa_hour(at) >= 20):
                T.send_evening_reminder(trip, driver)
                report["eveningReminders"].append(trip.ref)

            # The hold, an hour before (recorded and skipped — see trip.place_hold).
            if trip.status == "allocated" and not has("hold_attempted") and until_pickup <= settings.hold_before_min * MIN:
                T.record(trip.id, "system", "hold_attempted")
                T.place_hold(trip)
                report["holds"].append(trip.ref)

            # The driver's "I have left" card, shortly before pickup — not for trips hours
            # overdue, which are wedged bookings for the board, not a nudge.
            if (trip.status == "allocated" and not has("driver_reminder_sent")
                    and until_pickup <= settings.driver_nudge_min * MIN and until_pickup > -3 * 60 * MIN):
                T.send_driver_reminder(trip, driver)
                report["driverReminders"].append(trip.ref)

            # The guest has not appeared: measured from the driver's arrival, or the last
            # time Anneli said to keep waiting.
            if trip.status == "driver_waiting":
                since = latest("driver_arrived", "keep_waiting", "guest_coming")
                asked = latest("no_show_asked")
                if since and (asked is None or asked < since) and (at - since).total_seconds() >= settings.no_show_wait_min * MIN:
                    T.ask_about_no_show(trip, driver, round((at - since).total_seconds() / MIN))
                    report["noShowsAsked"].append(trip.ref)
        except Exception as err:
            log.exception("scheduler failed for %s", trip.ref)
            report["errors"].append(f"{trip.ref}: {err}")


# ── background loop ──────────────────────────────────────────────────────────

_stop = threading.Event()


def _loop() -> None:
    interval = max(30, get_settings().bot_scheduler_interval_sec)
    while not _stop.wait(interval):
        try:
            report = tick()
            if any(report[k] for k in report if k != "errors") or report["errors"]:
                log.info("tick: %s", report)
        except Exception:
            log.exception("scheduler tick failed")


def start() -> None:
    s = get_settings()
    if not (s.bot_configured and s.bot_scheduler_enabled):
        return
    threading.Thread(target=_loop, name="bot-scheduler", daemon=True).start()
    log.info("bot scheduler running every %ss", max(30, s.bot_scheduler_interval_sec))


def stop() -> None:
    _stop.set()
