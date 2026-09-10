-- Реферальная программа становится настраиваемой (docs/adr/0021):
-- линий до пяти, уровни по активным рефералам, личные ставки клиенту,
-- несколько кодов у клиента.
--
-- Данные переезжают, а не заводятся заново: ставки двух линий из
-- `service_settings` становятся первыми двумя строками
-- `referral_line_rates`, а код каждого клиента — его ссылкой «Основная»
-- в `referral_codes`. Прежние колонки — `service_settings.referral_line*_bps`
-- и `clients.referral_code` — остаются на одну выкатку: Mini App старой
-- сборки читает их до своей пересборки, и удаление их здесь уронило бы
-- котировки на минуты выката. Убирает их следующая миграция
-- (`backlog.md`); код к ним не обращается, схема ставок их не объявляет,
-- а `clients.referral_code` объявлен без записи — чтобы вставка нового
-- клиента не спорила с NOT NULL, снятым здесь.
CREATE TYPE "public"."referral_code_kind" AS ENUM('link', 'promo');--> statement-breakpoint
CREATE TABLE "client_referral_rates" (
	"client_id" bigint NOT NULL,
	"line" smallint NOT NULL,
	"rate_bps" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_referral_rates_client_id_line_pk" PRIMARY KEY("client_id","line"),
	CONSTRAINT "client_referral_rates_line_range" CHECK ("client_referral_rates"."line" between 1 and 5),
	CONSTRAINT "client_referral_rates_rate_range" CHECK ("client_referral_rates"."rate_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" bigint NOT NULL,
	"code" text NOT NULL,
	"kind" "referral_code_kind" NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "referral_line_rates" (
	"line" smallint PRIMARY KEY NOT NULL,
	"rate_bps" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_line_rates_line_range" CHECK ("referral_line_rates"."line" between 1 and 5),
	CONSTRAINT "referral_line_rates_rate_range" CHECK ("referral_line_rates"."rate_bps" between 0 and 10000)
);
--> statement-breakpoint
INSERT INTO "referral_line_rates" ("line", "rate_bps")
SELECT 1, "referral_line1_bps" FROM "service_settings" WHERE "id" = 1
UNION ALL
SELECT 2, "referral_line2_bps" FROM "service_settings" WHERE "id" = 1;--> statement-breakpoint
CREATE TABLE "referral_tier_rates" (
	"tier_id" uuid NOT NULL,
	"line" smallint NOT NULL,
	"rate_bps" integer NOT NULL,
	CONSTRAINT "referral_tier_rates_tier_id_line_pk" PRIMARY KEY("tier_id","line"),
	CONSTRAINT "referral_tier_rates_line_range" CHECK ("referral_tier_rates"."line" between 1 and 5),
	CONSTRAINT "referral_tier_rates_rate_range" CHECK ("referral_tier_rates"."rate_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "referral_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"min_active_referrals" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_tiers_min_active_referrals_unique" UNIQUE("min_active_referrals"),
	CONSTRAINT "referral_tiers_threshold_positive" CHECK ("referral_tiers"."min_active_referrals" >= 1)
);
--> statement-breakpoint
ALTER TABLE "referrals" DROP CONSTRAINT "referrals_line_range";--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "referral_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bonus_transactions" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "referred_via_code_id" uuid;--> statement-breakpoint
ALTER TABLE "client_referral_rates" ADD CONSTRAINT "client_referral_rates_client_id_clients_telegram_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_client_id_clients_telegram_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_tier_rates" ADD CONSTRAINT "referral_tier_rates_tier_id_referral_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."referral_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "referral_codes" ("client_id", "code", "kind", "label")
SELECT "telegram_user_id", "referral_code", 'link', 'Основная'
FROM "clients" WHERE "referral_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "referral_codes_client_idx" ON "referral_codes" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_code_unique" ON "referral_codes" USING btree (upper("code"));--> statement-breakpoint
ALTER TABLE "bonus_transactions" ADD CONSTRAINT "bonus_transactions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_referred_via_code_id_referral_codes_id_fk" FOREIGN KEY ("referred_via_code_id") REFERENCES "public"."referral_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_line_range" CHECK ("referrals"."line" between 1 and 5);