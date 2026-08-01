CREATE TYPE "public"."actor_type" AS ENUM('system', 'client', 'manager');--> statement-breakpoint
CREATE TYPE "public"."bonus_transaction_kind" AS ENUM('accrual', 'withdrawal', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."card_application_status" AS ENUM('submitted', 'processing', 'active', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."currency_kind" AS ENUM('fiat', 'crypto');--> statement-breakpoint
CREATE TYPE "public"."exchange_kind" AS ENUM('electronic', 'cash');--> statement-breakpoint
CREATE TYPE "public"."exchange_request_status" AS ENUM('new', 'in_progress', 'rate_confirmed', 'payment_received', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('manager', 'admin');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_method" AS ENUM('bank', 'crypto');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_request_status" AS ENUM('new', 'approved', 'paid', 'rejected');--> statement-breakpoint
CREATE TABLE "bonus_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" bigint NOT NULL,
	"kind" "bonus_transaction_kind" NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"line" smallint,
	"rate_bps" integer,
	"exchange_request_id" uuid,
	"withdrawal_request_id" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bonus_transactions_one_accrual_per_line" UNIQUE("exchange_request_id","client_id","line")
);
--> statement-breakpoint
CREATE TABLE "card_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" bigint NOT NULL,
	"status" "card_application_status" DEFAULT 'submitted' NOT NULL,
	"provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_requisites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" bigint NOT NULL,
	"bank_name" text,
	"phone" text,
	"card_last4" text,
	"card_sealed" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"telegram_user_id" bigint PRIMARY KEY NOT NULL,
	"username" text,
	"phone" text,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"referrer_id" bigint,
	"referral_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_referral_code_unique" UNIQUE("referral_code"),
	CONSTRAINT "clients_no_self_referral" CHECK ("clients"."referrer_id" is null or "clients"."referrer_id" <> "clients"."telegram_user_id")
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" text PRIMARY KEY NOT NULL,
	"decimals" smallint NOT NULL,
	"kind" "currency_kind" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currency_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_code" text NOT NULL,
	"to_code" text NOT NULL,
	"kind" "exchange_kind" NOT NULL,
	"markup_bps" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "currency_pairs_direction" UNIQUE("from_code","to_code","kind"),
	CONSTRAINT "currency_pairs_markup_non_negative" CHECK ("currency_pairs"."markup_bps" >= 0)
);
--> statement-breakpoint
CREATE TABLE "exchange_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"from_status" "exchange_request_status",
	"to_status" "exchange_request_status" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_staff_id" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" bigint NOT NULL,
	"kind" "exchange_kind" NOT NULL,
	"from_code" text NOT NULL,
	"to_code" text NOT NULL,
	"from_amount" numeric(38, 18) NOT NULL,
	"to_amount" numeric(38, 18),
	"preliminary_rate" numeric(38, 18),
	"final_rate" numeric(38, 18),
	"service_income" numeric(38, 18),
	"service_income_code" text,
	"status" "exchange_request_status" DEFAULT 'new' NOT NULL,
	"assigned_manager_id" uuid,
	"requisites_id" uuid,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "exchange_requests_income_on_completion" CHECK ("exchange_requests"."status" <> 'completed' or "exchange_requests"."service_income" is not null)
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"referrer_id" bigint NOT NULL,
	"referral_id" bigint NOT NULL,
	"line" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_referrer_id_referral_id_pk" PRIMARY KEY("referrer_id","referral_id"),
	CONSTRAINT "referrals_line_range" CHECK ("referrals"."line" in (1, 2)),
	CONSTRAINT "referrals_not_self" CHECK ("referrals"."referrer_id" <> "referrals"."referral_id")
);
--> statement-breakpoint
CREATE TABLE "requisite_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"requisites_id" uuid NOT NULL,
	"exchange_request_id" uuid,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_user_id" bigint NOT NULL,
	"display_name" text NOT NULL,
	"role" "staff_role" DEFAULT 'manager' NOT NULL,
	"totp_secret_sealed" "bytea",
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_telegram_user_id_unique" UNIQUE("telegram_user_id")
);
--> statement-breakpoint
CREATE TABLE "withdrawal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" bigint NOT NULL,
	"amount" numeric(38, 18) NOT NULL,
	"method" "withdrawal_method" NOT NULL,
	"destination_sealed" "bytea",
	"destination_hint" text,
	"status" "withdrawal_request_status" DEFAULT 'new' NOT NULL,
	"manager_id" uuid,
	"reject_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bonus_transactions" ADD CONSTRAINT "bonus_transactions_client_id_clients_telegram_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonus_transactions" ADD CONSTRAINT "bonus_transactions_exchange_request_id_exchange_requests_id_fk" FOREIGN KEY ("exchange_request_id") REFERENCES "public"."exchange_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_applications" ADD CONSTRAINT "card_applications_client_id_clients_telegram_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_requisites" ADD CONSTRAINT "client_requisites_client_id_clients_telegram_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_pairs" ADD CONSTRAINT "currency_pairs_from_code_currencies_code_fk" FOREIGN KEY ("from_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "currency_pairs" ADD CONSTRAINT "currency_pairs_to_code_currencies_code_fk" FOREIGN KEY ("to_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_request_events" ADD CONSTRAINT "exchange_request_events_request_id_exchange_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."exchange_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_client_id_clients_telegram_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_requisites_id_client_requisites_id_fk" FOREIGN KEY ("requisites_id") REFERENCES "public"."client_requisites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_clients_telegram_user_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referral_id_clients_telegram_user_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD CONSTRAINT "requisite_access_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD CONSTRAINT "requisite_access_log_requisites_id_client_requisites_id_fk" FOREIGN KEY ("requisites_id") REFERENCES "public"."client_requisites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD CONSTRAINT "requisite_access_log_exchange_request_id_exchange_requests_id_fk" FOREIGN KEY ("exchange_request_id") REFERENCES "public"."exchange_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_client_id_clients_telegram_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bonus_transactions_client_idx" ON "bonus_transactions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "card_applications_client_idx" ON "card_applications" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_requisites_client_idx" ON "client_requisites" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "clients_referrer_idx" ON "clients" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "exchange_request_events_request_idx" ON "exchange_request_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "exchange_requests_client_idx" ON "exchange_requests" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "exchange_requests_status_idx" ON "exchange_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "referrals_referral_idx" ON "referrals" USING btree ("referral_id");--> statement-breakpoint
CREATE INDEX "requisite_access_log_staff_idx" ON "requisite_access_log" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "requisite_access_log_requisites_idx" ON "requisite_access_log" USING btree ("requisites_id");--> statement-breakpoint
CREATE INDEX "withdrawal_requests_status_idx" ON "withdrawal_requests" USING btree ("status");