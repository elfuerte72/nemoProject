-- Амбассадор — клиент с отметкой (docs/adr/0022): человек с аудиторией,
-- которого сервис позвал в программу поимённо. Своей сущности владельца
-- ему не заведено: приводит он своей реферальной ссылкой, баллы копятся
-- на его же счёте, и вторая цепочка рефералов рядом с первой означала
-- бы два счёта одних и тех же денег.
--
-- Ставка здесь не заводится: личная уже лежит в `client_referral_rates`
-- из `0031` и работает по старшинству «личная → уровень → базовая».
CREATE TABLE "ambassadors" (
	"client_id" bigint PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_signed_in_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ambassadors" ADD CONSTRAINT "ambassadors_client_id_clients_telegram_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ambassadors" ADD CONSTRAINT "ambassadors_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;
