ALTER TABLE "payroll_entries" ADD COLUMN "sunday_hours" numeric(6, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "sunday_days" numeric(4, 1) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "sunday_pay" numeric(10, 2) DEFAULT '0' NOT NULL;