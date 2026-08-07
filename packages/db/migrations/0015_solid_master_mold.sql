DROP INDEX IF EXISTS "exchange_requests_status_idx";--> statement-breakpoint
CREATE INDEX "exchange_requests_status_created_idx" ON "exchange_requests" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "exchange_requests_manager_idx" ON "exchange_requests" USING btree ("assigned_manager_id","created_at","id");