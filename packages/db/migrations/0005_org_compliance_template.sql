ALTER TABLE merchant.organizations ADD COLUMN compliance jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE merchant.organizations ADD COLUMN receipt_template jsonb;
--> statement-breakpoint
GRANT SELECT (receipt_template) ON merchant.organizations TO buyer_api, worker;
