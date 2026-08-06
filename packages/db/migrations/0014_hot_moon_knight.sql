CREATE TABLE "service_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "requisite_kind" NOT NULL,
	"currency_code" text NOT NULL,
	"bank_name" text,
	"holder_name" text,
	"phone" text,
	"card_last4" text,
	"card_sealed" "bytea",
	"network" text,
	"address_sealed" "bytea",
	"address_hint" text,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_accounts_fields_by_kind" CHECK (case "service_accounts"."kind"
        when 'phone' then "service_accounts"."bank_name" is not null and "service_accounts"."holder_name" is not null
          and "service_accounts"."phone" is not null
          and "service_accounts"."card_last4" is null and "service_accounts"."card_sealed" is null
          and "service_accounts"."network" is null and "service_accounts"."address_sealed" is null
          and "service_accounts"."address_hint" is null
        when 'card' then "service_accounts"."bank_name" is not null and "service_accounts"."holder_name" is not null
          and "service_accounts"."card_last4" is not null and "service_accounts"."card_sealed" is not null
          and "service_accounts"."phone" is null
          and "service_accounts"."network" is null and "service_accounts"."address_sealed" is null
          and "service_accounts"."address_hint" is null
        when 'wallet' then "service_accounts"."network" is not null and "service_accounts"."address_sealed" is not null
          and "service_accounts"."address_hint" is not null and "service_accounts"."bank_name" is null
          and "service_accounts"."holder_name" is null
          and "service_accounts"."phone" is null and "service_accounts"."card_last4" is null
          and "service_accounts"."card_sealed" is null
      end)
);
--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD COLUMN "service_account_id" uuid;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_network_transfer_networks_code_fk" FOREIGN KEY ("network") REFERENCES "public"."transfer_networks"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_accounts_currency_idx" ON "service_accounts" USING btree ("currency_code","is_active");--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE no action ON UPDATE no action;