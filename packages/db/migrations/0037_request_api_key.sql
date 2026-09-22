ALTER TABLE "exchange_requests" ADD COLUMN "api_key_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_id_merchant_key" UNIQUE("id","merchant_id");--> statement-breakpoint
ALTER TABLE "exchange_requests" ADD CONSTRAINT "exchange_requests_api_key_fk" FOREIGN KEY ("api_key_id","merchant_id") REFERENCES "public"."api_keys"("id","merchant_id") ON DELETE no action ON UPDATE no action;
