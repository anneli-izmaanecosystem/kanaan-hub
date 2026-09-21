# Kanaan WhatsApp Backend

Python (FastAPI) service that:

- registers and tracks WhatsApp message templates against Meta's Graph API for Kanaan's
  WABA (WhatsApp Business Account),
- receives the Meta webhook (inbound messages + delivery status) and logs every message,
- tracks chatbot flow/session state per phone number,
- serves a small server-rendered admin UI, styled like a WhatsApp thread, to read all of
  the above without a database client.

**This service does not run the car-booking chatbot.** That flow — direction, room,
time, place lookup, fare quote, Stripe card hold — is already fully implemented in the
Next.js app (`lib/whatsapp/*`, `app/api/whatsapp/webhook`), which is the only thing that
talks to Meta and Stripe for it. This service exists for template registration and for
showing that conversation in an admin UI; see "Mirroring" below for how the two connect.

## Setup

```bash
cd whatsapp-backend
python -m venv .venv
.venv/Scripts/activate        # .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
cp .env.example .env           # fill in DATABASE_URL and WHATSAPP_* values
python scripts/migrate.py      # creates the 3 tables (idempotent)
uvicorn app.main:app --reload --port 8000
```

Then open `http://localhost:8000/admin` for the UI, or `http://localhost:8000/docs`
for the API.

## Database

`migrations/001_create_kanaan_whatsapp_tables.sql` creates:

- **kanaan_whatsapp_templates** — one row per template, its Meta review status, and the
  exact `components` JSON submitted to Graph.
- **kanaan_whatsapp_flows** — one row per chatbot session (`phone_number` + `flow_name`);
  `context` holds whatever the flow has collected so far.
- **kanaan_whatsapp_logs** — every inbound/outbound message, keyed by Meta's `wa_message_id`
  so retried webhook deliveries don't duplicate rows.

These have been created on the staging RDS instance, in the **`notification_service`**
database (not `user_service` — that's a sibling database on the same RDS instance, home
to `media_service`, `payment_service`, `website_service` etc. too; `notification_service`
is the one already holding `crm_email_template`, `alert`, `notification_view_logs`, and
so on, so that's where these belong).

Column conventions match that existing schema rather than idiomatic SQLAlchemy defaults:
`id` is an app-generated `varchar(36)` UUID string (no DB-side default — same as `users`,
`alert`, every other table there), timestamps are plain `timestamp` with no timezone, and
JSON blobs (`components`, `context`, `payload`) are stored as `TEXT`, not `jsonb` — that
database has no native json/jsonb columns anywhere, so this doesn't introduce the first
one. `app/models.py` has a `JSONText` type that (de)serializes transparently, so the rest
of the code just works with dicts/lists as normal.

## Mirroring the live car-booking conversation

The Next.js app owns the guest-booking flow end to end (Meta webhook + Stripe). It pushes
a copy of everything into this service so the admin UI can show it — see
`lib/whatsapp/mirror.ts` in the main repo, called from:

- `lib/whatsapp/client.ts` — every outbound send (`sendText`, `sendButtons`, `sendTemplate`, ...)
- `app/api/whatsapp/webhook/route.ts` — every inbound message and delivery-status update
- `lib/whatsapp/conversation.ts`'s `saveConversation` — every step/state change, as
  flow `kanaan_car_booking`

These calls are fire-and-forget from the Next.js side (a mirroring failure never affects
a real guest's booking) and land on `POST /internal/messages`, `/internal/messages/status`
and `/internal/flows` here — all gated by a shared secret, since they're service-to-service,
not a public webhook. To wire it up:

1. Set `INTERNAL_MIRROR_SECRET` in this service's `.env` to a long random string.
2. In the Next.js app's environment, set `WHATSAPP_MIRROR_URL` (this service's base URL,
   e.g. `https://kanaan-whatsapp-backend.example.com`) and `WHATSAPP_MIRROR_SECRET` to
   the same value.

Without those two Next.js env vars set, `mirrorOutbound`/`mirrorInbound`/`mirrorFlow` are
silent no-ops — nothing breaks, the admin UI just stays empty.

This service's own `/webhook` (Meta's inbound endpoint, further up) is unrelated to this
and currently unused for the car-booking flow — Meta is configured to call the Next.js
webhook, not this one. It's kept for template-related traffic or a future flow that this
service does own directly.

## Connecting Kanaan's Meta WhatsApp account

Kanaan's WABA is already set up in Meta Business Manager ("Kanaan Guest Farm", phone
+27 64 211 6345, status Connected). `WHATSAPP_BUSINESS_ACCOUNT_ID` in `.env` is already
filled in with its WABA id (`1609520840573470`, from the Business Manager URL). Still
needed:

1. The phone number's **Phone Number ID** (a different, numeric id from the WABA id —
   Meta's UI doesn't surface it on the Phone Numbers tab; get it from the Graph API
   Explorer: `GET /{WABA_ID}/phone_numbers`, or from the WhatsApp > API Setup page in the
   app dashboard) → `WHATSAPP_PHONE_NUMBER_ID`.
2. A permanent access token (System User token with `whatsapp_business_messaging` and
   `whatsapp_business_management` permissions — temporary tokens expire in 24h) →
   `WHATSAPP_ACCESS_TOKEN`.
3. The Meta App's secret (Basic Settings, used to verify webhook signatures) →
   `WHATSAPP_APP_SECRET`, plus any string you choose for `WHATSAPP_VERIFY_TOKEN`.
4. If this service is meant to receive Meta's webhook directly (see "Mirroring" above for
   why the car-booking flow currently doesn't need this), set the callback URL in the
   Meta App Dashboard → WhatsApp → Configuration to `https://<your-host>/webhook` with
   the same verify token, and subscribe to the `messages` field.

## API authentication

`/templates`, `/conversations` and `/messages` require a Supabase-authenticated caller —
same Supabase project already used in the main app for storage (`lib/storage.ts`). Send
the user's Supabase access token as a bearer token:

```
Authorization: Bearer <supabase-access-token>
```

Verification calls Supabase's own `GET /auth/v1/user` (see `app/supabase_auth.py`) rather
than checking the JWT locally, so there's no signing-key material to manage here. Set
`SUPABASE_URL` and `SUPABASE_ANON_KEY` (the public anon key, not the service role key) in
`.env` — until both are set, these three routers return `503` for every request rather
than being left open. `/webhook` and `/internal/*` have their own, separate auth (Meta's
HMAC signature, and the shared internal secret respectively) and are unaffected. The
`/admin` HTML pages still use the optional `ADMIN_USERNAME`/`ADMIN_PASSWORD` Basic Auth
below — they were explicitly left out of this Supabase gate for now.

## Registering a template

```bash
curl -X POST http://localhost:8000/templates \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <supabase-access-token>' \
  -d '{
    "name": "booking_confirmation",
    "category": "UTILITY",
    "language": "en_GB",
    "body_preview": "Hi {{1}}, your stay at Kanaan is confirmed for {{2}}.",
    "components": [
      {"type": "BODY", "text": "Hi {{1}}, your stay at Kanaan is confirmed for {{2}}."}
    ]
  }'
```

This saves the template as `DRAFT`, then (if `WHATSAPP_ACCESS_TOKEN` and
`WHATSAPP_BUSINESS_ACCOUNT_ID` are set) submits it to Meta immediately and stores the
returned status (`PENDING` while under review). Run `scripts/sync_templates.py`
periodically (cron) to pick up `APPROVED`/`REJECTED` transitions, or call
`POST /templates/{id}/sync` for one template on demand.

## Admin UI → API mapping

| Page | Backing endpoint |
|---|---|
| `/admin` | `GET /conversations`, `GET /templates` |
| `/admin/conversations/{phone}` | `GET /conversations/{phone}/messages`, `GET /conversations/{phone}/flow` |
| `/admin/templates` | `GET /templates` |

Set `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env` to put the `/admin/*` pages behind
HTTP Basic Auth — without them the pages are open, which is fine for local dev only.
