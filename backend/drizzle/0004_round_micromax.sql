CREATE INDEX IF NOT EXISTS "responses_worker_idx" ON "responses" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_target_idx" ON "reviews" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reviews_reviewer_idx" ON "reviews" USING btree ("reviewer_id");