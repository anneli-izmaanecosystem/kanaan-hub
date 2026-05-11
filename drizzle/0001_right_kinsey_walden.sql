ALTER TYPE "public"."booking_status" ADD VALUE 'fully_paid';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'partially_paid';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'quote_sent';--> statement-breakpoint
ALTER TYPE "public"."booking_status" ADD VALUE 'unpaid';--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "pay_date" date;