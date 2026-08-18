-- Запрет «ровно одна ставка» сужается по формуле владельца для евро
-- («3,3 % и 10 EUR сверху»): доля сочетается с любым фиксом, а
-- бессмысленной остаётся ровно пара фиксов — один вычитается до
-- умножения на курс, второй после. Существующие строки валидны без
-- правок: у каждой одна ставка и пустой фикс валюты выдачи.
ALTER TABLE "fee_schedule_tiers" DROP CONSTRAINT "fee_schedule_tiers_single_rate";--> statement-breakpoint
ALTER TABLE "fee_schedule_tiers" ADD COLUMN "fixed_payout" numeric(38, 18);--> statement-breakpoint
ALTER TABLE "fee_schedule_tiers" ADD CONSTRAINT "fee_schedule_tiers_any_rate" CHECK ("fee_schedule_tiers"."fixed_usd" is not null or "fee_schedule_tiers"."rate_bps" is not null or "fee_schedule_tiers"."fixed_payout" is not null);--> statement-breakpoint
ALTER TABLE "fee_schedule_tiers" ADD CONSTRAINT "fee_schedule_tiers_single_fixed" CHECK ("fee_schedule_tiers"."fixed_usd" is null or "fee_schedule_tiers"."fixed_payout" is null);--> statement-breakpoint
ALTER TABLE "fee_schedule_tiers" ADD CONSTRAINT "fee_schedule_tiers_payout_non_negative" CHECK ("fee_schedule_tiers"."fixed_payout" is null or "fee_schedule_tiers"."fixed_payout" >= 0);