ALTER TABLE "client_messages" ADD COLUMN "staff_reminded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD COLUMN "stale_alerted_at" timestamp with time zone;--> statement-breakpoint
-- Всё, что залежалось до появления сторожа, считается напомненным.
--
-- Иначе первый же прогон после выкатки высыпет менеджеру напоминания обо
-- всём, что копилось до сих пор, — и он выучит, что уведомления панели
-- можно не читать. То, что и правда ждёт, он видит на своём экране.
UPDATE "exchange_requests" SET "stale_alerted_at" = now() WHERE "stale_alerted_at" IS NULL;--> statement-breakpoint
UPDATE "client_messages" SET "staff_reminded_at" = now() WHERE "staff_reminded_at" IS NULL;