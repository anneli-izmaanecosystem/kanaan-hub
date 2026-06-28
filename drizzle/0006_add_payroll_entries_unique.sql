CREATE TYPE "public"."alpheus_day_type" AS ENUM('onsite', 'offsite', 'partial');--> statement-breakpoint
CREATE TYPE "public"."fuel_alloc_type" AS ENUM('onsite', 'offsite');--> statement-breakpoint
CREATE TYPE "public"."fuel_fill_flag" AS ENUM('ok', 'estimated', 'delivery', 'shortage');--> statement-breakpoint
CREATE TYPE "public"."fuel_fill_status" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('unpaid', 'paid_cash', 'paid_eft', 'overdue');--> statement-breakpoint
CREATE TABLE "alpheus_day_clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_id" integer NOT NULL,
	"client_name" text NOT NULL,
	"billing_info" text,
	"hours_worked" numeric(5, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alpheus_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"day_date" date NOT NULL,
	"day_type" "alpheus_day_type" NOT NULL,
	"notes" text,
	"status" "fuel_fill_status" DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"fill_id" integer NOT NULL,
	"day_id" integer,
	"alloc_type" "fuel_alloc_type" NOT NULL,
	"client_name" text,
	"billing_info" text,
	"hours_worked" numeric(5, 2),
	"litres" numeric(8, 2) NOT NULL,
	"cost" numeric(10, 2) NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "fuel_fills" (
	"id" serial PRIMARY KEY NOT NULL,
	"fill_date" date NOT NULL,
	"driver_id" integer,
	"driver_name" text NOT NULL,
	"vehicle" text NOT NULL,
	"open_reading" numeric(10, 2),
	"close_reading" numeric(10, 2),
	"litres" numeric(8, 2) NOT NULL,
	"is_estimated" boolean DEFAULT false NOT NULL,
	"rate_per_litre" numeric(8, 2) NOT NULL,
	"photo_url" text,
	"notes" text,
	"status" "fuel_fill_status" DEFAULT 'draft' NOT NULL,
	"flag" "fuel_fill_flag" DEFAULT 'ok' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"client_name" text NOT NULL,
	"billing_info" text,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"tlb_rate" numeric(8, 2) NOT NULL,
	"labour_excl_vat" numeric(12, 2) NOT NULL,
	"diesel_litres" numeric(8, 2) NOT NULL,
	"diesel_rate" numeric(8, 2) NOT NULL,
	"diesel_cost" numeric(12, 2) NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '15' NOT NULL,
	"vat_amount" numeric(12, 2) NOT NULL,
	"total_due" numeric(12, 2) NOT NULL,
	"payment_status" "invoice_status" DEFAULT 'unpaid' NOT NULL,
	"paid_at" timestamp,
	"payment_method" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fuel_invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "fuel_purchases" (
	"id" serial PRIMARY KEY NOT NULL,
	"purchase_date" date NOT NULL,
	"supplier" text DEFAULT 'Bosbok Gas Nelspruit' NOT NULL,
	"invoice_no" text,
	"docket_no" text,
	"litres" numeric(10, 2) NOT NULL,
	"price_per_litre" numeric(8, 2) NOT NULL,
	"total_excl_vat" numeric(12, 2) NOT NULL,
	"vat_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"total_incl_vat" numeric(12, 2) NOT NULL,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "uses_timesheet" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "default_hours_per_day" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "default_days_in_period" integer;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "defaults_applied" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_log_entries" ADD COLUMN "processed_at" timestamp;--> statement-breakpoint
ALTER TABLE "alpheus_day_clients" ADD CONSTRAINT "alpheus_day_clients_day_id_alpheus_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."alpheus_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_allocations" ADD CONSTRAINT "fuel_allocations_fill_id_fuel_fills_id_fk" FOREIGN KEY ("fill_id") REFERENCES "public"."fuel_fills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_allocations" ADD CONSTRAINT "fuel_allocations_day_id_alpheus_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."alpheus_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fuel_fills" ADD CONSTRAINT "fuel_fills_driver_id_workers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DELETE FROM "payroll_entries" WHERE id NOT IN (
  SELECT MIN(id) FROM "payroll_entries" GROUP BY run_id, worker_id
);--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_run_worker_unique" UNIQUE("run_id","worker_id");