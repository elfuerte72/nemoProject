CREATE TYPE "public"."payout_method" AS ENUM('bank', 'wallet', 'cash');--> statement-breakpoint
CREATE TABLE "fee_schedule_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"up_to_usd" numeric(38, 18),
	"fixed_usd" numeric(38, 18),
	"rate_bps" integer,
	CONSTRAINT "fee_schedule_tiers_threshold" UNIQUE("schedule_id","up_to_usd"),
	CONSTRAINT "fee_schedule_tiers_single_rate" CHECK (("fee_schedule_tiers"."fixed_usd" is null) <> ("fee_schedule_tiers"."rate_bps" is null)),
	CONSTRAINT "fee_schedule_tiers_rate_range" CHECK ("fee_schedule_tiers"."rate_bps" is null or "fee_schedule_tiers"."rate_bps" between 0 and 10000),
	CONSTRAINT "fee_schedule_tiers_fixed_non_negative" CHECK ("fee_schedule_tiers"."fixed_usd" is null or "fee_schedule_tiers"."fixed_usd" >= 0),
	CONSTRAINT "fee_schedule_tiers_threshold_positive" CHECK ("fee_schedule_tiers"."up_to_usd" is null or "fee_schedule_tiers"."up_to_usd" > 0)
);
--> statement-breakpoint
CREATE TABLE "fee_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_code" text NOT NULL,
	"payout_method" "payout_method" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_schedules_target" UNIQUE("to_code","payout_method")
);
--> statement-breakpoint
ALTER TABLE "fee_schedule_tiers" ADD CONSTRAINT "fee_schedule_tiers_schedule_id_fee_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."fee_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_to_code_currencies_code_fk" FOREIGN KEY ("to_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;