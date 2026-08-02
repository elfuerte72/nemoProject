CREATE TYPE "public"."message_direction" AS ENUM('incoming', 'outgoing');--> statement-breakpoint
CREATE TABLE "client_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"client_id" bigint NOT NULL,
	"direction" "message_direction" NOT NULL,
	"body" text,
	"attachment_file_id" text,
	"author_staff_id" uuid,
	"exchange_request_id" uuid,
	"acknowledged_at" timestamp with time zone,
	"staff_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_messages_seq_unique" UNIQUE("seq"),
	CONSTRAINT "client_messages_author_for_outgoing" CHECK (("client_messages"."direction" = 'outgoing') = ("client_messages"."author_staff_id" is not null)),
	CONSTRAINT "client_messages_not_empty" CHECK ("client_messages"."body" is not null or "client_messages"."attachment_file_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "requisite_access_log" DROP CONSTRAINT "requisite_access_log_subject";--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_client_id_clients_telegram_user_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("telegram_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_author_staff_id_staff_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_exchange_request_id_exchange_requests_id_fk" FOREIGN KEY ("exchange_request_id") REFERENCES "public"."exchange_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_messages_client_idx" ON "client_messages" USING btree ("client_id","seq");--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD CONSTRAINT "requisite_access_log_message_id_client_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."client_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requisite_access_log" ADD CONSTRAINT "requisite_access_log_subject" CHECK ((case when "requisite_access_log"."requisites_id" is not null then 1 else 0 end
        + case when "requisite_access_log"."withdrawal_request_id" is not null then 1 else 0 end
        + case when "requisite_access_log"."message_id" is not null then 1 else 0 end) = 1);