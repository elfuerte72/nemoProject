ALTER TABLE "requisite_access_log" ALTER COLUMN "requisites_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "marketing_consent_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD COLUMN "withdrawal_request_id" uuid;--> statement-breakpoint
-- Колонка добавляется пустой и заполняется по уже записанным
-- реквизитам, а потом объявляется обязательной: `NOT NULL` сразу
-- отвергла бы миграцию на любой базе, где записи в журнале уже есть.
-- Журнал правке не подлежит, но это заполнение, а не правка: клиент у
-- каждой записи и так был — через ссылку на реквизиты.
ALTER TABLE "requisite_access_log" ADD COLUMN "client_id" bigint;--> statement-breakpoint
UPDATE "requisite_access_log" SET "client_id" = "client_requisites"."client_id"
  FROM "client_requisites"
  WHERE "client_requisites"."id" = "requisite_access_log"."requisites_id";--> statement-breakpoint
ALTER TABLE "requisite_access_log" ALTER COLUMN "client_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD CONSTRAINT "requisite_access_log_withdrawal_request_id_withdrawal_requests_id_fk" FOREIGN KEY ("withdrawal_request_id") REFERENCES "public"."withdrawal_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD CONSTRAINT "requisite_access_log_client_id_clients_telegram_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "requisite_access_log_client_idx" ON "requisite_access_log" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD CONSTRAINT "requisite_access_log_subject" CHECK (("requisite_access_log"."requisites_id" is not null) <> ("requisite_access_log"."withdrawal_request_id" is not null));