-- Kanaan payments: one row per Paystack transaction the car-booking flow creates or
-- receives (card checks, fare charges, no-show fees). Same notification_service
-- conventions as 001: varchar(36) app-generated ids, plain timestamps, JSON as TEXT.
--
-- Run via scripts/migrate.py. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS kanaan_payments (
    id                VARCHAR(36) PRIMARY KEY,
    reference         VARCHAR NOT NULL UNIQUE,   -- Paystack transaction reference
    trip_id           INTEGER,                    -- trips.id in the Next.js app's database
    trip_ref          VARCHAR,                    -- 'KN-1187'
    purpose           VARCHAR,                    -- card_check | fare | noshow
    status            VARCHAR NOT NULL,           -- pending | success | failed | abandoned | refunded | ...
    amount_cents      INTEGER,
    currency          VARCHAR NOT NULL DEFAULT 'ZAR',
    phone_number      VARCHAR,
    email             VARCHAR,
    card_brand        VARCHAR,
    card_last4        VARCHAR,
    gateway_response  TEXT,
    last_event        VARCHAR,                    -- last Paystack webhook event seen, e.g. charge.success
    raw               TEXT NOT NULL DEFAULT '{}', -- last transaction/event payload from Paystack
    forwarded_at      TIMESTAMP,                  -- when the chat flow was told
    forward_error     TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kanaan_payments_trip ON kanaan_payments (trip_id);
CREATE INDEX IF NOT EXISTS idx_kanaan_payments_created ON kanaan_payments (created_at DESC);
