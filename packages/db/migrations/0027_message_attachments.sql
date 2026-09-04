-- Файлы от клиента: до этого бот принимал только фото, и у вложения
-- не было ничего, кроме идентификатора у Telegram. Теперь у него род,
-- тип, имя и размер — из самого обновления, до скачивания. Всё, что
-- лежало в ленте до миграции, было фотографиями: другого бот не
-- принимал, — и они получают род до того, как ограничение его потребует.
CREATE TYPE "public"."attachment_kind" AS ENUM('photo', 'document', 'video', 'voice', 'audio', 'video_note');--> statement-breakpoint
ALTER TABLE "client_messages" ADD COLUMN "attachment_kind" "attachment_kind";--> statement-breakpoint
ALTER TABLE "client_messages" ADD COLUMN "attachment_mime" text;--> statement-breakpoint
ALTER TABLE "client_messages" ADD COLUMN "attachment_name" text;--> statement-breakpoint
ALTER TABLE "client_messages" ADD COLUMN "attachment_size" bigint;--> statement-breakpoint
UPDATE "client_messages" SET "attachment_kind" = 'photo' WHERE "attachment_file_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_attachment_described" CHECK (case when "client_messages"."attachment_file_id" is null
        then "client_messages"."attachment_kind" is null and "client_messages"."attachment_mime" is null
          and "client_messages"."attachment_name" is null and "client_messages"."attachment_size" is null
        else "client_messages"."attachment_kind" is not null
      end);