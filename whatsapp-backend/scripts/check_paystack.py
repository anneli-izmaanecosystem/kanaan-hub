"""Checks the Paystack setup before (and after) going live. Read-only: it creates nothing,
charges nothing and never prints the key.

    python scripts/check_paystack.py

Reads PAYSTACK_SECRET_KEY / PAYSTACK_CALLBACK_URL / PAYSTACK_GUEST_EMAIL / ROOT_PATH from
.env, the same place the service does.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx

from app.config import get_settings
from app.paystack import API, mode

PUBLIC_BASE = "https://backend-stage.labourlinksoftware.co.za/kanaan"


def main() -> int:
    s = get_settings()
    problems: list[str] = []
    m = mode(s)

    print(f"Paystack key:      {'not set' if not m else m.upper() + ' (' + s.paystack_secret_key[:8] + '...)'}")
    if not m:
        print("\nPaste the secret key into PAYSTACK_SECRET_KEY in whatsapp-backend/.env")
        return 1
    if m == "unknown":
        problems.append("PAYSTACK_SECRET_KEY must start with sk_live_ (live) or sk_test_ (test) - "
                        "the public key (pk_...) will not work here")

    # A read-only call that fails fast on a wrong key.
    res = httpx.get(f"{API}/transaction", params={"perPage": 1},
                    headers={"Authorization": f"Bearer {s.paystack_secret_key}"}, timeout=20)
    body = res.json() if res.content else {}
    if res.status_code == 200 and body.get("status"):
        print(f"Key works:         yes ({body.get('meta', {}).get('total', 0)} transactions on this {m} account)")
    else:
        problems.append(f"Paystack rejected the key: {body.get('message', res.status_code)}")

    print(f"Callback URL:      {s.paystack_callback_url or '(not set - Paystack dashboard value is used)'}")
    if not s.paystack_callback_url:
        problems.append("set PAYSTACK_CALLBACK_URL (see below)")
    note = ""
    if "example.com" in s.paystack_guest_email:
        note = ("  (not a blocker: Paystack needs an email, guests give none, so this placeholder is used;\n"
                "                    Paystack's email receipts go unread - the guest is told on WhatsApp)")
    print(f"Receipt email:     {s.paystack_guest_email}{note}")

    print(f"""
In the Paystack dashboard, switch to {'LIVE' if m == 'live' else 'the mode you are using'} and open
Settings > API Keys & Webhooks. Set:
  Webhook URL:   {PUBLIC_BASE}/payments/paystack/webhook
  Callback URL:  {PUBLIC_BASE}/payments/paystack/callback
(Test and live mode each have their own copy of these two fields.)""")

    if problems:
        print("\nTo fix:")
        for p in problems:
            print(" -", p)
        return 1
    print("\nAll good.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
