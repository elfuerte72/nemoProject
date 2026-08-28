-- Четыре новых рода записи реквизита — тайский банковский счёт,
-- PromptPay (Thai QR), Alipay по аккаунту и по QR — по письму владельца
-- от 20 августа 2026. Данные не переносятся: прод демонстрационный.
--
-- Ограничение «поля по роду» сравнивает род как текст: миграции идут
-- одной транзакцией, и значение, только что добавленное в перечисление,
-- в той же транзакции использовать нельзя. Незнакомому роду оба
-- ограничения теперь отказывают явно (`else false`): `CASE` без ветки
-- давал `NULL`, а `NULL` в `CHECK` проходит — счёт сервиса в батах
-- прошёл бы молча.
CREATE TYPE "public"."promptpay_id_type" AS ENUM('phone', 'national_id', 'ewallet');--> statement-breakpoint
ALTER TYPE "public"."requisite_kind" ADD VALUE 'account';--> statement-breakpoint
ALTER TYPE "public"."requisite_kind" ADD VALUE 'promptpay';--> statement-breakpoint
ALTER TYPE "public"."requisite_kind" ADD VALUE 'alipay';--> statement-breakpoint
ALTER TYPE "public"."requisite_kind" ADD VALUE 'alipay_qr';--> statement-breakpoint
ALTER TABLE "client_requisites" DROP CONSTRAINT "client_requisites_fields_by_kind";--> statement-breakpoint
ALTER TABLE "service_accounts" DROP CONSTRAINT "service_accounts_fields_by_kind";--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "holder_name" text;--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "account_last4" text;--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "account_sealed" "bytea";--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "qr_sealed" "bytea";--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "qr_hint" text;--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "promptpay_id_type" "promptpay_id_type";--> statement-breakpoint
ALTER TABLE "client_requisites" ADD COLUMN "alipay_account" text;--> statement-breakpoint
ALTER TABLE "client_requisites" ADD CONSTRAINT "client_requisites_fields_by_kind" CHECK ("client_requisites"."archived_at" is not null or case "client_requisites"."kind"::text
        when 'phone' then "client_requisites"."bank_name" is not null and "client_requisites"."phone" is not null
          and "client_requisites"."card_last4" is null and "client_requisites"."card_sealed" is null
          and "client_requisites"."network" is null and "client_requisites"."address_sealed" is null
          and "client_requisites"."address_hint" is null and "client_requisites"."holder_name" is null
          and "client_requisites"."account_last4" is null and "client_requisites"."account_sealed" is null
          and "client_requisites"."qr_sealed" is null and "client_requisites"."qr_hint" is null
          and "client_requisites"."promptpay_id_type" is null and "client_requisites"."alipay_account" is null
        when 'card' then "client_requisites"."bank_name" is not null and "client_requisites"."card_last4" is not null
          and "client_requisites"."card_sealed" is not null and "client_requisites"."phone" is null
          and "client_requisites"."network" is null and "client_requisites"."address_sealed" is null
          and "client_requisites"."address_hint" is null and "client_requisites"."holder_name" is null
          and "client_requisites"."account_last4" is null and "client_requisites"."account_sealed" is null
          and "client_requisites"."qr_sealed" is null and "client_requisites"."qr_hint" is null
          and "client_requisites"."promptpay_id_type" is null and "client_requisites"."alipay_account" is null
        when 'wallet' then "client_requisites"."network" is not null and "client_requisites"."address_sealed" is not null
          and "client_requisites"."address_hint" is not null and "client_requisites"."bank_name" is null
          and "client_requisites"."phone" is null and "client_requisites"."card_last4" is null
          and "client_requisites"."card_sealed" is null and "client_requisites"."holder_name" is null
          and "client_requisites"."account_last4" is null and "client_requisites"."account_sealed" is null
          and "client_requisites"."qr_sealed" is null and "client_requisites"."qr_hint" is null
          and "client_requisites"."promptpay_id_type" is null and "client_requisites"."alipay_account" is null
        when 'account' then "client_requisites"."bank_name" is not null and "client_requisites"."holder_name" is not null
          and "client_requisites"."account_last4" is not null and "client_requisites"."account_sealed" is not null
          and "client_requisites"."phone" is null and "client_requisites"."card_last4" is null
          and "client_requisites"."card_sealed" is null and "client_requisites"."network" is null
          and "client_requisites"."address_sealed" is null and "client_requisites"."address_hint" is null
          and "client_requisites"."qr_sealed" is null and "client_requisites"."qr_hint" is null
          and "client_requisites"."promptpay_id_type" is null and "client_requisites"."alipay_account" is null
        when 'promptpay' then "client_requisites"."holder_name" is not null and "client_requisites"."qr_sealed" is not null
          and "client_requisites"."qr_hint" is not null and "client_requisites"."promptpay_id_type" is not null
          and "client_requisites"."bank_name" is null and "client_requisites"."phone" is null
          and "client_requisites"."card_last4" is null and "client_requisites"."card_sealed" is null
          and "client_requisites"."network" is null and "client_requisites"."address_sealed" is null
          and "client_requisites"."address_hint" is null and "client_requisites"."account_last4" is null
          and "client_requisites"."account_sealed" is null and "client_requisites"."alipay_account" is null
        when 'alipay' then "client_requisites"."holder_name" is not null and "client_requisites"."alipay_account" is not null
          and "client_requisites"."bank_name" is null and "client_requisites"."phone" is null
          and "client_requisites"."card_last4" is null and "client_requisites"."card_sealed" is null
          and "client_requisites"."network" is null and "client_requisites"."address_sealed" is null
          and "client_requisites"."address_hint" is null and "client_requisites"."account_last4" is null
          and "client_requisites"."account_sealed" is null and "client_requisites"."qr_sealed" is null
          and "client_requisites"."qr_hint" is null and "client_requisites"."promptpay_id_type" is null
        when 'alipay_qr' then "client_requisites"."holder_name" is not null and "client_requisites"."qr_sealed" is not null
          and "client_requisites"."qr_hint" is not null and "client_requisites"."bank_name" is null
          and "client_requisites"."phone" is null and "client_requisites"."card_last4" is null
          and "client_requisites"."card_sealed" is null and "client_requisites"."network" is null
          and "client_requisites"."address_sealed" is null and "client_requisites"."address_hint" is null
          and "client_requisites"."account_last4" is null and "client_requisites"."account_sealed" is null
          and "client_requisites"."promptpay_id_type" is null and "client_requisites"."alipay_account" is null
        else false
      end);--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_fields_by_kind" CHECK (case "service_accounts"."kind"::text
        when 'phone' then "service_accounts"."bank_name" is not null and "service_accounts"."holder_name" is not null
          and "service_accounts"."phone" is not null
          and "service_accounts"."card_last4" is null and "service_accounts"."card_sealed" is null
          and "service_accounts"."network" is null and "service_accounts"."address_sealed" is null
          and "service_accounts"."address_hint" is null
        when 'card' then "service_accounts"."bank_name" is not null and "service_accounts"."holder_name" is not null
          and "service_accounts"."card_last4" is not null and "service_accounts"."card_sealed" is not null
          and "service_accounts"."phone" is null
          and "service_accounts"."network" is null and "service_accounts"."address_sealed" is null
          and "service_accounts"."address_hint" is null
        when 'wallet' then "service_accounts"."network" is not null and "service_accounts"."address_sealed" is not null
          and "service_accounts"."address_hint" is not null and "service_accounts"."bank_name" is null
          and "service_accounts"."holder_name" is null
          and "service_accounts"."phone" is null and "service_accounts"."card_last4" is null
          and "service_accounts"."card_sealed" is null
        else false
      end);