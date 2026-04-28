ALTER TABLE "manual_payment_proofs"
ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "manual_payment_proofs_idempotency_key_key"
ON "manual_payment_proofs"("idempotency_key");
