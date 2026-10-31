-- Structure-only forward migration. A later, separately reviewed migration must
-- replace the insert gate while extending every source and terminal guard.
-- This migration makes no existing case eligible for an early closure write.
BEGIN;

CREATE TABLE "case_early_closures" (
  "id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "department_id" uuid NOT NULL,
  "from_stage" "case_stage" NOT NULL,
  "from_version" integer NOT NULL,
  "to_version" integer NOT NULL,
  "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recorded_by_user_id" uuid NOT NULL,
  "audit_event_id" uuid NOT NULL,
  CONSTRAINT "case_early_closures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_early_closures_case_id_key" UNIQUE ("case_id"),
  CONSTRAINT "case_early_closures_case_department_key" UNIQUE ("case_id", "department_id"),
  CONSTRAINT "case_early_closures_identity_key" UNIQUE ("id", "case_id", "department_id"),
  CONSTRAINT "case_early_closures_case_from_version_key" UNIQUE ("case_id", "from_version"),
  CONSTRAINT "case_early_closures_audit_event_id_key" UNIQUE ("audit_event_id"),
  CONSTRAINT "case_early_closures_stage_version_check" CHECK (
    "from_stage" NOT IN ('WAITING_ARCHIVE', 'ARCHIVED')
    AND "from_version" >= 1
    AND "to_version" = "from_version" + 1
  ),
  CONSTRAINT "case_early_closures_case_fk" FOREIGN KEY ("case_id", "department_id")
    REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_closures_actor_fk" FOREIGN KEY ("recorded_by_user_id")
    REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_closures_membership_fk" FOREIGN KEY ("recorded_by_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_closures_audit_fk" FOREIGN KEY ("audit_event_id")
    REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "case_early_closures_department_recorded_idx"
  ON "case_early_closures"("department_id", "recorded_at", "id");

CREATE TABLE "case_early_closure_receipts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "department_id" uuid NOT NULL,
  "actor_user_id" uuid NOT NULL,
  "case_id" uuid NOT NULL,
  "early_closure_id" uuid NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_fingerprint" char(64) NOT NULL,
  "result_snapshot" jsonb NOT NULL,
  "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_early_closure_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "early_closure_actor_key" UNIQUE ("department_id", "actor_user_id", "idempotency_key"),
  CONSTRAINT "case_early_closure_receipts_fact_key" UNIQUE ("early_closure_id"),
  CONSTRAINT "case_early_closure_receipts_shape_check" CHECK (
    length("idempotency_key") > 0
    AND "idempotency_key" = btrim("idempotency_key")
    AND "request_fingerprint" ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof("result_snapshot") = 'object'
  ),
  CONSTRAINT "case_early_closure_receipts_case_fk" FOREIGN KEY ("case_id", "department_id")
    REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_closure_receipts_fact_fk" FOREIGN KEY ("early_closure_id", "case_id", "department_id")
    REFERENCES "case_early_closures"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_closure_receipts_actor_fk" FOREIGN KEY ("actor_user_id")
    REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "case_early_closure_receipts_membership_fk" FOREIGN KEY ("actor_user_id", "department_id")
    REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "case_early_closure_receipts_case_department_idx"
  ON "case_early_closure_receipts"("case_id", "department_id");

ALTER TABLE "case_closures" ADD COLUMN "early_closure_id" uuid;
ALTER TABLE "case_closure_versions" ADD COLUMN "early_closure_id" uuid;
ALTER TABLE "case_closures" ADD CONSTRAINT "case_closures_early_closure_id_key" UNIQUE ("early_closure_id");
ALTER TABLE "case_closures" ADD CONSTRAINT "case_closures_early_closure_identity_key"
  UNIQUE ("early_closure_id", "case_id", "department_id");
ALTER TABLE "case_closures" ADD CONSTRAINT "case_closures_early_source_shape" CHECK (
  "early_closure_id" IS NULL OR ("finish_id" IS NULL AND "external_entry_id" IS NULL)
);
ALTER TABLE "case_closure_versions" ADD CONSTRAINT "case_closure_versions_early_source_shape" CHECK (
  "early_closure_id" IS NULL OR ("finish_id" IS NULL AND "external_entry_id" IS NULL)
);
ALTER TABLE "case_closures" ADD CONSTRAINT "case_closures_early_closure_fk"
  FOREIGN KEY ("early_closure_id", "case_id", "department_id")
  REFERENCES "case_early_closures"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "case_closure_versions" ADD CONSTRAINT "case_closure_versions_early_closure_fk"
  FOREIGN KEY ("early_closure_id", "case_id", "department_id")
  REFERENCES "case_early_closures"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Fail closed until the source-chain, actor, upload, final and archive guards
-- are atomically extended. The later migration replaces this function only
-- after all historical source branches have been preserved and checked.
CREATE FUNCTION "case_early_closure_structure_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'early closure source is not enabled' USING ERRCODE = '23514';
  END IF;
  RAISE EXCEPTION 'early closure source is immutable' USING ERRCODE = '23514';
END; $$;
CREATE TRIGGER "case_early_closures_structure_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "case_early_closures"
  FOR EACH ROW EXECUTE FUNCTION "case_early_closure_structure_guard"();
CREATE TRIGGER "case_early_closure_receipts_structure_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "case_early_closure_receipts"
  FOR EACH ROW EXECUTE FUNCTION "case_early_closure_structure_guard"();

COMMIT;
