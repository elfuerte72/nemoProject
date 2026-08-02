CREATE TYPE "public"."requisite_kind" AS ENUM('phone', 'card', 'wallet');--> statement-breakpoint
CREATE TABLE "text_templates" (
	"key" text PRIMARY KEY NOT NULL,
	"body" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transfer_networks" (
	"code" text PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
-- Справочник наполняется здесь, а не скриптом развёртывания: ссылки
-- ниже упрутся в сеть, которой в нём нет, и миграция не пройдёт на базе,
-- где заявки на вывод уже подавали.
INSERT INTO "transfer_networks" ("code") VALUES ('TRC20'), ('TON') ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Сети из прошлых заявок — выключенными: справочник обязан покрывать
-- историю, а предлагать клиенту сеть, из которой сервис ушёл, незачем.
INSERT INTO "transfer_networks" ("code", "is_active")
SELECT DISTINCT "network", false FROM "withdrawal_requests" WHERE "network" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "kind" "requisite_kind";--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "network" text;--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "address_sealed" "bytea";--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "address_hint" text;--> statement-breakpoint
-- Прежние записи типа не имеют, и вывести его не из чего: набор
-- заполненных полей у них произвольный. Поэтому они закрываются архивом
-- — прошлые заявки продолжают на них ссылаться, — а клиент заводит
-- реквизит заново, уже способом, которым хочет получить деньги.
UPDATE "client_requisites"
SET "kind" = CASE WHEN "card_sealed" IS NOT NULL THEN 'card' ELSE 'phone' END::"requisite_kind",
    "archived_at" = coalesce("archived_at", now())
WHERE "kind" IS NULL;--> statement-breakpoint
ALTER TABLE "client_requisites" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "client_requisites" ADD CONSTRAINT "client_requisites_network_transfer_networks_code_fk" FOREIGN KEY ("network") REFERENCES "public"."transfer_networks"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_network_transfer_networks_code_fk" FOREIGN KEY ("network") REFERENCES "public"."transfer_networks"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_requisites" ADD CONSTRAINT "client_requisites_fields_by_kind" CHECK ("client_requisites"."archived_at" is not null or case "client_requisites"."kind"
        when 'phone' then "client_requisites"."bank_name" is not null and "client_requisites"."phone" is not null
          and "client_requisites"."card_last4" is null and "client_requisites"."card_sealed" is null
          and "client_requisites"."network" is null and "client_requisites"."address_sealed" is null
          and "client_requisites"."address_hint" is null
        when 'card' then "client_requisites"."bank_name" is not null and "client_requisites"."card_last4" is not null
          and "client_requisites"."card_sealed" is not null and "client_requisites"."phone" is null
          and "client_requisites"."network" is null and "client_requisites"."address_sealed" is null
          and "client_requisites"."address_hint" is null
        when 'wallet' then "client_requisites"."network" is not null and "client_requisites"."address_sealed" is not null
          and "client_requisites"."address_hint" is not null and "client_requisites"."bank_name" is null
          and "client_requisites"."phone" is null and "client_requisites"."card_last4" is null
          and "client_requisites"."card_sealed" is null
      end);
