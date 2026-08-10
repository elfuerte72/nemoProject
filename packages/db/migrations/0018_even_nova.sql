CREATE TYPE "public"."concierge_outcome" AS ENUM('pending', 'answered', 'escalated');--> statement-breakpoint
CREATE TABLE "concierge_knowledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "concierge_knowledge_not_empty" CHECK (length(btrim("concierge_knowledge"."body")) > 0),
	CONSTRAINT "concierge_knowledge_title_not_empty" CHECK (length(btrim("concierge_knowledge"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "client_messages" DROP CONSTRAINT "client_messages_author_for_outgoing";--> statement-breakpoint
ALTER TABLE "client_messages" ADD COLUMN "authored_by_concierge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "client_messages" ADD COLUMN "concierge_outcome" "concierge_outcome";--> statement-breakpoint
ALTER TABLE "client_messages" ADD COLUMN "escalation_reason" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "handed_to_human_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_settings" ADD COLUMN "concierge_replies_per_client_daily" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "service_settings" ADD COLUMN "concierge_replies_daily" integer DEFAULT 2000 NOT NULL;--> statement-breakpoint
CREATE INDEX "concierge_knowledge_order_idx" ON "concierge_knowledge" USING btree ("is_active","position");--> statement-breakpoint
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_concierge_outcome_for_incoming" CHECK ("client_messages"."concierge_outcome" is null or "client_messages"."direction" = 'incoming');--> statement-breakpoint
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_escalation_reason" CHECK (coalesce("client_messages"."concierge_outcome" = 'escalated', false)
        = ("client_messages"."escalation_reason" is not null));--> statement-breakpoint
ALTER TABLE "client_messages" ADD CONSTRAINT "client_messages_author_for_outgoing" CHECK (case "client_messages"."direction"
        when 'outgoing' then ("client_messages"."author_staff_id" is not null) <> "client_messages"."authored_by_concierge"
        else "client_messages"."author_staff_id" is null and not "client_messages"."authored_by_concierge"
      end);--> statement-breakpoint
ALTER TABLE "service_settings" ADD CONSTRAINT "service_settings_concierge_per_client_non_negative" CHECK ("service_settings"."concierge_replies_per_client_daily" >= 0);--> statement-breakpoint
ALTER TABLE "service_settings" ADD CONSTRAINT "service_settings_concierge_daily_non_negative" CHECK ("service_settings"."concierge_replies_daily" >= 0);