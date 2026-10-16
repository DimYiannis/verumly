CREATE TABLE "ops"."resolve_failures" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ops"."resolve_failures_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "resolve_failures_receipt_idx" ON "ops"."resolve_failures" USING btree ("receipt_id","at");--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON ops.resolve_failures TO buyer_api, worker;
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA ops TO buyer_api, worker;
