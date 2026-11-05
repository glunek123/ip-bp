BEGIN;
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.lawyer.assign';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.routine.edit';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.closure.settlement.update';
COMMIT;

BEGIN;
CREATE TABLE "case_lawyer_assignment_receipts" (
  "id" UUID NOT NULL PRIMARY KEY,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "request_fingerprint" CHAR(64) NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_lawyer_assignment_receipts_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_lawyer_assignment_receipts_key_check" CHECK ("idempotency_key" = BTRIM("idempotency_key") AND CHAR_LENGTH("idempotency_key") BETWEEN 1 AND 128),
  CONSTRAINT "case_lawyer_assignment_receipts_case_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_lawyer_assignment_receipts_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_lawyer_assignment_receipts_fingerprint_check" CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "case_lawyer_assignment_receipts_snapshot_check" CHECK (jsonb_typeof("result_snapshot") = 'object')
);
CREATE FUNCTION "reject_case_lawyer_assignment_receipt_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'case lawyer assignment receipt is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "case_lawyer_assignment_receipts_immutable"
BEFORE UPDATE OR DELETE ON "case_lawyer_assignment_receipts"
FOR EACH ROW EXECUTE FUNCTION "reject_case_lawyer_assignment_receipt_mutation"();
COMMIT;
