import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

export async function POST() {
  const sql = neon(process.env.POSTGRES_URL!)
  await sql`ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "marked_ready" boolean NOT NULL DEFAULT false`
  await sql`ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "marked_ready_at" timestamp`
  await sql`ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "ical_url" text`
  await sql`ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "external_id" text`
  await sql`DO $$ BEGIN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_external_id_unique" UNIQUE("external_id");
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`
  return NextResponse.json({ ok: true })
}
