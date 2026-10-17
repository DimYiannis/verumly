CREATE TABLE "buyer"."friendships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"addressee_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "buyer"."invites" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"inviter_id" uuid NOT NULL,
	"split_share_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer"."receipt_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer"."share_reactions" (
	"share_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_reactions_share_id_user_id_pk" PRIMARY KEY("share_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "buyer"."split_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"split_id" uuid NOT NULL,
	"user_id" uuid,
	"guest_name" text,
	"amount_minor" integer NOT NULL,
	"line_nos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyer"."splits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buyer"."users" ADD COLUMN "handle" text;--> statement-breakpoint
ALTER TABLE "buyer"."users" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "buyer"."friendships" ADD CONSTRAINT "friendships_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."friendships" ADD CONSTRAINT "friendships_addressee_id_users_id_fk" FOREIGN KEY ("addressee_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."invites" ADD CONSTRAINT "invites_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."invites" ADD CONSTRAINT "invites_split_share_id_split_shares_id_fk" FOREIGN KEY ("split_share_id") REFERENCES "buyer"."split_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."invites" ADD CONSTRAINT "invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "buyer"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."receipt_shares" ADD CONSTRAINT "receipt_shares_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."receipt_shares" ADD CONSTRAINT "receipt_shares_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."share_reactions" ADD CONSTRAINT "share_reactions_share_id_receipt_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "buyer"."receipt_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."share_reactions" ADD CONSTRAINT "share_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."split_shares" ADD CONSTRAINT "split_shares_split_id_splits_id_fk" FOREIGN KEY ("split_id") REFERENCES "buyer"."splits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."split_shares" ADD CONSTRAINT "split_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer"."splits" ADD CONSTRAINT "splits_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "buyer"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_uq" ON "buyer"."friendships" USING btree (least("requester_id", "addressee_id"),greatest("requester_id", "addressee_id"));--> statement-breakpoint
CREATE INDEX "friendships_addressee_idx" ON "buyer"."friendships" USING btree ("addressee_id","status");--> statement-breakpoint
CREATE INDEX "invites_inviter_idx" ON "buyer"."invites" USING btree ("inviter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_shares_uq" ON "buyer"."receipt_shares" USING btree ("receipt_id","from_user_id","to_user_id");--> statement-breakpoint
CREATE INDEX "receipt_shares_to_idx" ON "buyer"."receipt_shares" USING btree ("to_user_id","created_at");--> statement-breakpoint
CREATE INDEX "split_shares_split_idx" ON "buyer"."split_shares" USING btree ("split_id");--> statement-breakpoint
CREATE INDEX "split_shares_user_idx" ON "buyer"."split_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "splits_creator_idx" ON "buyer"."splits" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "splits_receipt_idx" ON "buyer"."splits" USING btree ("receipt_id");--> statement-breakpoint
ALTER TABLE "buyer"."users" ADD CONSTRAINT "users_handle_unique" UNIQUE("handle");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON buyer.friendships, buyer.invites, buyer.splits, buyer.split_shares, buyer.receipt_shares, buyer.share_reactions TO buyer_api, worker;
