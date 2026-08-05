ALTER TABLE "withdrawal_requests" ADD COLUMN "requisites_id" uuid;--> statement-breakpoint
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_requisites_id_client_requisites_id_fk" FOREIGN KEY ("requisites_id") REFERENCES "public"."client_requisites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- NOT VALID: правило про новые заявки, а не про уже поданные. Проверять
-- им прошлое незачем — там ответ на вопрос «куда платить» другой, и
-- упавшая на исторической строке миграция остановила бы выкатку целиком.
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_destination" CHECK ((case when "withdrawal_requests"."requisites_id" is not null then 1 else 0 end
        + case when "withdrawal_requests"."destination_sealed" is not null then 1 else 0 end) = 1) NOT VALID;
