ALTER TABLE "broadcasts" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "broadcasts_idempotency_key" ON "broadcasts" USING btree ("idempotency_key");