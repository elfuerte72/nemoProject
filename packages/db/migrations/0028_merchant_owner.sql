CREATE TYPE "public"."merchant_email_token_purpose" AS ENUM('email_verification', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."merchant_status" AS ENUM('pending', 'active', 'rejected', 'disabled');--> statement-breakpoint
ALTER TYPE "public"."actor_type" ADD VALUE 'merchant' BEFORE 'manager';--> statement-breakpoint
CREATE TABLE "merchant_email_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"purpose" "merchant_email_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_email_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"session_epoch" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"site" text,
	"contact_name" text NOT NULL,
	"phone" text NOT NULL,
	"about" text,
	"status" "merchant_status" DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"email_verified_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"signature_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchants_email_unique" UNIQUE("email"),
	CONSTRAINT "merchants_rejection_reason" CHECK ("merchants"."status" <> 'rejected' or "merchants"."rejection_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "client_requisites" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "exchange_requests" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "requisite_access_log" ALTER COLUMN "client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "merchant_id" uuid;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD COLUMN "merchant_id" uuid;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD COLUMN "merchant_id" uuid;--> statement-breakpoint
ALTER TABLE "service_settings" ADD COLUMN "merchant_support_username" text;--> statement-breakpoint
ALTER TABLE "merchant_email_tokens" ADD CONSTRAINT "merchant_email_tokens_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_email_tokens_merchant_idx" ON "merchant_email_tokens" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "merchants_status_created_idx" ON "merchants" USING btree ("status","created_at","id");--> statement-breakpoint
ALTER TABLE "client_requisites" ADD CONSTRAINT "client_requisites_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD CONSTRAINT "requisite_access_log_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_requisites_merchant_idx" ON "client_requisites" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "exchange_requests_merchant_idx" ON "exchange_requests" USING btree ("merchant_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_requests_merchant_idempotency" ON "exchange_requests" USING btree ("merchant_id","idempotency_key") WHERE "exchange_requests"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "requisite_access_log_merchant_idx" ON "requisite_access_log" USING btree ("merchant_id");--> statement-breakpoint
ALTER TABLE "client_requisites" ADD CONSTRAINT "client_requisites_single_owner" CHECK ((case when "client_requisites"."client_id" is not null then 1 else 0 end
        + case when "client_requisites"."merchant_id" is not null then 1 else 0 end) = 1);--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_single_owner" CHECK ((case when "exchange_requests"."client_id" is not null then 1 else 0 end
        + case when "exchange_requests"."merchant_id" is not null then 1 else 0 end) = 1);--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_merchant_fields" CHECK ("exchange_requests"."merchant_id" is not null
        or ("exchange_requests"."reference" is null and "exchange_requests"."idempotency_key" is null));--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD CONSTRAINT "requisite_access_log_single_owner" CHECK ((case when "requisite_access_log"."client_id" is not null then 1 else 0 end
        + case when "requisite_access_log"."merchant_id" is not null then 1 else 0 end) = 1);