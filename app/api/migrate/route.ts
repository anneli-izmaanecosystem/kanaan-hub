import { NextResponse } from 'next/server'
import { neon } from '@neondatabase/serverless'

export async function POST() {
  const sql = neon(process.env.POSTGRES_URL!)
  await sql`ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "marked_ready" boolean NOT NULL DEFAULT false`
  await sql`ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "marked_ready_at" timestamp`
  return NextResponse.json({ ok: true })
}
