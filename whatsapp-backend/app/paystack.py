"""Paystack client for paying the car booking — the Python side of the same calls the
Next.js app makes in lib/payments/paystack.ts.

Nothing is taken at booking. Once the guest confirms the trip is complete they are sent
a Paystack payment link for the fare (or a no-show fee Anneli chose to charge) and pay on
Paystack's hosted page. Amounts are in cents (Paystack takes the currency subunit) and
ZAR is the only currency Kanaan charges in.
"""

import hashlib
import hmac
import json
import re
import time
from typing import Any, Optional
from urllib.parse import quote

import httpx

from app.config import Settings

API = "https://api.paystack.co"
CURRENCY = "ZAR"


class PaystackError(Exception):
    pass


def mode(settings: Settings) -> Optional[str]:
    """"live", "test", or None when no key is set — from the key's own prefix."""
    key = settings.paystack_secret_key
    if not key:
        return None
    return "live" if key.startswith("sk_live_") else "test" if key.startswith("sk_test_") else "unknown"


def is_not_found(err: Exception) -> bool:
    """A reference this key cannot see — typically a test-mode link checked with the live
    key (test and live are separate on Paystack)."""
    return "not found" in str(err).lower()


def _call(settings: Settings, method: str, path: str, body: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    if not settings.paystack_secret_key:
        raise PaystackError("PAYSTACK_SECRET_KEY is not set")
    with httpx.Client(timeout=30) as client:
        res = client.request(
            method,
            API + path,
            headers={"Authorization": f"Bearer {settings.paystack_secret_key}"},
            json=body,
        )
    try:
        data = res.json()
    except ValueError:
        raise PaystackError(f"Paystack {path}: HTTP {res.status_code}")
    if not data.get("status"):
        raise PaystackError(f"Paystack {path}: {data.get('message', res.status_code)}")
    return data["data"]


def guest_email(settings: Settings, phone: str) -> str:
    return settings.paystack_guest_email.replace("{phone}", re.sub(r"\D", "", phone))


def start_payment(
    settings: Settings, trip_id: int, trip_ref: str, email: str, amount_rand: float, purpose: str
) -> dict[str, Any]:
    """Returns {authorization_url, access_code, reference} for the hosted payment page."""
    # Unique per attempt, so a guest who abandons the page can get a fresh link.
    reference = f"{trip_ref}-{purpose}-{int(time.time() * 1000)}"
    body: dict[str, Any] = {
        "email": email,
        "amount": round(amount_rand * 100),
        "currency": CURRENCY,
        "channels": ["card"],
        "reference": reference,
        "metadata": {"tripId": trip_id, "purpose": purpose},
    }
    if settings.paystack_callback_url:
        body["callback_url"] = settings.paystack_callback_url
        # Where Paystack sends the guest who taps "Cancel" on its page, so the cancel is
        # seen (and everyone told) rather than looking like a link nobody opened.
        sep = "&" if "?" in settings.paystack_callback_url else "?"
        body["metadata"]["cancel_action"] = f"{settings.paystack_callback_url}{sep}reference={reference}&cancelled=1"
    return _call(settings, "POST", "/transaction/initialize", body)


def consent_url(settings: Settings, reference: str) -> Optional[str]:
    """Where the guest's "Pay now" button opens: this service's page with Paystack's privacy
    policy and an Agree button, which goes on to Paystack's own card page (routers/payments.py
    consent_page). This service's public address is taken from the callback URL; without
    one there is no page to send the guest to, so None - and the button opens Paystack."""
    marker = "/payments/paystack/callback"
    if marker not in settings.paystack_callback_url:
        return None
    return settings.paystack_callback_url.split(marker)[0] + f"/payments/pay/{quote(reference, safe='')}"


def verify_transaction(settings: Settings, reference: str) -> dict[str, Any]:
    return _call(settings, "GET", f"/transaction/verify/{reference}")


def metadata_of(tx: dict[str, Any]) -> dict[str, Any]:
    """Paystack echoes metadata back, as a string on some events."""
    meta = tx.get("metadata")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except ValueError:
            meta = None
    return meta if isinstance(meta, dict) else {}


def verify_signature(settings: Settings, raw_body: bytes, header: Optional[str]) -> bool:
    """x-paystack-signature is HMAC-SHA512 of the raw body with the secret key. Fails
    closed when the key is unset, same as the Meta webhook."""
    if not settings.paystack_secret_key or not header:
        return False
    expected = hmac.new(settings.paystack_secret_key.encode(), raw_body, hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, header)
