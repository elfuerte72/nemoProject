CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_staff_id" uuid NOT NULL,
	"body" text NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"delivered" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"subject_id" text,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcasts" ADD CONSTRAINT "broadcasts_author_staff_id_staff_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_audit_log" ADD CONSTRAINT "settings_audit_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settings_audit_log_created_idx" ON "settings_audit_log" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "bonus_transactions" ADD CONSTRAINT "bonus_transactions_withdrawal_request_id_withdrawal_requests_id_fk" FOREIGN KEY ("withdrawal_request_id") REFERENCES "public"."withdrawal_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_manager_id_staff_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "withdrawal_requests_client_idx" ON "withdrawal_requests" USING btree ("client_id");--> statement-breakpoint
ALTER TABLE "bonus_transactions" ADD CONSTRAINT "bonus_transactions_one_payout_per_withdrawal" UNIQUE("withdrawal_request_id");--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_amount_positive" CHECK ("withdrawal_requests"."amount" > 0);--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_reject_reason" CHECK ("withdrawal_requests"."status" <> 'rejected' or "withdrawal_requests"."reject_reason" is not null);