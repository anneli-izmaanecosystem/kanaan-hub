CREATE TYPE "public"."trip_actor" AS ENUM('guest', 'ops', 'driver', 'system');--> statement-breakpoint
CREATE TYPE "public"."trip_direction" AS ENUM('pickup', 'drop');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('draft', 'requested', 'declined', 'allocated', 'driver_en_route', 'driver_waiting', 'in_progress', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."wa_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."wa_role" AS ENUM('guest', 'ops', 'driver');--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text,
	"lat" numeric(10, 7) NOT NULL,
	"lng" numeric(10, 7) NOT NULL,
	"fixed_fare" numeric(10, 2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "destinations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"plate" text NOT NULL,
	"vehicle" text,
	"active" boolean DEFAULT true NOT NULL,
	"on_duty" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "transfer_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"fare_base" numeric(10, 2) DEFAULT '80' NOT NULL,
	"fare_per_km" numeric(10, 2) DEFAULT '11.75' NOT NULL,
	"fare_minimum" numeric(10, 2) DEFAULT '150' NOT NULL,
	"max_chat_km" integer DEFAULT 50 NOT NULL,
	"ops_response_min" integer DEFAULT 15 NOT NULL,
	"no_show_wait_min" integer DEFAULT 12 NOT NULL,
	"hold_before_min" integer DEFAULT 60 NOT NULL,
	"driver_nudge_min" integer DEFAULT 25 NOT NULL,
	"charge_no_show" boolean DEFAULT false NOT NULL,
	"no_show_fee" numeric(10, 2),
	"service_start" text,
	"service_end" text,
	"max_lead_days" integer DEFAULT 60 NOT NULL,
	"ops_whatsapp" text,
	"ops_phone" text,
	"ops_escalation_whatsapp" text,
	"mute_ops_commentary" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"trip_id" integer NOT NULL,
	"actor" "trip_actor" NOT NULL,
	"event" text NOT NULL,
	"detail" text,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"direction" "trip_direction" NOT NULL,
	"status" "trip_status" DEFAULT 'draft' NOT NULL,
	"guest_phone" text NOT NULL,
	"guest_name" text,
	"room_label" text,
	"room_id" integer,
	"booking_id" integer,
	"place_name" text,
	"place_lat" numeric(10, 7),
	"place_lng" numeric(10, 7),
	"distance_km" numeric(6, 2),
	"duration_min" integer,
	"scheduled_at" timestamp,
	"fare" numeric(10, 2),
	"driver_id" integer,
	"stripe_customer_id" text,
	"stripe_payment_method_id" text,
	"stripe_payment_intent_id" text,
	"held_at" timestamp,
	"captured_at" timestamp,
	"released_at" timestamp,
	"cancelled_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "trips_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "wa_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" text NOT NULL,
	"role" "wa_role" DEFAULT 'guest' NOT NULL,
	"step" text NOT NULL,
	"draft" text,
	"trip_id" integer,
	"last_inbound_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_conversations_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "wa_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"wa_message_id" text,
	"phone" text NOT NULL,
	"role" "wa_role" NOT NULL,
	"direction" "wa_direction" NOT NULL,
	"kind" text NOT NULL,
	"template_name" text,
	"body" text,
	"payload" text,
	"trip_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
ALTER TABLE "trip_events" ADD CONSTRAINT "trip_events_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_conversations" ADD CONSTRAINT "wa_conversations_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_messages" ADD CONSTRAINT "wa_messages_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE no action ON UPDATE no action;