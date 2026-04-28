ALTER TABLE "payment_methods"
  ADD COLUMN "provider_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "payments"
  ADD COLUMN "payment_method_id" UUID,
  ADD COLUMN "provider_status" TEXT,
  ADD COLUMN "provider_metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "last_error_code" TEXT,
  ADD COLUMN "last_error_message" TEXT,
  ADD COLUMN "attempt_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_webhook_event_id" TEXT,
  ADD COLUMN "last_webhook_received_at" TIMESTAMP(3);

CREATE TABLE "payment_webhook_events" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "external_event_id" TEXT NOT NULL,
  "provider_payment_id" TEXT NOT NULL,
  "payment_id" UUID,
  "event_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'received',
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "processing_error" TEXT,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),

  CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_webhook_events_external_event_id_key" ON "payment_webhook_events"("external_event_id");
CREATE INDEX "payment_webhook_events_provider_payment_id_idx" ON "payment_webhook_events"("provider_payment_id");
CREATE INDEX "payment_webhook_events_payment_id_idx" ON "payment_webhook_events"("payment_id");
CREATE INDEX "payments_payment_method_id_idx" ON "payments"("payment_method_id");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_payment_method_id_fkey"
  FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payment_webhook_events"
  ADD CONSTRAINT "payment_webhook_events_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
