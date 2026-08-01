CREATE TABLE "service_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"referral_line1_bps" integer DEFAULT 500 NOT NULL,
	"referral_line2_bps" integer DEFAULT 200 NOT NULL,
	"min_withdrawal_amount" numeric(38, 18) DEFAULT '1000' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_settings_singleton" CHECK ("service_settings"."id" = 1),
	CONSTRAINT "service_settings_line1_range" CHECK ("service_settings"."referral_line1_bps" between 0 and 10000),
	CONSTRAINT "service_settings_line2_range" CHECK ("service_settings"."referral_line2_bps" between 0 and 10000),
	CONSTRAINT "service_settings_min_withdrawal_non_negative" CHECK ("service_settings"."min_withdrawal_amount" >= 0)
);
--> statement-breakpoint
-- Строка настроек создаётся вместе с таблицей: операции читают её без
-- проверки на существование, и база не должна оставлять их без ответа.
-- Значения берутся из DEFAULT колонок — второго места для них нет.
INSERT INTO "service_settings" DEFAULT VALUES;
