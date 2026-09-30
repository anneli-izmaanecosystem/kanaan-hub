# Kanaan WhatsApp Backend

Python (FastAPI) service that:

- registers and tracks WhatsApp message templates against Meta's Graph API for Kanaan's
  WABA (WhatsApp Business Account),
- receives the Meta webhook (inbound messages + delivery status) and logs every message,
- tracks chatbot flow/session state per phone number,
- serves a small server-rendered admin UI, styled like a WhatsApp thread, to read all of
  the above without a database client,
- **runs the car-booking chatbot** (`app/bot/`): the guest, Anneli and driver
  conversations, the trip lifecycle, Paystack payment links, and the scheduled sends
  (reminders, chasing Anneli, no-show checks).

The bot keeps its data — trips, drivers, conversations, fare settings — in the
`kanaan_hub` database (`KANAAN_HUB_DATABASE_URL`), which is where the Next.js dashboard
reads it. The tables are owned by the dashboard's Drizzle schema (`lib/db/schema.ts` in
the main repo); `app/bot/hub_db.py` only describes the columns the bot uses.

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

## The car-booking bot

Meta calls `POST /webhook`. The message is logged (admin UI), the response goes back to
Meta, and the bot handles it in the background (`app/bot/inbound.py`):

- the insert into `kanaan_hub.wa_messages` is the idempotency claim, so a Meta retry is
  never processed twice;
- the sender's role decides the handler: Anneli's number (`transfer_settings.ops_whatsapp`,
  else `KANAAN_OPS_WHATSAPP`) goes to `ops.py`, a registered driver to `driver.py`, anyone
  else to the guest conversation in `conversation.py`;
- every transition lives in `trip.py`, which writes the status and a `trip_events` row
  before messaging anyone.

Everything the bot sends is recorded in `wa_messages` (the dashboard's thread view) and
in `kanaan_whatsapp_logs` (the admin UI here).

Paystack confirmations (`/payments/paystack/webhook` and `/callback`) mark the trip paid
through `trip.payment_received`, which is safe to run twice.

The scheduled sends run in a background thread every `BOT_SCHEDULER_INTERVAL_SEC`
(default 120). A Postgres advisory lock allows one tick at a time across replicas.
`POST /bot/tick` runs one on demand.

The dashboard's board actions that message people call `POST /bot/trips/{id}/allocate`
and `POST /bot/trips/{id}/cancel`, gated by `X-Internal-Secret` (`INTERNAL_MIRROR_SECRET`
here, `KANAAN_BOT_SECRET` on the dashboard, with `KANAAN_BOT_URL` set to this service).

### Testing

`tests/bot_e2e.py` drives whole conversations through the real `/webhook` endpoint
against a throwaway Postgres, with Meta and Paystack stubbed. See its docstring for setup.

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
