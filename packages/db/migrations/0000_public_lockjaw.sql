CREATE SCHEMA "buyer";
--> statement-breakpoint
CREATE SCHEMA "leads";
--> statement-breakpoint
CREATE SCHEMA "merchant";
--> statement-breakpoint
CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TABLE "ops"."audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ops"."audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" text NOT NULL,
	"org_id" uuid,
	"terminal_id" uuid,
	"receipt_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "buyer"."claims" (
	"receipt_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer"."consents" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "buyer"."consents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant"."daily_rollups" (
	"location_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"day" date NOT NULL,
	"gross" bigint DEFAULT 0 NOT NULL,
	"gross_21" bigint DEFAULT 0 NOT NULL,
	"vat_21" bigint DEFAULT 0 NOT NULL,
	"gross_9" bigint DEFAULT 0 NOT NULL,
	"vat_9" bigint DEFAULT 0 NOT NULL,
	"gross_0" bigint DEFAULT 0 NOT NULL,
	"receipt_count" integer DEFAULT 0 NOT NULL,
	"void_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_rollups_location_id_day_pk" PRIMARY KEY("location_id","day")
);
--> statement-breakpoint
CREATE TABLE "merchant"."dashboard_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"mfa_done" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer"."email_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant"."exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"s3_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."idempotency_keys" (
	"terminal_id" uuid NOT NULL,
	"key" text NOT NULL,
	"content_hash" text NOT NULL,
	"receipt_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_terminal_id_key_pk" PRIMARY KEY("terminal_id","key")
);
--> statement-breakpoint
CREATE TABLE "merchant"."locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"postcode" text,
	"lat" double precision,
	"lng" double precision,
	"timezone" text DEFAULT 'Europe/Amsterdam' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant"."merchant_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_encrypted" text,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "merchant"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"kvk_number" text NOT NULL,
	"vat_number" text,
	"country" text DEFAULT 'NL' NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"retention_years" integer DEFAULT 7 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_kvk_number_unique" UNIQUE("kvk_number"),
	CONSTRAINT "organizations_vat_number_unique" UNIQUE("vat_number")
);
--> statement-breakpoint
CREATE TABLE "buyer"."push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "merchant"."receipt_lines" (
	"receipt_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" text NOT NULL,
	"sku" text,
	"description" text NOT NULL,
	"qty" text NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"vat_rate" smallint,
	"total_minor" integer NOT NULL,
	CONSTRAINT "receipt_lines_receipt_id_line_no_pk" PRIMARY KEY("receipt_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "merchant"."receipt_versions" (
	"receipt_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"state" text NOT NULL,
	"payload" jsonb NOT NULL,
	"signature" text NOT NULL,
	"created_on_terminal_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_versions_receipt_id_version_pk" PRIMARY KEY("receipt_id","version")
);
--> statement-breakpoint
CREATE TABLE "merchant"."receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"state" text NOT NULL,
	"current_version" integer NOT NULL,
	"claim_secret_hash" text NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_on_terminal_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimable_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer"."sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant"."terminals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"signing_public_key" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terminals_api_key_hash_unique" UNIQUE("api_key_hash")
);
--> statement-breakpoint
CREATE TABLE "leads"."unknown_merchant_uploaders" (
	"merchant_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "unknown_merchant_uploaders_merchant_key_user_id_pk" PRIMARY KEY("merchant_key","user_id")
);
--> statement-breakpoint
CREATE TABLE "leads"."unknown_merchants" (
	"merchant_key" text PRIMARY KEY NOT NULL,
	"name" text,
	"postcode" text,
	"distinct_uploaders" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'collecting' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer"."uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text,
	"status" text DEFAULT 'pending_upload' NOT NULL,
	"extracted" jsonb,
	"confidence" double precision,
	"merchant_key" text,
	"matched_receipt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"locale" text DEFAULT 'nl' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "buyer"."claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."daily_rollups" ADD CONSTRAINT "daily_rollups_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "merchant"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."daily_rollups" ADD CONSTRAINT "daily_rollups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."dashboard_sessions" ADD CONSTRAINT "dashboard_sessions_user_id_merchant_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "merchant"."merchant_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."dashboard_sessions" ADD CONSTRAINT "dashboard_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."exports" ADD CONSTRAINT "exports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."locations" ADD CONSTRAINT "locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."merchant_users" ADD CONSTRAINT "merchant_users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "merchant"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."receipt_lines" ADD CONSTRAINT "receipt_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."receipt_versions" ADD CONSTRAINT "receipt_versions_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "merchant"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."receipt_versions" ADD CONSTRAINT "receipt_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."receipts" ADD CONSTRAINT "receipts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."receipts" ADD CONSTRAINT "receipts_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "merchant"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."receipts" ADD CONSTRAINT "receipts_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "merchant"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."terminals" ADD CONSTRAINT "terminals_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "merchant"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."terminals" ADD CONSTRAINT "terminals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads"."unknown_merchant_uploaders" ADD CONSTRAINT "unknown_merchant_uploaders_merchant_key_unknown_merchants_merchant_key_fk" FOREIGN KEY ("merchant_key") REFERENCES "leads"."unknown_merchants"("merchant_key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claims_user_idx" ON "buyer"."claims" USING btree ("user_id","claimed_at");--> statement-breakpoint
CREATE INDEX "consents_user_idx" ON "buyer"."consents" USING btree ("user_id","purpose","changed_at");--> statement-breakpoint
CREATE INDEX "email_codes_email_idx" ON "buyer"."email_codes" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "idem_receipt_version" ON "ops"."idempotency_keys" USING btree ("receipt_id","version","key");--> statement-breakpoint
CREATE INDEX "receipts_org_created_idx" ON "merchant"."receipts" USING btree ("org_id","created_on_terminal_at");