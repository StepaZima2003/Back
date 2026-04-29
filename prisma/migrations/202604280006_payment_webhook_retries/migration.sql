ALTER TABLE "payment_webhook_events"
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_attempted_at" TIMESTAMP(3),
  ADD COLUMN "next_retry_at" TIMESTAMP(3),
  ADD COLUMN "dead_lettered_at" TIMESTAMP(3);

CREATE INDEX "payment_webhook_events_status_idx" ON "payment_webhook_events"("status");
CREATE INDEX "payment_webhook_events_next_retry_at_idx" ON "payment_webhook_events"("next_retry_at");
