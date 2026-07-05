ALTER TABLE "alpheus_days" ADD COLUMN "onsite_hours" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "marked_ready" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "marked_ready_at" timestamp;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "ical_url" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_external_id_unique" UNIQUE("external_id");