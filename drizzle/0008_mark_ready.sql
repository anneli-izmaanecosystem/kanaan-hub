ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "marked_ready" boolean NOT NULL DEFAULT false;
ALTER TABLE "payroll_entries" ADD COLUMN IF NOT EXISTS "marked_ready_at" timestamp;
