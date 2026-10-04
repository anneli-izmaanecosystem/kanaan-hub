"""Paystack payments for the WhatsApp car booking.

Two faces:

- Public, for Paystack (set in Paystack > Settings > API Keys & Webhooks):
    POST /payments/paystack/webhook   signed with x-paystack-signature (HMAC-SHA512)
    GET  /payments/paystack/callback  where the guest's browser lands after the card page
  Both verify the transaction with Paystack, record it in kanaan_payments, and hand it
  to the booking bot (app/bot/trip.py), which marks the trip paid and tells the guest
  and Anneli.

- Internal, gated by X-Internal-Secret like /internal/*: create a payment link, verify
  a payment, list payments. Nothing is taken at booking and nothing is refunded here;
  the guest pays by link once Anneli has accepted, or after the ride.
"""

import html
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import paystack
from app.config import Settings, get_settings
from app.db import SessionLocal, get_db
from app.models import Payment
from app.routers.internal import require_internal_secret
from app.utils import utcnow

router = APIRouter(prefix="/payments", tags=["payments"])


# ── recording ────────────────────────────────────────────────────────────────


def record(
    db: Session,
    tx: dict[str, Any],
    *,
    event: Optional[str] = None,
    status: Optional[str] = None,
    phone: Optional[str] = None,
    trip_ref: Optional[str] = None,
) -> Payment:
    """Upserts the kanaan_payments row for a Paystack transaction, keyed by reference."""
    reference = tx["reference"]
    row = db.scalar(select(Payment).where(Payment.reference == reference))
    if not row:
        row = Payment(reference=reference, status="pending")
        db.add(row)
    meta = paystack.metadata_of(tx)
    auth = tx.get("authorization") or {}
    if meta.get("tripId") is not None:
        row.trip_id = int(meta["tripId"])
    row.purpose = meta.get("purpose") or row.purpose
    if not trip_ref and not row.trip_ref:
        for marker in ("-fare-", "-noshow-"):
            if marker in reference:
                trip_ref = reference.split(marker)[0]
    row.trip_ref = trip_ref or row.trip_ref
    row.status = status or tx.get("status") or row.status
    row.amount_cents = tx.get("amount", row.amount_cents)
    row.currency = tx.get("currency") or row.currency
    row.email = (tx.get("customer") or {}).get("email") or row.email
    row.phone_number = phone or row.phone_number
    row.card_brand = auth.get("brand") or row.card_brand
    row.card_last4 = auth.get("last4") or row.card_last4
    row.gateway_response = tx.get("gateway_response") or row.gateway_response
    row.last_event = event or row.last_event
    # The link Paystack gave when the payment was started, which its later reports of the
    # transaction leave out: the consent page still needs it to send the guest on.
    link = (row.raw or {}).get("authorization_url")
    row.raw = {**tx, "authorization_url": link} if link and not tx.get("authorization_url") else tx
    row.updated_at = utcnow()
    db.commit()
    db.refresh(row)
    return row


def _mark_forwarded(reference: str, error: Optional[str]) -> None:
    with SessionLocal() as db:
        row = db.scalar(select(Payment).where(Payment.reference == reference))
        if row:
            row.forwarded_at = utcnow() if not error else row.forwarded_at
            row.forward_error = error
            db.commit()


def _hand_to_bot(reference: str, tx: dict[str, Any]) -> None:
    """Marks the trip paid and tells the guest and Anneli. Safe to run twice (webhook and
    browser callback both call it); forwarded_at / forward_error record the outcome."""
    from app.bot.trip import payment_received

    if not get_settings().bot_configured:
        _mark_forwarded(reference, "booking bot not configured (KANAAN_HUB_DATABASE_URL)")
        return
    try:
        payment_received(tx)
        _mark_forwarded(reference, None)
    except Exception as err:  # recorded on the payment row for the admin page
        _mark_forwarded(reference, str(err))


def _tell_bot(handler: str, tx: dict[str, Any]) -> None:
    """A payment that did not go through (failed / cancelled): the bot tells the guest,
    driver and Anneli. Never raises into the page the guest is looking at."""
    from app.bot import trip

    if not get_settings().bot_configured:
        return
    try:
        getattr(trip, handler)(tx)
    except Exception:
        import logging
        logging.getLogger("kanaan.payments").exception("%s for %s failed", handler, tx.get("reference"))


# ── public: Paystack ─────────────────────────────────────────────────────────


@router.post("/paystack/webhook")
async def paystack_webhook(
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    raw = await request.body()
    signature = request.headers.get("x-paystack-signature")
    if not paystack.verify_signature(settings, raw, signature):
        raise HTTPException(401, "Invalid signature")

    body = await request.json()
    event = body.get("event")
    data = body.get("data") or {}
    reference = data.get("reference")
    if not reference:
        return {"status": "ignored"}

    # Record Paystack's current view of the transaction, not just the event body.
    try:
        tx = paystack.verify_transaction(settings, reference) if event and event.startswith("charge.") else data
    except paystack.PaystackError:
        tx = data
    record(db, {**tx, "reference": reference}, event=event)

    # What marks the trip paid is Paystack's current record, not the event body.
    if event == "charge.success" and tx.get("status") == "success":
        background.add_task(_hand_to_bot, reference, {**tx, "reference": reference})
    return {"status": "ok"}


@router.get("/paystack/callback", response_class=HTMLResponse)
def paystack_callback(
    reference: Optional[str] = Query(None),
    trxref: Optional[str] = Query(None),
    cancelled: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    """Where the guest's browser lands after paying — or after tapping Cancel, when the
    cancel_action set in paystack.start_payment adds cancelled=1."""
    ref = reference or trxref
    outcome = "unknown"
    if ref:
        try:
            tx = paystack.verify_transaction(settings, ref)
            record(db, tx, event="cancelled" if cancelled else "callback")
            status = tx.get("status")
            if status == "success":
                # In case the webhook is slow or not configured: marking the trip paid is
                # safe to run twice, so whichever lands first wins.
                outcome = "paid"
                _hand_to_bot(ref, tx)
            elif status == "failed":
                outcome = "failed"
                _tell_bot("payment_failed", tx)
            elif cancelled:
                outcome = "cancelled"
                _tell_bot("payment_cancelled", tx)
        except paystack.PaystackError:
            outcome = "unknown"

    title, message = {
        "paid": ("Payment received", "Thank you for your payment. You can go back to WhatsApp now."),
        "failed": ("Payment did not go through", "No money was taken. Go back to WhatsApp and tap \"Try again\" to use the same or another card."),
        "cancelled": ("Payment cancelled", "No money was taken. You can pay later from WhatsApp whenever you are ready."),
    }.get(outcome, ("Payment not completed", 'We could not confirm your payment. Go back to WhatsApp and tap "Pay now" to try again.'))
    return _page(settings, title, f"<p>{html.escape(message)}</p>")


def _page(settings: Settings, title: str, content: str, consent: bool = False) -> HTMLResponse:
    """A page the guest sees in their phone's browser, with the way back to the chat."""
    wa = "https://wa.me/" + "".join(c for c in settings.kanaan_whatsapp_number if c.isdigit())
    return HTMLResponse(f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} - Kanaan Guest Farm</title>
<style>
  body {{ margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #f0f2f5; color: #111b21; }}
  main {{ max-width: 420px; margin: 15vh auto 0; padding: 32px 24px; background: #fff; border-radius: 12px; text-align: center; }}
  h1 {{ font-size: 22px; margin: 0 0 12px; }}
  p {{ font-size: 16px; line-height: 1.5; color: #54656f; margin: 0 0 24px; }}
  a {{ display: inline-block; padding: 12px 24px; border-radius: 24px; background: #1f4d3a; color: #fff; text-decoration: none; font-weight: 600; }}
  main.consent {{ margin-top: 6vh; text-align: left; }}
  .consent h1, .consent .amount {{ text-align: center; }}
  .amount {{ font-size: 20px; font-weight: 600; color: #111b21; }}
  ul {{ margin: 0 0 20px; padding-left: 20px; color: #3b4a54; font-size: 15px; line-height: 1.5; }}
  li {{ margin-bottom: 10px; }}
  .policy {{ margin-bottom: 20px; font-size: 15px; }}
  .policy a {{ display: block; padding: 6px 0; background: none; color: #1f4d3a; text-decoration: underline; font-weight: 600; }}
  .small {{ font-size: 14px; margin-bottom: 16px; }}
  button {{ width: 100%; padding: 14px; border: 0; border-radius: 24px; background: #1f4d3a; color: #fff; font-size: 16px; font-weight: 600; cursor: pointer; }}
  .back {{ display: block; margin-top: 12px; background: #e8ecef; color: #111b21; text-align: center; }}
</style>
</head>
<body>
<main{' class="consent"' if consent else ''}>
  <h1>{html.escape(title)}</h1>
  {content}
  <a class="back" href="{wa}">Back to WhatsApp</a>
</main>
</body>
</html>""")


# ── public: the guest's "Pay now" ────────────────────────────────────────────
#
# The Pay now button in WhatsApp opens this page first, not Paystack: what Paystack does
# with the guest's card and personal details, and an Agree button that goes on to Paystack's
# own payment page. The statements below are Paystack's own (its help centre, "How secure
# is Paystack"); the full policy is Paystack's page, linked rather than copied, so it is
# always the current one.

PAYSTACK_PRIVACY_URL = "https://paystack.com/privacy/merchant"
PAYSTACK_SECURITY_URL = "https://support.paystack.com/hc/en-us/articles/360009881160-How-secure-is-Paystack"
AGREED = "paystack_policy_agreed"  # trip_events: the guest tapped Agree


def _payable(db: Session, reference: str) -> tuple[Optional[Payment], Optional[str], Optional[str]]:
    """(payment row, Paystack link, why it cannot be paid) for a consent page."""
    row = db.scalar(select(Payment).where(Payment.reference == reference))
    link = (row.raw or {}).get("authorization_url") if row else None
    if not row or not link:
        return row, None, 'This payment link is not known. Go back to WhatsApp and tap "Pay now" for a new one.'
    if row.status == "success":
        return row, None, "This payment has already been made. Thank you - nothing more to pay."
    if get_settings().bot_configured and row.trip_id and row.purpose == "fare":
        from app.bot.trip import get_trip  # late: the hub database is only there when the bot is
        trip = get_trip(row.trip_id)
        # Paid another way since this link was sent (on the driver's card machine, or by a
        # newer link): paying here would charge the guest twice.
        if trip and trip.captured_at:
            return row, None, f"Trip {trip.ref} is already paid. Thank you - nothing more to pay."
    return row, link, None


@router.get("/pay/{reference}", response_class=HTMLResponse)
def consent_page(reference: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    row, link, closed = _payable(db, reference)
    if closed:
        return _page(settings, "Nothing to pay", f"<p>{html.escape(closed)}</p>")
    amount = f"R {(row.amount_cents or 0) / 100:,.2f}".replace(",", " ")
    what = "No-show fee" if row.purpose == "noshow" else "Fare"
    trip = f" - trip {html.escape(row.trip_ref)}" if row.trip_ref else ""
    return _page(settings, "Secure payment with Paystack", f"""<p class="amount">{what}: {amount}{trip}</p>
  <ul>
    <li>You pay on Paystack's own secure payment page. Kanaan Guest Farm never sees or stores your card details.</li>
    <li>Paystack is certified PCI DSS Level 1, the highest security standard in the card payments industry, and encrypts card data.</li>
    <li>Paystack handles your personal information under its privacy policy.</li>
  </ul>
  <div class="policy">
    <a href="{PAYSTACK_PRIVACY_URL}" target="_blank" rel="noopener">Read Paystack's Privacy Policy</a>
    <a href="{PAYSTACK_SECURITY_URL}" target="_blank" rel="noopener">How Paystack keeps payments safe</a>
  </div>
  <p class="small">By tapping Agree you accept Paystack's Privacy Policy and continue to Paystack to pay.</p>
  <form method="post"><button type="submit">Agree</button></form>""", consent=True)


@router.post("/pay/{reference}")
def consent_agreed(reference: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    """Agree: noted on the trip, then on to Paystack's payment page."""
    row, link, closed = _payable(db, reference)
    if closed:
        return _page(settings, "Nothing to pay", f"<p>{html.escape(closed)}</p>")
    if settings.bot_configured and row.trip_id:
        from app.bot.trip import record as record_event
        try:
            record_event(row.trip_id, "guest", AGREED, reference)
        except Exception:
            import logging
            logging.getLogger("kanaan.payments").exception("could not record the agreement for %s", reference)
    return RedirectResponse(link, status_code=303)


# ── internal API ─────────────────────────────────────────────────────────────


class PaymentLinkIn(BaseModel):
    trip_id: int
    trip_ref: str
    phone_number: str
    amount_rand: float
    purpose: str = "fare"  # fare | noshow


def _paystack_errors(fn):
    try:
        return fn()
    except paystack.PaystackError as err:
        raise HTTPException(502, str(err))


@router.post("/payment-link", dependencies=[Depends(require_internal_secret)])
def payment_link(payload: PaymentLinkIn, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    """Creates a payment for a trip (the fare, or a no-show fee) and returns the hosted page link."""
    email = paystack.guest_email(settings, payload.phone_number)
    data = _paystack_errors(
        lambda: paystack.start_payment(
            settings, payload.trip_id, payload.trip_ref, email, payload.amount_rand, payload.purpose
        )
    )
    record(
        db,
        {
            "reference": data["reference"],
            "status": "pending",
            "amount": round(payload.amount_rand * 100),
            "currency": paystack.CURRENCY,
            "customer": {"email": email},
            "metadata": {"tripId": payload.trip_id, "purpose": payload.purpose},
        },
        phone=payload.phone_number,
        trip_ref=payload.trip_ref,
    )
    return {"authorization_url": data["authorization_url"], "reference": data["reference"]}


@router.get("/verify/{reference}", dependencies=[Depends(require_internal_secret)])
def verify(reference: str, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    tx = _paystack_errors(lambda: paystack.verify_transaction(settings, reference))
    record(db, tx, event="verify")
    return {
        "reference": tx["reference"],
        "status": tx.get("status"),
        "amount_cents": tx.get("amount"),
        "metadata": paystack.metadata_of(tx),
    }


@router.get("", dependencies=[Depends(require_internal_secret)])
def list_payments(limit: int = 100, db: Session = Depends(get_db)):
    rows = db.scalars(select(Payment).order_by(Payment.created_at.desc()).limit(min(limit, 500))).all()
    return [
        {
            "reference": r.reference,
            "trip_ref": r.trip_ref,
            "purpose": r.purpose,
            "status": r.status,
            "amount_cents": r.amount_cents,
            "card": f"{r.card_brand} ****{r.card_last4}" if r.card_last4 else None,
            "created_at": r.created_at,
            "forwarded_at": r.forwarded_at,
            "forward_error": r.forward_error,
        }
        for r in rows
    ]
