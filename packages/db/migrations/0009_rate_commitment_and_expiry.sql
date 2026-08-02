-- Переименование, а не пара «добавить и удалить»: курс прошлых заявок
-- должен уцелеть. Он и был тем, по чему сделка шла, — менялось название,
-- а не значение.
ALTER TABLE "exchange_requests" RENAME COLUMN "preliminary_rate" TO "request_rate";--> statement-breakpoint
-- У заявок, поданных до этой миграции, момента выдачи реквизитов нет и
-- взять его неоткуда: вычислять из истории переходов нельзя — истечение
-- обязательства не должно зависеть от полноты журнала. Пустое поле
-- означает, что срок к такой заявке не применяется; менеджер доводит её
-- как раньше.
ALTER TABLE "exchange_requests" ADD COLUMN "requisites_issued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD COLUMN "expiry_warned_at" timestamp with time zone;
