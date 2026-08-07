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
UPDATE "card_applications" SET "staff_notified_at" = now() WHERE "staff_notified_at" IS NULL;--> statement-breakpoint
-- Заявки на вывод — через снятие двух непроверенных ограничений.
--
-- Оба заведены NOT VALID (миграции 0005 и 0013): правила про новые
-- заявки, а поданные до них сети и записи-реквизита не знают. NOT VALID
-- освобождает от проверки только при заведении — любое последующее
-- обновление такой строки её всё-таки выполняет, и сплошная добивка
-- уронила бы миграцию на первой же исторической строке, а с ней и
-- выкатку.
--
-- Поэтому ограничения снимаются и возвращаются в том же виде, в каком
-- стояли: правило для новых заявок сохраняется, история остаётся
-- освобождённой от него, как и было решено.
--
-- Добить их надо непременно: без отметки первый же прогон опроса
-- попытается обновить ту же историческую строку — и будет падать на ней
-- каждые несколько минут, оставляя сотрудников вообще без уведомлений.
ALTER TABLE "withdrawal_requests" DROP CONSTRAINT "withdrawal_requests_crypto_network";--> statement-breakpoint
ALTER TABLE "withdrawal_requests" DROP CONSTRAINT "withdrawal_requests_destination";--> statement-breakpoint
UPDATE "withdrawal_requests" SET "staff_notified_at" = now() WHERE "staff_notified_at" IS NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_crypto_network" CHECK ("withdrawal_requests"."method" <> 'crypto' or "withdrawal_requests"."network" is not null) NOT VALID;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_destination" CHECK ((case when "withdrawal_requests"."requisites_id" is not null then 1 else 0 end
        + case when "withdrawal_requests"."destination_sealed" is not null then 1 else 0 end) = 1) NOT VALID;