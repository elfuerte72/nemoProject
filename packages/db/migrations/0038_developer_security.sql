CREATE TABLE "merchant_api_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"address" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_api_addresses_merchant_address_key" UNIQUE("merchant_id","address")
);
--> statement-breakpoint
CREATE TABLE "merchant_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_user_id" uuid NOT NULL,
	"session_epoch" integer NOT NULL,
	"user_agent" text,
	"address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api_request_log" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "api_request_log" ADD COLUMN "request_id" uuid;--> statement-breakpoint
ALTER TABLE "merchant_api_addresses" ADD CONSTRAINT "merchant_api_addresses_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_sessions" ADD CONSTRAINT "merchant_sessions_merchant_user_id_merchant_users_id_fk" FOREIGN KEY ("merchant_user_id") REFERENCES "public"."merchant_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_sessions_user_idx" ON "merchant_sessions" USING btree ("merchant_user_id","last_seen_at");