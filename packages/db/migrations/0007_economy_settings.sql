ALTER TABLE "currency_pairs" DROP CONSTRAINT "currency_pairs_markup_non_negative";--> statement-breakpoint
ALTER TABLE "service_settings" ADD COLUMN "markup_bps" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "service_settings" ADD COLUMN "min_exchange_amount" numeric(38, 18) DEFAULT '3000' NOT NULL;--> statement-breakpoint
ALTER TABLE "service_settings" ADD COLUMN "unpaid_request_ttl_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "currency_pairs" DROP COLUMN "markup_bps";--> statement-breakpoint
ALTER TABLE "service_settings" ADD CONSTRAINT "service_settings_markup_range" CHECK ("service_settings"."markup_bps" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "service_settings" ADD CONSTRAINT "service_settings_min_exchange_non_negative" CHECK ("service_settings"."min_exchange_amount" >= 0);--> statement-breakpoint
ALTER TABLE "service_settings" ADD CONSTRAINT "service_settings_ttl_positive" CHECK ("service_settings"."unpaid_request_ttl_minutes" > 0);