CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'pending', 'cancelled', 'checked_in', 'checked_out');--> statement-breakpoint
CREATE TYPE "public"."hours_type" AS ENUM('fixed_monthly', 'variable');--> statement-breakpoint
CREATE TYPE "public"."pay_type" AS ENUM('fixed_salary', 'hourly');--> statement-breakpoint
CREATE TYPE "public"."payroll_status" AS ENUM('draft', 'finalised');--> statement-breakpoint
CREATE TYPE "public"."room_type" AS ENUM('premium', 'budget', 'dorm', 'camping');--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"room_id" integer NOT NULL,
	"guest_name" text NOT NULL,
	"contact" text NOT NULL,
	"id_number" text,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"adults" integer DEFAULT 1 NOT NULL,
	"children" integer DEFAULT 0 NOT NULL,
	"nights" integer NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"deposit_paid" numeric(10, 2) DEFAULT '0' NOT NULL,
	"balance_due" numeric(10, 2) NOT NULL,
	"special_requests" text,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"source" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"id_number" text,
	"bank_account" text,
	"bank_name" text,
	"pay_type" "pay_type" NOT NULL,
	"hours_type" "hours_type" NOT NULL,
	"monthly_salary" numeric(10, 2),
	"hourly_rate" numeric(10, 2),
	"fixed_hours" numeric(6, 2),
	"department" text,
	"position" text,
	"start_date" date,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"employee_id" integer NOT NULL,
	"year" integer NOT NULL,
	"annual_days_accrued" numeric(5, 2) DEFAULT '0' NOT NULL,
	"annual_days_taken" numeric(5, 2) DEFAULT '0' NOT NULL,
	"sick_days_taken" numeric(5, 2) DEFAULT '0' NOT NULL,
	"toil_hours" numeric(6, 2) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"employee_id" integer NOT NULL,
	"ordinary_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"overtime_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"sunday_ph_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"basic_pay" numeric(10, 2) DEFAULT '0' NOT NULL,
	"overtime_pay" numeric(10, 2) DEFAULT '0' NOT NULL,
	"bonus" numeric(10, 2) DEFAULT '0' NOT NULL,
	"other_additions" numeric(10, 2) DEFAULT '0' NOT NULL,
	"uif_employee" numeric(10, 2) DEFAULT '0' NOT NULL,
	"uif_employer" numeric(10, 2) DEFAULT '0' NOT NULL,
	"leave_deduction" numeric(10, 2) DEFAULT '0' NOT NULL,
	"other_deductions" numeric(10, 2) DEFAULT '0' NOT NULL,
	"gross_pay" numeric(10, 2) DEFAULT '0' NOT NULL,
	"net_pay" numeric(10, 2) DEFAULT '0' NOT NULL,
	"leave_days_taken" numeric(4, 1) DEFAULT '0' NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" "payroll_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "room_type" NOT NULL,
	"capacity" integer DEFAULT 2 NOT NULL,
	"rate_pp" numeric(10, 2) NOT NULL,
	"rate_solo" numeric(10, 2),
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_balances" ADD CONSTRAINT "leave_balances_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;