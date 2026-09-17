-- Люди у мерчанта: тот, кто входит в кабинет (тикет 17 трекера кабинета).
--
-- Мерчант — организация, и почта с паролем ей не принадлежат: входят
-- люди. Поэтому почта, хеш пароля, поколение сессий и подтверждение
-- адреса уезжают из `merchants` в `merchant_users`, а у заявки
-- появляется, кто её подал внутри мерчанта.
--
-- Владелец переносится этой же миграцией — тот, кто завёл анкету:
-- имя ему даёт контактное лицо анкеты, роль `owner`, поколение и
-- подтверждение адреса едут как есть, иначе вошедший в кабинет вылетел
-- бы из него на первом запросе.
CREATE TYPE "public"."merchant_user_role" AS ENUM('owner', 'operator', 'viewer');--> statement-breakpoint
CREATE TABLE "merchant_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "merchant_user_role" NOT NULL,
	"session_epoch" integer DEFAULT 1 NOT NULL,
	"email_verified_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "merchant_users" ADD CONSTRAINT "merchant_users_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_users_merchant_idx" ON "merchant_users" USING btree ("merchant_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_users_single_owner" ON "merchant_users" USING btree ("merchant_id") WHERE "merchant_users"."role" = 'owner';--> statement-breakpoint
-- Владельцы из прежних анкет. `created_at` берётся у мерчанта: человек
-- завёлся вместе с организацией, и «заведён сегодня» у него читалось
-- бы как новый сотрудник.
INSERT INTO "merchant_users" ("merchant_id", "email", "password_hash", "name", "role", "session_epoch", "email_verified_at", "created_at")
SELECT "id", "email", "password_hash", "contact_name", 'owner', "session_epoch", "email_verified_at", "created_at" FROM "merchants";--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_submitted_by_user_id_merchant_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."merchant_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Ссылки из писем переезжают на человека: подтверждают адрес и меняют
-- пароль ему. Непрошедшие ссылки достаются владельцу — он и был тем,
-- кому они выданы, пока людей у мерчанта не было.
ALTER TABLE "merchant_email_tokens" ADD COLUMN "merchant_user_id" uuid;--> statement-breakpoint
ALTER TABLE "merchant_email_tokens" ADD CONSTRAINT "merchant_email_tokens_merchant_user_id_merchant_users_id_fk" FOREIGN KEY ("merchant_user_id") REFERENCES "public"."merchant_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "merchant_email_tokens" AS "t" SET "merchant_user_id" = "u"."id"
FROM "merchant_users" AS "u" WHERE "u"."merchant_id" = "t"."merchant_id" AND "u"."role" = 'owner';--> statement-breakpoint
-- Ссылка без хозяина: выдана мерчанту, которого больше нет. Строки
-- одноразовые и живут сутки, и удалить их дешевле, чем оставить
-- колонку необязательной ради мусора.
DELETE FROM "merchant_email_tokens" WHERE "merchant_user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "merchant_email_tokens" DROP CONSTRAINT "merchant_email_tokens_merchant_id_merchants_id_fk";--> statement-breakpoint
DROP INDEX "merchant_email_tokens_merchant_idx";--> statement-breakpoint
ALTER TABLE "merchant_email_tokens" ALTER COLUMN "merchant_user_id" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "merchant_email_tokens_user_idx" ON "merchant_email_tokens" USING btree ("merchant_user_id");--> statement-breakpoint
ALTER TABLE "merchant_email_tokens" DROP COLUMN "merchant_id";--> statement-breakpoint
ALTER TABLE "merchants" DROP CONSTRAINT "merchants_email_unique";--> statement-breakpoint
ALTER TABLE "merchants" DROP COLUMN "email";--> statement-breakpoint
ALTER TABLE "merchants" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "merchants" DROP COLUMN "session_epoch";--> statement-breakpoint
ALTER TABLE "merchants" DROP COLUMN "email_verified_at";
