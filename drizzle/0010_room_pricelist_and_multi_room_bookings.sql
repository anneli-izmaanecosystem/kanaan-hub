CREATE TYPE "public"."pricing_mode" AS ENUM('flat', 'per_pax');--> statement-breakpoint
CREATE TABLE "booking_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	CONSTRAINT "booking_rooms_booking_id_room_id_unique" UNIQUE("booking_id","room_id")
);
--> statement-breakpoint
CREATE TABLE "room_combo_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"combo_id" integer NOT NULL,
	"room_id" integer NOT NULL,
	CONSTRAINT "room_combo_members_combo_id_room_id_unique" UNIQUE("combo_id","room_id")
);
--> statement-breakpoint
CREATE TABLE "room_combos" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"rate" numeric(10, 2) NOT NULL,
	"pricing_mode" "pricing_mode" DEFAULT 'per_pax' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "pricing_mode" "pricing_mode" DEFAULT 'flat' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "bed_config" text;--> statement-breakpoint
ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_rooms" ADD CONSTRAINT "booking_rooms_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_combo_members" ADD CONSTRAINT "room_combo_members_combo_id_room_combos_id_fk" FOREIGN KEY ("combo_id") REFERENCES "public"."room_combos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_combo_members" ADD CONSTRAINT "room_combo_members_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "booking_rooms" ("booking_id", "room_id")
SELECT "id", "room_id" FROM "bookings"
ON CONFLICT ("booking_id", "room_id") DO NOTHING;