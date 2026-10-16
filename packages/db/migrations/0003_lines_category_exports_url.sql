ALTER TABLE "merchant"."exports" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "merchant"."exports" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchant"."receipt_lines" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "merchant"."receipt_lines" ADD COLUMN "sensitive" boolean DEFAULT false NOT NULL;