ALTER TABLE "bookings" ADD COLUMN "vat_included" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "commission_amount" numeric(10, 2);