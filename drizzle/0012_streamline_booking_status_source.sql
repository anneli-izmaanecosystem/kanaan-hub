-- Streamline bookings.status (9 values -> 5) and bookings.source (free text -> enum + free-text sub-value).
-- Postgres can't shrink/rename an enum's value set in place, so we create the new types,
-- backfill data with a best-guess mapping from the old values, then swap the columns over.

CREATE TYPE "public"."booking_status_new" AS ENUM('booking_site', 'unpaid_quoted', 'deposit_paid', 'fully_paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('direct_walkin', 'booking_com', 'lekkaslaap', 'other');--> statement-breakpoint

ALTER TABLE "bookings" ADD COLUMN "status_new" "booking_status_new";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "source_new" "booking_source";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "source_other" text;--> statement-breakpoint

-- Source: blank/NULL -> left unset (NULL), not forced into 'other' (real data has 80 such rows
-- and "no source recorded" is not the same claim as "source is something else"). 'Booking.com' /
-- legacy 'Booking Site' label -> booking_com; anything recognisably direct (walk-in, direct,
-- phone, the mobile-app default) -> direct_walkin; everything else -> other, preserving the
-- original text in source_other so nothing is lost.
UPDATE "bookings" SET
  "source_new" = (CASE
    WHEN "source" IS NULL OR trim("source") = '' THEN NULL
    WHEN "source" ILIKE 'booking.com%' OR "source" ILIKE 'booking site' THEN 'booking_com'
    WHEN "source" ILIKE 'lekkaslaap%' THEN 'lekkaslaap'
    WHEN "source" IN ('Walk-in', 'Direct', 'Phone', 'mobile') THEN 'direct_walkin'
    ELSE 'other'
  END)::"booking_source",
  "source_other" = CASE
    WHEN "source" IS NOT NULL AND trim("source") != ''
      AND "source" NOT ILIKE 'booking.com%' AND "source" NOT ILIKE 'booking site'
      AND "source" NOT ILIKE 'lekkaslaap%'
      AND "source" NOT IN ('Walk-in', 'Direct', 'Phone', 'mobile')
    THEN "source"
    ELSE NULL
  END;--> statement-breakpoint

-- Status: cancelled stays cancelled; OTA-sourced bookings become 'booking_site'; a completed
-- or fully-paid stay becomes 'fully_paid'; a deposit-level stay (partially_paid/checked_in)
-- becomes 'deposit_paid'; everything else (confirmed/pending/quote_sent/unpaid) becomes
-- 'unpaid_quoted'. This collapses distinctions that existed before (e.g. quote vs confirmed-
-- but-unpaid) -- spot-check a sample of migrated rows against the old CSV/PandaDoc records.
UPDATE "bookings" SET "status_new" = (CASE
  WHEN "status" = 'cancelled' THEN 'cancelled'
  WHEN "source" ILIKE 'booking.com%' OR "source" ILIKE 'booking site' OR "source" ILIKE 'lekkaslaap%' THEN 'booking_site'
  WHEN "status" IN ('fully_paid', 'checked_out') THEN 'fully_paid'
  WHEN "status" IN ('partially_paid', 'checked_in') THEN 'deposit_paid'
  ELSE 'unpaid_quoted'
END)::"booking_status_new";--> statement-breakpoint

ALTER TABLE "bookings" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "bookings" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "bookings" RENAME COLUMN "status_new" TO "status";--> statement-breakpoint
ALTER TABLE "bookings" RENAME COLUMN "source_new" TO "source";--> statement-breakpoint

ALTER TABLE "bookings" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "status" SET DEFAULT 'unpaid_quoted';--> statement-breakpoint

DROP TYPE "public"."booking_status";--> statement-breakpoint
ALTER TYPE "public"."booking_status_new" RENAME TO "booking_status";
