-- Day trip requests: a guest tapped "Day Trip" in the WhatsApp car-booking chat. Day trips
-- are not offered yet (the guest is told "coming soon"), so each request is kept here for
-- the admin portal (Transportation > Day trip requests) to follow up. Same
-- notification_service conventions as 001: varchar(36) app-generated ids, plain timestamps
-- holding UTC.
--
-- Run via scripts/migrate.py. Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS kanaan_day_trip_requests (
    id             VARCHAR(36) PRIMARY KEY,
    phone_number   VARCHAR NOT NULL,                 -- the guest's WhatsApp number, '+27...'
    guest_name     VARCHAR,                          -- the guest's full name
    requested_for  TIMESTAMP NOT NULL,               -- the day and time the guest chose
    leave_now      BOOLEAN NOT NULL DEFAULT FALSE,   -- they tapped "Now" rather than picking a time
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- What was asked for, and where it stands: 'requested' is the trips' word for a guest's
-- request waiting on the admin. (Added after the table, for databases that already have it.)
ALTER TABLE kanaan_day_trip_requests ADD COLUMN IF NOT EXISTS request_type VARCHAR NOT NULL DEFAULT 'DAY_TRIP';
ALTER TABLE kanaan_day_trip_requests ADD COLUMN IF NOT EXISTS status VARCHAR NOT NULL DEFAULT 'requested';

-- Tapping Day Trip again for the same day and time is the same request, not a second one.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kanaan_day_trip_requests_phone_time ON kanaan_day_trip_requests (phone_number, requested_for);
CREATE INDEX IF NOT EXISTS idx_kanaan_day_trip_requests_created ON kanaan_day_trip_requests (created_at DESC);
