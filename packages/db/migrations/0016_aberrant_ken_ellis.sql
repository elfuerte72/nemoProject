CREATE TYPE "public"."inquiry_topic" AS ENUM('hotel', 'purchase');--> statement-breakpoint
ALTER TABLE "client_messages" ADD COLUMN "topic" "inquiry_topic";--> statement-breakpoint
CREATE INDEX "client_messages_topic_idx" ON "client_messages" USING btree ("topic","client_id");