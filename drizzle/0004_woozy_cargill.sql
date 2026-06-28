CREATE TYPE "public"."advance_type" AS ENUM('cash_advance', 'shop_deduction');--> statement-breakpoint
CREATE TYPE "public"."data_source" AS ENUM('whatsapp', 'photo_timesheet', 'manual');--> statement-breakpoint
CREATE TYPE "public"."day_type" AS ENUM('weekday', 'saturday', 'sunday', 'public_holiday');--> statement-breakpoint
CREATE TYPE "public"."entity_type" AS ENUM('kanaan', 'plant_hire', 'investment_project');--> statement-breakpoint
CREATE TYPE "public"."pay_structure" AS ENUM('hourly', 'daily', 'floor');--> statement-breakpoint
CREATE TYPE "public"."staff_log_type" AS ENUM('hours', 'advance', 'shop_purchase', 'note');--> statement-breakpoint
CREATE TYPE "public"."worker_type" AS ENUM('employee', 'contractor');--> statement-breakpoint
CREATE TABLE "advances" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_id" integer NOT NULL,
	"run_id" integer,
	"date" date NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"advance_type" "advance_type" NOT NULL,
	"note" text,
	"source" "data_source" DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_id" integer NOT NULL,
	"run_id" integer,
	"date" date NOT NULL,
	"day_type" "day_type" NOT NULL,
	"hours_worked" numeric(5, 2),
	"absent" boolean DEFAULT false NOT NULL,
	"absence_reason" text,
	"calculated_amount" numeric(10, 2),
	"ph_double_confirmed" boolean,
	"source" "data_source" DEFAULT 'manual' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"trading_name" text,
	"registration_no" text,
	"uif_ref" text,
	"paye_ref" text,
	"entity_type" "entity_type" NOT NULL,
	"address" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fuel_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"log_date" date NOT NULL,
	"vehicle" text NOT NULL,
	"open_reading" numeric(10, 2),
	"close_reading" numeric(10, 2),
	"litres" numeric(8, 2) NOT NULL,
	"purpose" text,
	"notes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"year" integer NOT NULL,
	CONSTRAINT "public_holidays_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "staff_log_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_id" integer,
	"worker_name" text NOT NULL,
	"log_type" "staff_log_type" DEFAULT 'note' NOT NULL,
	"log_date" date NOT NULL,
	"message" text NOT NULL,
	"amount" numeric(10, 2),
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timesheet_uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_id" integer,
	"image_url" text,
	"ocr_raw" text,
	"parsed_json" text,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whatsapp_parses" (
	"id" serial PRIMARY KEY NOT NULL,
	"raw_text" text NOT NULL,
	"parsed_month" text,
	"extracted_json" text,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_id" integer NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"name" text NOT NULL,
	"id_number" text,
	"bank_account" text,
	"bank_name" text,
	"worker_type" "worker_type" NOT NULL,
	"pay_structure" "pay_structure" NOT NULL,
	"hourly_rate" numeric(10, 2),
	"std_hours_per_day" numeric(4, 2),
	"daily_rate" numeric(10, 2),
	"floor_salary" numeric(10, 2),
	"saturday_rate" numeric(10, 2),
	"department" text,
	"position" text,
	"start_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "employees" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "employees" CASCADE;--> statement-breakpoint
ALTER TABLE "leave_balances" DROP CONSTRAINT "leave_balances_employee_id_employees_id_fk";
--> statement-breakpoint
ALTER TABLE "payroll_entries" DROP CONSTRAINT "payroll_entries_employee_id_employees_id_fk";
--> statement-breakpoint
ALTER TABLE "leave_balances" ADD COLUMN "worker_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "worker_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "saturday_hours" numeric(6, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "ph_hours" numeric(6, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "days_worked" numeric(5, 1) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "saturday_days" numeric(4, 1) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "saturday_pay" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "ph_pay" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "salary_advance" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "shop_deductions" numeric(10, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "annual_leave_days_taken" numeric(4, 1) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "sick_leave_days_taken" numeric(4, 1) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "contractor_invoice_no" text;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "engagement_description" text;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "tlb_recon_summary" text;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "paye_taxable_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "entity_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advances" ADD CONSTRAINT "advances_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_log_entries" ADD CONSTRAINT "staff_log_entries_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_uploads" ADD CONSTRAINT "timesheet_uploads_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_aliases" ADD CONSTRAINT "worker_aliases_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_worker_id_workers_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."workers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" DROP COLUMN "employee_id";--> statement-breakpoint
ALTER TABLE "payroll_entries" DROP COLUMN "employee_id";--> statement-breakpoint
ALTER TABLE "payroll_entries" DROP COLUMN "overtime_hours";--> statement-breakpoint
ALTER TABLE "payroll_entries" DROP COLUMN "sunday_ph_hours";--> statement-breakpoint
ALTER TABLE "payroll_entries" DROP COLUMN "overtime_pay";--> statement-breakpoint
ALTER TABLE "payroll_entries" DROP COLUMN "leave_deduction";--> statement-breakpoint
ALTER TABLE "payroll_entries" DROP COLUMN "leave_days_taken";--> statement-breakpoint
DROP TYPE "public"."hours_type";--> statement-breakpoint
DROP TYPE "public"."pay_type";