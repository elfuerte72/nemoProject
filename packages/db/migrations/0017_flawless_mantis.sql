ALTER TABLE "card_applications" ADD COLUMN "staff_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD COLUMN "staff_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD COLUMN "staff_notified_at" timestamp with time zone;--> statement-breakpoint
-- Всё, что подано до появления отметки, считается сообщённым.
--
-- Иначе первый же прогон планировщика после выкатки разошлёт менеджерам
-- всю накопленную историю: пустая отметка означает «ещё не говорили», а
-- до этой миграции о заявках не говорили ни разу ни о единой. Заявки,
-- которые и правда ждут, менеджер видит на своём экране — он им и
-- пользовался всё это время.
UPDATE "exchange_requests" SET "staff_notified_at" = now() WHERE "staff_notified_at" IS NULL;--> statement-breakpoint
UPDATE "withdrawal_requests" SET "staff_notified_at" = now() WHERE "staff_notified_at" IS NULL;--> statement-breakpoint
UPDATE "card_applications" SET "staff_notified_at" = now() WHERE "staff_notified_at" IS NULL;