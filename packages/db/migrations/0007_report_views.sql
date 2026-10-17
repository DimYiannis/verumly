CREATE TABLE "merchant"."report_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant"."report_views" ADD CONSTRAINT "report_views_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "merchant"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_views_org_idx" ON "merchant"."report_views" USING btree ("org_id","created_at");
--> statement-breakpoint
ALTER TABLE merchant.report_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.report_views FOR ALL TO dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON merchant.report_views TO dashboard;
