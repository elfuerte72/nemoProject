-- Минимальная сумма направления в долларовом эквиваленте: владелец
-- задаёт евро «меньше пятисот долларов — недоступно». Пусто — порога
-- нет, и существующие сетки остаются без него; общий минимум сервиса
-- продолжает действовать поверх.
ALTER TABLE "fee_schedules" ADD COLUMN "min_usd" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_min_positive" CHECK ("fee_schedules"."min_usd" is null or "fee_schedules"."min_usd" > 0);