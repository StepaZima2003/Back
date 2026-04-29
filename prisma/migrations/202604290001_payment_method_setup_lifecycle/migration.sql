ALTER TABLE "payment_methods"
ADD COLUMN "provider_customer_id" TEXT,
ADD COLUMN "provider_setup_id" TEXT,
ADD COLUMN "last_setup_error_code" TEXT,
ADD COLUMN "last_setup_error_message" TEXT,
ADD COLUMN "confirmed_at" TIMESTAMP(3);

CREATE INDEX "payment_methods_provider_customer_id_idx" ON "payment_methods"("provider_customer_id");
