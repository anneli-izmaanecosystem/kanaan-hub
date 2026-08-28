-- NOTE: drizzle-kit's local snapshot history was missing `invoice_uploads` /
-- `invoice_upload_status` (pre-existing live, added outside a tracked migration
-- at some point) — this generated migration tried to re-create both. Trimmed
-- here to only the statements this migration is actually for.
CREATE TYPE "public"."document_category" AS ENUM('coida', 'uif', 'payroll', 'other');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" integer NOT NULL,
	"category" "document_category" DEFAULT 'other' NOT NULL,
	"title" text NOT NULL,
	"period_label" text,
	"file_url" text NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text,
	"notes" text,
	"uploaded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "coid_ref" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;