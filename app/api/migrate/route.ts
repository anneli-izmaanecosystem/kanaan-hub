import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

export async function POST() {
  const sql = neon(process.env.POSTGRES_URL!)

  // Prior migrations, kept for idempotent re-runs
  await sql`ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "marked_ready" boolean NOT NULL DEFAULT false`
  await sql`ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "marked_ready_at" timestamp`
  await sql`ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "ical_url" text`
  await sql`ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "external_id" text`
  // A UNIQUE constraint implicitly creates a backing index with the same name, so
  // re-running this on an already-migrated DB raises duplicate_table (42P07), not
  // duplicate_object (42710) — catch both so idempotent re-runs actually no-op.
  await sql`DO $$ BEGIN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_external_id_unique" UNIQUE("external_id");
  EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$`

  // 0010: room pricelist + multi-room bookings
  await sql`DO $$ BEGIN
    CREATE TYPE "pricing_mode" AS ENUM ('flat', 'per_pax');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`

  await sql`ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "pricing_mode" "pricing_mode" NOT NULL DEFAULT 'flat'`
  await sql`ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "category" text`
  await sql`ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "bed_config" text`

  await sql`CREATE TABLE IF NOT EXISTS "room_combos" (
    "id" serial PRIMARY KEY NOT NULL,
    "name" text NOT NULL,
    "capacity" integer NOT NULL,
    "rate" numeric(10, 2) NOT NULL,
    "pricing_mode" "pricing_mode" NOT NULL DEFAULT 'per_pax',
    "active" boolean NOT NULL DEFAULT true
  )`

  await sql`CREATE TABLE IF NOT EXISTS "room_combo_members" (
    "id" serial PRIMARY KEY NOT NULL,
    "combo_id" integer NOT NULL,
    "room_id" integer NOT NULL
  )`
  await sql`DO $$ BEGIN
    ALTER TABLE "room_combo_members" ADD CONSTRAINT "room_combo_members_combo_id_room_combos_id_fk" FOREIGN KEY ("combo_id") REFERENCES "room_combos"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`
  await sql`DO $$ BEGIN
    ALTER TABLE "room_combo_members" ADD CONSTRAINT "room_combo_members_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`
  await sql`DO $$ BEGIN
    ALTER TABLE "room_combo_members" ADD CONSTRAINT "room_combo_members_combo_id_room_id_unique" UNIQUE("combo_id","room_id");
  EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$`

  await sql`CREATE TABLE IF NOT EXISTS "booking_rooms" (
    "id" serial PRIMARY KEY NOT NULL,
    "booking_id" integer NOT NULL,
    "room_id" integer NOT NULL
  )`
  await sql`DO $$ BEGIN
    ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`
  await sql`DO $$ BEGIN
    ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "rooms"("id");
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`
  await sql`DO $$ BEGIN
    ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_booking_id_room_id_unique" UNIQUE("booking_id","room_id");
  EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$`

  // Backfill: every existing booking occupies (at least) its primary room
  await sql`INSERT INTO "booking_rooms" ("booking_id", "room_id")
    SELECT "id", "room_id" FROM "bookings"
    ON CONFLICT ("booking_id", "room_id") DO NOTHING`

  // 0011: prevent duplicate attendance rows for the same worker/run/day (concurrent
  // or duplicate writes previously could create more than one row silently).
  // NOTE: if any duplicate (worker_id, run_id, date) rows already exist, this will
  // fail with a unique-violation (not the duplicate_object/duplicate_table cases
  // caught below) — check for and de-duplicate any existing conflicts first.
  // (Confirmed zero existing duplicates in production as of 2026-08-02.)
  await sql`DO $$ BEGIN
    ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_worker_run_date_unique" UNIQUE("worker_id","run_id","date");
  EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$`

  return NextResponse.json({ ok: true })
}
