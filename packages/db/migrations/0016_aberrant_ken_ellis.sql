CREATE TYPE "public"."inquiry_topic" AS ENUM('hotel', 'purchase');--> statement-breakpoint
ALTER TABLE "client_messages" ADD COLUMN "topic" "inquiry_topic";--> statement-breakpoint
CREATE INDEX "client_messages_topic_idx" ON "client_messages" USING btree ("topic","client_id");--> statement-breakpoint
-- Просьбы, поданные до появления колонки, разметить по тексту.
--
-- Разбор префикса — то самое, чего делать нельзя: формулировка живёт в
-- коде и меняется. Но здесь он разовый и смотрит в прошлое: тексты этих
-- строк уже написаны и больше не изменятся, а формулировка на момент
-- миграции известна точно (`SUBJECTS` в `packages/core/src/inquiries.ts`).
-- Без него старые просьбы навсегда осели бы в «Поддержке», и отбор врал
-- бы про историю.
UPDATE "client_messages" SET "topic" = 'hotel'
  WHERE "topic" IS NULL AND "direction" = 'incoming' AND "body" LIKE 'Оплата отеля. %';
--> statement-breakpoint
UPDATE "client_messages" SET "topic" = 'purchase'
  WHERE "topic" IS NULL AND "direction" = 'incoming' AND "body" LIKE 'Оплата онлайн-покупки. %';
