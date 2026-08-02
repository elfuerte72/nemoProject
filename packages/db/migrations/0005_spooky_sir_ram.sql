ALTER TABLE "withdrawal_requests" ADD COLUMN "network" text;--> statement-breakpoint
-- NOT VALID: правило вводится для новых заявок, а поданные до него сети не
-- знают, и придумать её за клиента нельзя. Проверка существующих строк
-- уронила бы миграцию, а с ней и запуск приложения, которое её применяет.
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_crypto_network" CHECK ("withdrawal_requests"."method" <> 'crypto' or "withdrawal_requests"."network" is not null) NOT VALID;
