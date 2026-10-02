BEGIN;

CREATE TABLE "notary_return_archive_batch_receipts" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "result_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notary_return_archive_batch_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notary_return_archive_batch_receipts_key_nonblank_check" CHECK (length(btrim("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key" = btrim("idempotency_key")),
    CONSTRAINT "notary_return_archive_batch_receipts_fingerprint_check" CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "notary_return_archive_batch_receipts_department_actor_key" ON "notary_return_archive_batch_receipts"("department_id", "actor_user_id", "idempotency_key");
CREATE INDEX "notary_return_archive_batch_receipts_department_id_created_at_idx" ON "notary_return_archive_batch_receipts"("department_id", "created_at");
ALTER TABLE "notary_return_archive_batch_receipts" ADD CONSTRAINT "notary_return_archive_batch_receipts_department_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "notary_return_archive_batch_receipts" ADD CONSTRAINT "notary_return_archive_batch_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "notary_return_archive_batch_receipts" ADD CONSTRAINT "notary_return_archive_batch_receipts_internal_actor_fkey" FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE FUNCTION reject_notary_return_archive_batch_receipt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'notary return archive batch receipts are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER notary_return_archive_batch_receipts_immutable
BEFORE UPDATE OR DELETE ON "notary_return_archive_batch_receipts"
FOR EACH ROW EXECUTE FUNCTION reject_notary_return_archive_batch_receipt_mutation();

COMMIT;
