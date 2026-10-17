CREATE SEQUENCE "merchant"."invoice_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "merchant"."billing_mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"method" text NOT NULL,
	"label" text NOT NULL,
	"fails_renewals" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "merchant"."invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"number" text NOT NULL,
	"plan" text NOT NULL,
	"interval" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"net_minor" integer NOT NULL,
	"vat_rate" smallint DEFAULT 21 NOT NULL,
	"vat_minor" integer NOT NULL,
	"gross_minor" integer NOT NULL,
	"status" text NOT NULL,
	"method_label" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "merchant"."payment_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"plan" text NOT NULL,
	"interval" text NOT NULL,
	"net_minor" integer NOT NULL,
	"vat_minor" integer NOT NULL,
	"gross_minor" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "merchant"."subscriptions" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"interval" text NOT NULL,
	"status" text NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"pending_plan" text,
	"pending_interval" text,
	"mandate_id" uuid,
	"past_due_since" timestamp with time zone,
	"last_charge_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant"."billing_mandates" ADD CONSTRAINT "billing_mandates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."payment_sessions" ADD CONSTRAINT "payment_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant"."subscriptions" ADD CONSTRAINT "subscriptions_mandate_id_billing_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "merchant"."billing_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_org_idx" ON "merchant"."invoices" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_paid_period_uq" ON "merchant"."invoices" USING btree ("org_id","period_start") WHERE status = 'paid';--> statement-breakpoint
CREATE INDEX "payment_sessions_org_idx" ON "merchant"."payment_sessions" USING btree ("org_id","created_at");
--> statement-breakpoint
ALTER TABLE merchant.subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.billing_mandates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.payment_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.subscriptions FOR ALL TO dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.billing_mandates FOR ALL TO dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.payment_sessions FOR ALL TO dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.invoices FOR ALL TO dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY worker_write ON merchant.subscriptions FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY worker_write ON merchant.invoices FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY internal_read ON merchant.billing_mandates FOR SELECT TO worker USING (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON merchant.subscriptions, merchant.billing_mandates, merchant.payment_sessions, merchant.invoices TO dashboard;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON merchant.subscriptions, merchant.invoices TO worker;
--> statement-breakpoint
GRANT SELECT ON merchant.billing_mandates TO worker;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE merchant.invoice_number_seq TO dashboard, worker;
