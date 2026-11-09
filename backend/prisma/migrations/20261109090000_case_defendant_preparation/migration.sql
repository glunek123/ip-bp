ALTER TABLE "case_defendants"
ADD COLUMN "legal_representative" VARCHAR(200);

CREATE TABLE "case_defendant_preparation_receipts" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "result_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_defendant_preparation_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "case_defendant_preparation_receipts_department_id_actor_user_id_idempotency_key_key"
ON "case_defendant_preparation_receipts"("department_id", "actor_user_id", "idempotency_key");

ALTER TABLE "case_defendant_preparation_receipts"
ADD CONSTRAINT "case_defendant_preparation_receipts_case_id_department_id_fkey"
FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id")
ON DELETE RESTRICT ON UPDATE RESTRICT;
