ALTER TABLE "trips" ADD COLUMN "pickup_name" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "pickup_lat" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "pickup_lng" numeric(10, 7);