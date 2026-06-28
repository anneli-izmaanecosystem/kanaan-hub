-- Fuel Log v2: replaces the stub fuel_logs table with full recon schema
-- Tables: fuel_fills, fuel_allocations, alpheus_days, alpheus_day_clients, fuel_purchases, fuel_invoices

--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "fuel_fill_status" AS ENUM ('draft', 'final');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "fuel_fill_flag" AS ENUM ('ok', 'estimated', 'delivery', 'shortage');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "fuel_alloc_type" AS ENUM ('onsite', 'offsite');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "alpheus_day_type" AS ENUM ('onsite', 'offsite', 'partial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "invoice_status" AS ENUM ('unpaid', 'paid_cash', 'paid_eft', 'overdue');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_fills" (
  "id"             serial PRIMARY KEY,
  "fill_date"      date NOT NULL,
  "driver_id"      integer REFERENCES "workers"("id"),
  "driver_name"    text NOT NULL,
  "vehicle"        text NOT NULL,
  "open_reading"   numeric(10, 2),
  "close_reading"  numeric(10, 2),
  "litres"         numeric(8, 2) NOT NULL,
  "is_estimated"   boolean NOT NULL DEFAULT false,
  "rate_per_litre" numeric(8, 2) NOT NULL,
  "photo_url"      text,
  "notes"          text,
  "status"         "fuel_fill_status" NOT NULL DEFAULT 'draft',
  "flag"           "fuel_fill_flag" NOT NULL DEFAULT 'ok',
  "created_by"     text,
  "created_at"     timestamp NOT NULL DEFAULT now(),
  "updated_at"     timestamp NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alpheus_days" (
  "id"         serial PRIMARY KEY,
  "day_date"   date NOT NULL,
  "day_type"   "alpheus_day_type" NOT NULL,
  "notes"      text,
  "status"     "fuel_fill_status" NOT NULL DEFAULT 'draft',
  "created_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "alpheus_day_clients" (
  "id"           serial PRIMARY KEY,
  "day_id"       integer NOT NULL REFERENCES "alpheus_days"("id") ON DELETE CASCADE,
  "client_name"  text NOT NULL,
  "billing_info" text,
  "hours_worked" numeric(5, 2) NOT NULL
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_allocations" (
  "id"           serial PRIMARY KEY,
  "fill_id"      integer NOT NULL REFERENCES "fuel_fills"("id") ON DELETE CASCADE,
  "day_id"       integer REFERENCES "alpheus_days"("id"),
  "alloc_type"   "fuel_alloc_type" NOT NULL,
  "client_name"  text,
  "billing_info" text,
  "hours_worked" numeric(5, 2),
  "litres"       numeric(8, 2) NOT NULL,
  "cost"         numeric(10, 2) NOT NULL,
  "notes"        text
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_purchases" (
  "id"              serial PRIMARY KEY,
  "purchase_date"   date NOT NULL,
  "supplier"        text NOT NULL DEFAULT 'Bosbok Gas Nelspruit',
  "invoice_no"      text,
  "docket_no"       text,
  "litres"          numeric(10, 2) NOT NULL,
  "price_per_litre" numeric(8, 2) NOT NULL,
  "total_excl_vat"  numeric(12, 2) NOT NULL,
  "vat_rate"        numeric(5, 2) NOT NULL DEFAULT 0,
  "total_incl_vat"  numeric(12, 2) NOT NULL,
  "notes"           text,
  "created_by"      text,
  "created_at"      timestamp NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fuel_invoices" (
  "id"              serial PRIMARY KEY,
  "invoice_number"  text NOT NULL UNIQUE,
  "client_name"     text NOT NULL,
  "billing_info"    text,
  "period_start"    date NOT NULL,
  "period_end"      date NOT NULL,
  "hours"           numeric(6, 2) NOT NULL,
  "tlb_rate"        numeric(8, 2) NOT NULL,
  "labour_excl_vat" numeric(12, 2) NOT NULL,
  "diesel_litres"   numeric(8, 2) NOT NULL,
  "diesel_rate"     numeric(8, 2) NOT NULL,
  "diesel_cost"     numeric(12, 2) NOT NULL,
  "vat_rate"        numeric(5, 2) NOT NULL DEFAULT 15,
  "vat_amount"      numeric(12, 2) NOT NULL,
  "total_due"       numeric(12, 2) NOT NULL,
  "payment_status"  "invoice_status" NOT NULL DEFAULT 'unpaid',
  "paid_at"         timestamp,
  "payment_method"  text,
  "notes"           text,
  "created_by"      text,
  "created_at"      timestamp NOT NULL DEFAULT now()
);
