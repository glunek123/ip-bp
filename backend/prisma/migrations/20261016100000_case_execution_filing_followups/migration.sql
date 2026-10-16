-- EF001: append-only followups under one real execution filing.
-- Enum staging is outside the transaction because new values are used below.
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.execution.feedback.record';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.execution.feedback.correct';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.execution.supplement.submit';
ALTER TYPE "permission_action" ADD VALUE IF NOT EXISTS 'case.execution.supplement.correct';
ALTER TYPE "material_category" ADD VALUE IF NOT EXISTS 'EXECUTION_SUPPLEMENT';

BEGIN;
-- CreateEnum
CREATE TYPE "case_execution_filing_followup_command" AS ENUM ('FEEDBACK_RECORD', 'FEEDBACK_CORRECT', 'SUPPLEMENT_SUBMIT', 'SUPPLEMENT_CORRECT');





-- AlterTable
ALTER TABLE "upload_drafts" ADD COLUMN     "execution_supplement_filing_id" UUID,
ADD COLUMN     "execution_supplement_revision" INTEGER,
ADD COLUMN     "execution_supplement_target_id" UUID;

-- AlterTable
ALTER TABLE "content_versions" ADD COLUMN     "execution_supplement_upload_draft_id" UUID;

-- CreateTable
CREATE TABLE "case_execution_filing_feedbacks" (
    "id" UUID NOT NULL,
    "feedback_id" UUID NOT NULL,
    "prior_version_id" UUID,
    "filing_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "from_revision" INTEGER NOT NULL,
    "to_revision" INTEGER NOT NULL,
    "feedback_on" DATE,
    "court_case_no" VARCHAR(100),
    "content" VARCHAR(2000) NOT NULL,
    "correction_reason" VARCHAR(500),
    "actor_type" "user_account_type" NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "internal_actor_user_id" UUID,
    "lawyer_account_binding_id" UUID,
    "audit_event_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_execution_filing_feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_execution_filing_supplements" (
    "id" UUID NOT NULL,
    "supplement_id" UUID NOT NULL,
    "prior_version_id" UUID,
    "filing_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "from_revision" INTEGER NOT NULL,
    "to_revision" INTEGER NOT NULL,
    "submitted_on" DATE,
    "note" VARCHAR(2000),
    "correction_reason" VARCHAR(500),
    "actor_type" "user_account_type" NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "internal_actor_user_id" UUID,
    "lawyer_account_binding_id" UUID,
    "audit_event_id" UUID NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_execution_filing_supplements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_execution_filing_supplement_documents" (
    "version_id" UUID NOT NULL,
    "supplement_id" UUID NOT NULL,
    "filing_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "content_version_id" UUID NOT NULL,

    CONSTRAINT "case_execution_filing_supplement_documents_pkey" PRIMARY KEY ("version_id","content_version_id")
);

-- CreateTable
CREATE TABLE "case_execution_filing_followup_receipts" (
    "id" UUID NOT NULL,
    "command" "case_execution_filing_followup_command" NOT NULL,
    "filing_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "request_fingerprint" CHAR(64) NOT NULL,
    "feedback_version_id" UUID,
    "supplement_version_id" UUID,
    "result_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_execution_filing_followup_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "case_execution_filing_feedbacks_audit_event_id_key" ON "case_execution_filing_feedbacks"("audit_event_id");

-- CreateIndex
CREATE INDEX "case_execution_filing_feedbacks_case_id_department_id_recor_idx" ON "case_execution_filing_feedbacks"("case_id", "department_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "case_execution_filing_feedbacks_id_filing_id_case_id_depart_key" ON "case_execution_filing_feedbacks"("id", "filing_id", "case_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "ef_feedback_version_scope_key" ON "case_execution_filing_feedbacks"("id", "feedback_id", "filing_id", "case_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "ef_feedback_prior_scope_key" ON "case_execution_filing_feedbacks"("prior_version_id", "feedback_id", "filing_id", "case_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_execution_filing_feedbacks_feedback_id_to_revision_key" ON "case_execution_filing_feedbacks"("feedback_id", "to_revision");

-- CreateIndex
CREATE UNIQUE INDEX "case_execution_filing_supplements_audit_event_id_key" ON "case_execution_filing_supplements"("audit_event_id");

-- CreateIndex
CREATE INDEX "case_execution_filing_supplements_case_id_department_id_rec_idx" ON "case_execution_filing_supplements"("case_id", "department_id", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "case_execution_filing_supplements_id_filing_id_case_id_depa_key" ON "case_execution_filing_supplements"("id", "filing_id", "case_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "ef_supplement_version_scope_key" ON "case_execution_filing_supplements"("id", "supplement_id", "filing_id", "case_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "ef_supplement_prior_scope_key" ON "case_execution_filing_supplements"("prior_version_id", "supplement_id", "filing_id", "case_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_execution_filing_supplements_supplement_id_to_revision_key" ON "case_execution_filing_supplements"("supplement_id", "to_revision");

-- CreateIndex
CREATE UNIQUE INDEX "case_execution_filing_supplement_documents_version_id_mater_key" ON "case_execution_filing_supplement_documents"("version_id", "material_id");

-- CreateIndex
CREATE UNIQUE INDEX "case_execution_filing_followup_receipts_department_id_actor_key" ON "case_execution_filing_followup_receipts"("department_id", "actor_user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "content_versions_execution_supplement_upload_draft_id_key" ON "content_versions"("execution_supplement_upload_draft_id");

-- AddForeignKey
ALTER TABLE "case_execution_filing_feedbacks" ADD CONSTRAINT "case_execution_filing_feedbacks_filing_id_case_id_departme_fkey" FOREIGN KEY ("filing_id", "case_id", "department_id") REFERENCES "case_execution_filings"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_feedbacks" ADD CONSTRAINT "case_execution_filing_feedbacks_case_id_department_id_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_feedbacks" ADD CONSTRAINT "case_execution_filing_feedbacks_feedback_id_filing_id_case_fkey" FOREIGN KEY ("feedback_id", "filing_id", "case_id", "department_id") REFERENCES "case_execution_filing_feedbacks"("id", "filing_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_feedbacks" ADD CONSTRAINT "case_execution_filing_feedbacks_prior_version_id_feedback__fkey" FOREIGN KEY ("prior_version_id", "feedback_id", "filing_id", "case_id", "department_id") REFERENCES "case_execution_filing_feedbacks"("id", "feedback_id", "filing_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_feedbacks" ADD CONSTRAINT "case_execution_filing_feedbacks_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_feedbacks" ADD CONSTRAINT "case_execution_filing_feedbacks_internal_actor_user_id_dep_fkey" FOREIGN KEY ("internal_actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_feedbacks" ADD CONSTRAINT "case_execution_filing_feedbacks_lawyer_account_binding_id__fkey" FOREIGN KEY ("lawyer_account_binding_id", "recorded_by_user_id", "department_id") REFERENCES "lawyer_account_bindings"("id", "user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_feedbacks" ADD CONSTRAINT "case_execution_filing_feedbacks_audit_event_id_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_supplements" ADD CONSTRAINT "case_execution_filing_supplements_filing_id_case_id_depart_fkey" FOREIGN KEY ("filing_id", "case_id", "department_id") REFERENCES "case_execution_filings"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_supplements" ADD CONSTRAINT "case_execution_filing_supplements_case_id_department_id_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_supplements" ADD CONSTRAINT "case_execution_filing_supplements_supplement_id_filing_id__fkey" FOREIGN KEY ("supplement_id", "filing_id", "case_id", "department_id") REFERENCES "case_execution_filing_supplements"("id", "filing_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_supplements" ADD CONSTRAINT "case_execution_filing_supplements_prior_version_id_supplem_fkey" FOREIGN KEY ("prior_version_id", "supplement_id", "filing_id", "case_id", "department_id") REFERENCES "case_execution_filing_supplements"("id", "supplement_id", "filing_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_supplements" ADD CONSTRAINT "case_execution_filing_supplements_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_supplements" ADD CONSTRAINT "case_execution_filing_supplements_internal_actor_user_id_d_fkey" FOREIGN KEY ("internal_actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_supplements" ADD CONSTRAINT "case_execution_filing_supplements_lawyer_account_binding_i_fkey" FOREIGN KEY ("lawyer_account_binding_id", "recorded_by_user_id", "department_id") REFERENCES "lawyer_account_bindings"("id", "user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_supplements" ADD CONSTRAINT "case_execution_filing_supplements_audit_event_id_fkey" FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_supplement_documents" ADD CONSTRAINT "case_execution_filing_supplement_documents_version_id_supp_fkey" FOREIGN KEY ("version_id", "supplement_id", "filing_id", "case_id", "department_id") REFERENCES "case_execution_filing_supplements"("id", "supplement_id", "filing_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_supplement_documents" ADD CONSTRAINT "case_execution_filing_supplement_documents_material_id_dep_fkey" FOREIGN KEY ("material_id", "department_id") REFERENCES "materials"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_supplement_documents" ADD CONSTRAINT "case_execution_filing_supplement_documents_material_id_con_fkey" FOREIGN KEY ("material_id", "content_version_id") REFERENCES "content_versions"("material_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_followup_receipts" ADD CONSTRAINT "case_execution_filing_followup_receipts_case_id_department_fkey" FOREIGN KEY ("case_id", "department_id") REFERENCES "cases"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_followup_receipts" ADD CONSTRAINT "case_execution_filing_followup_receipts_filing_id_case_id__fkey" FOREIGN KEY ("filing_id", "case_id", "department_id") REFERENCES "case_execution_filings"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_followup_receipts" ADD CONSTRAINT "case_execution_filing_followup_receipts_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_followup_receipts" ADD CONSTRAINT "case_execution_filing_followup_receipts_feedback_version_i_fkey" FOREIGN KEY ("feedback_version_id", "filing_id", "case_id", "department_id") REFERENCES "case_execution_filing_feedbacks"("id", "filing_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "case_execution_filing_followup_receipts" ADD CONSTRAINT "case_execution_filing_followup_receipts_supplement_version_fkey" FOREIGN KEY ("supplement_version_id", "filing_id", "case_id", "department_id") REFERENCES "case_execution_filing_supplements"("id", "filing_id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "upload_drafts" ADD CONSTRAINT "upload_drafts_execution_supplement_filing_id_owner_id_depa_fkey" FOREIGN KEY ("execution_supplement_filing_id", "owner_id", "department_id") REFERENCES "case_execution_filings"("id", "case_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_execution_supplement_upload_draft_id_fkey" FOREIGN KEY ("execution_supplement_upload_draft_id") REFERENCES "upload_drafts"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "case_execution_filing_feedbacks"
  ADD CONSTRAINT "ef_feedback_revision_shape" CHECK (
    "from_revision">=0 AND "to_revision">0 AND "to_revision"::bigint="from_revision"::bigint+1 AND
    (("from_revision"=0 AND "id"="feedback_id" AND "prior_version_id" IS NULL AND "correction_reason" IS NULL) OR
     ("from_revision">0 AND "id"<>"feedback_id" AND "prior_version_id" IS NOT NULL AND "correction_reason" IS NOT NULL AND length(btrim("correction_reason")) BETWEEN 1 AND 500 AND "correction_reason"=btrim("correction_reason")))),
  ADD CONSTRAINT "ef_feedback_payload_shape" CHECK (
    ("feedback_on" IS NULL OR isfinite("feedback_on")) AND
    length(btrim("content")) BETWEEN 1 AND 2000 AND "content"=btrim("content") AND
    ("court_case_no" IS NULL OR (length(btrim("court_case_no")) BETWEEN 1 AND 100 AND "court_case_no"=btrim("court_case_no")))),
  ADD CONSTRAINT "ef_feedback_actor_shape" CHECK (
    ("actor_type"='INTERNAL' AND "internal_actor_user_id" IS NOT DISTINCT FROM "recorded_by_user_id" AND "lawyer_account_binding_id" IS NULL) OR
    ("actor_type"='LAWYER' AND "internal_actor_user_id" IS NULL AND "lawyer_account_binding_id" IS NOT NULL));
ALTER TABLE "case_execution_filing_supplements"
  ADD CONSTRAINT "ef_supplement_revision_shape" CHECK (
    "from_revision">=0 AND "to_revision">0 AND "to_revision"::bigint="from_revision"::bigint+1 AND
    (("from_revision"=0 AND "id"="supplement_id" AND "prior_version_id" IS NULL AND "correction_reason" IS NULL) OR
     ("from_revision">0 AND "id"<>"supplement_id" AND "prior_version_id" IS NOT NULL AND "correction_reason" IS NOT NULL AND length(btrim("correction_reason")) BETWEEN 1 AND 500 AND "correction_reason"=btrim("correction_reason")))),
  ADD CONSTRAINT "ef_supplement_payload_shape" CHECK (
    ("submitted_on" IS NULL OR isfinite("submitted_on")) AND
    ("note" IS NULL OR (length(btrim("note")) BETWEEN 1 AND 2000 AND "note"=btrim("note")))),
  ADD CONSTRAINT "ef_supplement_actor_shape" CHECK (
    ("actor_type"='INTERNAL' AND "internal_actor_user_id" IS NOT DISTINCT FROM "recorded_by_user_id" AND "lawyer_account_binding_id" IS NULL) OR
    ("actor_type"='LAWYER' AND "internal_actor_user_id" IS NULL AND "lawyer_account_binding_id" IS NOT NULL));
ALTER TABLE "case_execution_filing_followup_receipts"
  ADD CONSTRAINT "ef_receipt_command_shape" CHECK (
    ("command" IN ('FEEDBACK_RECORD','FEEDBACK_CORRECT') AND "feedback_version_id" IS NOT NULL AND "supplement_version_id" IS NULL) OR
    ("command" IN ('SUPPLEMENT_SUBMIT','SUPPLEMENT_CORRECT') AND "supplement_version_id" IS NOT NULL AND "feedback_version_id" IS NULL)),
  ADD CONSTRAINT "ef_receipt_key_shape" CHECK (length(btrim("idempotency_key")) BETWEEN 1 AND 128 AND "idempotency_key"=btrim("idempotency_key") AND "request_fingerprint" ~ '^[0-9a-f]{64}$');
CREATE UNIQUE INDEX "ef_feedback_receipt_version_key" ON "case_execution_filing_followup_receipts"("feedback_version_id");
CREATE UNIQUE INDEX "ef_supplement_receipt_version_key" ON "case_execution_filing_followup_receipts"("supplement_version_id");

ALTER TABLE "upload_drafts" ADD CONSTRAINT "execution_supplement_draft_shape" CHECK (
  ("execution_supplement_filing_id" IS NULL AND "execution_supplement_target_id" IS NULL AND "execution_supplement_revision" IS NULL AND "category"<>'EXECUTION_SUPPLEMENT') OR
  ("execution_supplement_filing_id" IS NOT NULL AND "execution_supplement_target_id" IS NOT NULL AND "execution_supplement_revision" IS NOT NULL AND "execution_supplement_revision">=0 AND
   "owner_type"='CASE' AND "category"='EXECUTION_SUPPLEMENT' AND "purpose"='EXECUTION_SUPPLEMENT' AND
   "case_section_record_command" IS NULL AND "case_section_record_target_id" IS NULL AND "case_section_record_revision" IS NULL AND
   "case_section_record_trial_round_id" IS NULL AND "case_section_record_closure_version_id" IS NULL AND
   "customer_account_binding_id" IS NULL AND "notary_office_account_binding_id" IS NULL AND
   (("internal_actor_user_id" IS NOT DISTINCT FROM "actor_user_id" AND "lawyer_account_binding_id" IS NULL) OR
    ("internal_actor_user_id" IS NULL AND "lawyer_account_binding_id" IS NOT NULL))));
ALTER TABLE "content_versions" ADD CONSTRAINT "execution_supplement_content_context_exclusive" CHECK (
  "execution_supplement_upload_draft_id" IS NULL OR "case_section_record_upload_draft_id" IS NULL);

-- This function checks the current action/scope or the current PRIMARY lawyer;
-- a historic actor/audit is provenance, never an authorization token.
CREATE FUNCTION "execution_filing_followup_actor_authorized"(p_actor uuid,p_case uuid,p_department uuid,p_action permission_action,p_internal uuid,p_lawyer_binding uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT (p_internal=p_actor AND p_lawyer_binding IS NULL AND case_record_edit_actor_authorized(p_actor,p_case,p_department,p_action)) OR
    (p_internal IS NULL AND p_lawyer_binding IS NOT NULL AND EXISTS (
      SELECT 1 FROM lawyer_account_bindings b JOIN user_accounts u ON u.id=b.user_id AND u.active AND u.account_type='LAWYER'
      JOIN case_lawyer_assignments a ON a.lawyer_id=b.profile_id AND a.department_id=b.department_id
      WHERE b.id=p_lawyer_binding AND b.user_id=p_actor AND b.department_id=p_department AND b.active
        AND a.case_id=p_case AND a.role='PRIMARY' AND a.ended_at IS NULL));
$$;

CREATE FUNCTION "check_execution_filing_followup_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_root uuid; p_head record; p_action permission_action; p_case cases%ROWTYPE;
BEGIN
  p_root := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
  SELECT * INTO p_case FROM cases WHERE id=NEW.case_id AND department_id=NEW.department_id FOR UPDATE;
  IF p_case.id IS NULL OR p_case.stage<>'EXECUTING' OR NOT EXISTS (
    SELECT 1 FROM case_execution_filings f WHERE f.id=NEW.filing_id AND f.case_id=NEW.case_id AND f.department_id=NEW.department_id)
  THEN RAISE EXCEPTION 'followup requires an executing case and exact real filing' USING ERRCODE='23514'; END IF;
  p_action := (CASE WHEN TG_TABLE_NAME='case_execution_filing_feedbacks' THEN
    CASE WHEN NEW.from_revision=0 THEN 'case.execution.feedback.record' ELSE 'case.execution.feedback.correct' END
    ELSE CASE WHEN NEW.from_revision=0 THEN 'case.execution.supplement.submit' ELSE 'case.execution.supplement.correct' END END)::permission_action;
  IF NOT coalesce(execution_filing_followup_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,p_action,NEW.internal_actor_user_id,NEW.lawyer_account_binding_id),false) THEN
    RAISE EXCEPTION 'followup current operator or scope invalid' USING ERRCODE='23514'; END IF;
  -- Global target namespace: a missing row in one case does not reserve a foreign UUID.
  PERFORM pg_advisory_xact_lock(hashtextextended('execution-filing-followup-target:'||p_root::text,0));
  IF NEW.id<>p_root THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('execution-filing-followup-target:'||NEW.id::text,0));
  END IF;
  IF EXISTS(SELECT 1 FROM case_execution_filing_feedbacks f WHERE f.id=NEW.id) OR
     EXISTS(SELECT 1 FROM case_execution_filing_supplements s WHERE s.id=NEW.id) OR
     (NEW.id<>p_root AND EXISTS(SELECT 1 FROM upload_drafts d WHERE d.execution_supplement_target_id=NEW.id)) THEN
    RAISE EXCEPTION 'followup version UUID already used' USING ERRCODE='23514'; END IF;
  IF NEW.from_revision=0 THEN
    IF EXISTS(SELECT 1 FROM case_execution_filing_feedbacks f WHERE f.id=p_root OR f.feedback_id=p_root) OR
       EXISTS(SELECT 1 FROM case_execution_filing_supplements s WHERE s.id=p_root OR s.supplement_id=p_root) OR
       EXISTS(SELECT 1 FROM upload_drafts d WHERE d.execution_supplement_target_id=p_root AND
         (TG_TABLE_NAME<>'case_execution_filing_supplements' OR
          d.execution_supplement_revision<>0 OR
          (d.owner_id,d.department_id,d.execution_supplement_filing_id,d.actor_user_id)
          IS DISTINCT FROM (NEW.case_id,NEW.department_id,NEW.filing_id,NEW.recorded_by_user_id))) THEN
      RAISE EXCEPTION 'followup root UUID belongs to another immutable target or actor' USING ERRCODE='23514'; END IF;
  ELSE
    EXECUTE format('SELECT id,filing_id,case_id,department_id,to_revision FROM %I WHERE %I=$1 ORDER BY to_revision DESC LIMIT 1',TG_TABLE_NAME,TG_ARGV[0]) INTO p_head USING p_root;
    IF p_head.id IS NULL OR (p_head.filing_id,p_head.case_id,p_head.department_id,p_head.to_revision,p_head.id)
      IS DISTINCT FROM (NEW.filing_id,NEW.case_id,NEW.department_id,NEW.from_revision,NEW.prior_version_id) THEN
      RAISE EXCEPTION 'followup target or exact head revision changed' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ef_feedback_version_guard" BEFORE INSERT ON case_execution_filing_feedbacks FOR EACH ROW EXECUTE FUNCTION check_execution_filing_followup_version('feedback_id');
CREATE TRIGGER "ef_supplement_version_guard" BEFORE INSERT ON case_execution_filing_supplements FOR EACH ROW EXECUTE FUNCTION check_execution_filing_followup_version('supplement_id');

CREATE FUNCTION "reject_execution_filing_followup_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'execution filing followup history is immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER "ef_feedback_immutable" BEFORE UPDATE OR DELETE ON case_execution_filing_feedbacks FOR EACH ROW EXECUTE FUNCTION reject_execution_filing_followup_mutation();
CREATE TRIGGER "ef_supplement_immutable" BEFORE UPDATE OR DELETE ON case_execution_filing_supplements FOR EACH ROW EXECUTE FUNCTION reject_execution_filing_followup_mutation();
CREATE TRIGGER "ef_document_immutable" BEFORE UPDATE OR DELETE ON case_execution_filing_supplement_documents FOR EACH ROW EXECUTE FUNCTION reject_execution_filing_followup_mutation();
CREATE TRIGGER "ef_receipt_immutable" BEFORE UPDATE OR DELETE ON case_execution_filing_followup_receipts FOR EACH ROW EXECUTE FUNCTION reject_execution_filing_followup_mutation();

CREATE FUNCTION "execution_filing_followup_values"(p_kind text,p_version uuid) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE p_values jsonb;
BEGIN
  IF p_kind='FEEDBACK' THEN
    SELECT jsonb_build_object('feedbackOn',f.feedback_on,'courtCaseNo',f.court_case_no,'content',f.content)
      INTO p_values FROM case_execution_filing_feedbacks f WHERE f.id=p_version;
  ELSIF p_kind='SUPPLEMENT' THEN
    SELECT jsonb_build_object('submittedOn',s.submitted_on,'note',s.note,'contentVersionIds',
      (SELECT coalesce(jsonb_agg(d.content_version_id ORDER BY d.content_version_id),'[]'::jsonb)
        FROM case_execution_filing_supplement_documents d WHERE d.version_id=s.id))
      INTO p_values FROM case_execution_filing_supplements s WHERE s.id=p_version;
  ELSE RAISE EXCEPTION 'unknown execution followup kind' USING ERRCODE='23514'; END IF;
  RETURN p_values;
END; $$;

CREATE FUNCTION "assert_execution_supplement_upload_target"(p_actor uuid,p_case uuid,p_department uuid,p_filing uuid,p_target uuid,p_revision integer,p_internal uuid,p_binding uuid,p_delete_preparation boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE p_action permission_action; p_head case_execution_filing_supplements%ROWTYPE;
BEGIN
  PERFORM 1 FROM cases c WHERE c.id=p_case AND c.department_id=p_department AND c.stage='EXECUTING' FOR UPDATE;
  IF NOT FOUND OR p_revision IS NULL OR p_revision<0 OR NOT EXISTS (
    SELECT 1 FROM case_execution_filings f WHERE f.id=p_filing AND f.case_id=p_case AND f.department_id=p_department) THEN
    RAISE EXCEPTION 'supplement upload requires exact real executing filing' USING ERRCODE='23514'; END IF;
  p_action := (CASE WHEN p_revision=0 THEN 'case.execution.supplement.submit' ELSE 'case.execution.supplement.correct' END)::permission_action;
  IF NOT coalesce(execution_filing_followup_actor_authorized(p_actor,p_case,p_department,p_action,p_internal,p_binding),false) THEN
    RAISE EXCEPTION 'supplement upload current actor or action scope invalid' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('execution-filing-followup-target:'||p_target::text,0));
  SELECT * INTO p_head FROM case_execution_filing_supplements s WHERE s.supplement_id=p_target ORDER BY s.to_revision DESC LIMIT 1;
  IF p_revision=0 AND NOT (p_delete_preparation AND p_head.id IS NOT NULL) THEN
    IF EXISTS(SELECT 1 FROM case_execution_filing_feedbacks f WHERE f.id=p_target OR f.feedback_id=p_target) OR
       EXISTS(SELECT 1 FROM case_execution_filing_supplements s WHERE s.id=p_target OR s.supplement_id=p_target) OR
       EXISTS(SELECT 1 FROM upload_drafts u WHERE u.execution_supplement_target_id=p_target AND
         (u.execution_supplement_revision<>0 OR
          (u.owner_id,u.department_id,u.execution_supplement_filing_id,u.actor_user_id) IS DISTINCT FROM (p_case,p_department,p_filing,p_actor))) THEN
      RAISE EXCEPTION 'new supplement target UUID is already owned elsewhere' USING ERRCODE='23514'; END IF;
  ELSE
    IF NOT EXISTS(SELECT 1 FROM case_execution_filing_supplements s WHERE s.id=p_target AND s.supplement_id=p_target
      AND s.filing_id=p_filing AND s.case_id=p_case AND s.department_id=p_department AND s.from_revision=0 AND s.to_revision=1) THEN
      RAISE EXCEPTION 'supplement upload target is not a real initial root' USING ERRCODE='23514'; END IF;
    IF p_head.id IS NULL OR (p_head.filing_id,p_head.case_id,p_head.department_id) IS DISTINCT FROM (p_filing,p_case,p_department) OR
      (p_delete_preparation AND p_head.to_revision<p_revision) OR (NOT p_delete_preparation AND p_head.to_revision<>p_revision) THEN
      RAISE EXCEPTION 'supplement upload target head revision changed' USING ERRCODE='23514'; END IF;
  END IF;
END; $$;

CREATE FUNCTION "guard_execution_supplement_draft"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_check boolean := TG_OP='INSERT';
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.execution_supplement_target_id IS NOT NULL THEN RAISE EXCEPTION 'supplement draft provenance is immutable' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.execution_supplement_target_id IS NULL AND NEW.execution_supplement_target_id IS NOT NULL THEN
      RAISE EXCEPTION 'ordinary draft cannot acquire supplement authorization' USING ERRCODE='23514'; END IF;
    IF OLD.execution_supplement_target_id IS NOT NULL THEN
      IF (to_jsonb(NEW)-'status'-'pending_storage_key'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'pending_storage_key'-'updated_at') THEN
        RAISE EXCEPTION 'supplement draft metadata and anchors are immutable' USING ERRCODE='23514'; END IF;
      IF OLD.status='OPEN' THEN
        IF NEW.status='OPEN' THEN
          IF OLD.pending_storage_key IS NULL AND NEW.pending_storage_key IS NOT NULL THEN p_check:=true;
          ELSIF OLD.pending_storage_key IS NOT NULL AND NEW.pending_storage_key IS NOT NULL AND OLD.pending_storage_key IS DISTINCT FROM NEW.pending_storage_key THEN
            RAISE EXCEPTION 'supplement claim cannot be rebound' USING ERRCODE='23514'; END IF;
        ELSIF NEW.status='FINALIZED' THEN
          IF OLD.pending_storage_key IS NULL OR NEW.pending_storage_key IS NOT NULL THEN RAISE EXCEPTION 'supplement finalization requires exact claimed key' USING ERRCODE='23514'; END IF;
          p_check:=true;
        ELSIF NEW.status='EXPIRED' AND NEW.pending_storage_key IS NOT NULL AND NEW.pending_storage_key IS DISTINCT FROM OLD.pending_storage_key THEN
          RAISE EXCEPTION 'supplement expiry cannot change claim' USING ERRCODE='23514';
        END IF;
      ELSIF NEW.status IS DISTINCT FROM OLD.status OR (OLD.status='FINALIZED' AND NEW.pending_storage_key IS NOT NULL) OR
        (OLD.status='EXPIRED' AND NEW.pending_storage_key IS NOT NULL AND NEW.pending_storage_key IS DISTINCT FROM OLD.pending_storage_key) THEN
        RAISE EXCEPTION 'supplement terminal draft cannot reopen' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF NEW.execution_supplement_target_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' AND (NEW.status<>'OPEN' OR NEW.pending_storage_key IS NOT NULL) THEN
    RAISE EXCEPTION 'supplement upload must begin unclaimed and OPEN' USING ERRCODE='23514'; END IF;
  IF p_check THEN
    PERFORM assert_execution_supplement_upload_target(NEW.actor_user_id,NEW.owner_id,NEW.department_id,
      NEW.execution_supplement_filing_id,NEW.execution_supplement_target_id,NEW.execution_supplement_revision,NEW.internal_actor_user_id,NEW.lawyer_account_binding_id);
    IF NEW.expires_at<=CURRENT_TIMESTAMP OR NEW.expires_at>NEW.created_at+interval '24 hours' THEN
      RAISE EXCEPTION 'supplement draft expired or beyond the existing 24 hour window' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ef_upload_draft_guard" BEFORE INSERT OR UPDATE OR DELETE ON upload_drafts FOR EACH ROW EXECUTE FUNCTION guard_execution_supplement_draft();

-- Narrowly extend the existing lawyer actor catalog; no old stage/action arm is replaced.
DO $migration$
DECLARE p_definition text; p_needle text; p_replacement text; p_pair text[];
  p_pairs text[][] := ARRAY[
    ARRAY['''CASE_CLOSURE_DOCUMENT'') OR NEW."purpose" <> NEW."category"::text',
      '''CASE_CLOSURE_DOCUMENT'',''EXECUTION_SUPPLEMENT'') OR NEW."purpose" <> NEW."category"::text'],
    ARRAY['WHEN NEW."category" = ''CASE_CLOSURE_DOCUMENT'' THEN ''WAITING_ARCHIVE''',
      'WHEN NEW."category" = ''CASE_CLOSURE_DOCUMENT'' THEN ''WAITING_ARCHIVE'' WHEN NEW."category" = ''EXECUTION_SUPPLEMENT'' THEN ''EXECUTING'''],
    ARRAY['WHEN ''case.archive.corrected'' THEN ''ARCHIVED''',
      'WHEN ''case.archive.corrected'' THEN ''ARCHIVED'' WHEN ''case.execution.feedback.recorded'' THEN ''EXECUTING'' WHEN ''case.execution.feedback.corrected'' THEN ''EXECUTING'' WHEN ''case.execution.supplement.submitted'' THEN ''EXECUTING'' WHEN ''case.execution.supplement.corrected'' THEN ''EXECUTING''']
  ];
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO p_definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname=current_schema() AND p.proname='enforce_case_client_mailing_actor_path' AND p.pronargs=0 AND p.prorettype='trigger'::regtype;
  IF p_definition IS NULL THEN RAISE EXCEPTION 'missing existing lawyer actor path' USING ERRCODE='23514'; END IF;
  FOREACH p_pair SLICE 1 IN ARRAY p_pairs LOOP
    p_needle:=p_pair[1]; p_replacement:=p_pair[2];
    IF length(p_definition)-length(replace(p_definition,p_needle,''))<>length(p_needle) THEN
      RAISE EXCEPTION 'unknown existing lawyer actor path literal' USING ERRCODE='23514'; END IF;
    p_definition:=replace(p_definition,p_needle,p_replacement);
  END LOOP;
  EXECUTE p_definition;
END; $migration$;
CREATE FUNCTION "check_execution_filing_followup_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_kind text := TG_ARGV[0]; p_root_name text; p_root uuid; p_command case_execution_filing_followup_command;
  p_action text; p_permission permission_action; p_before jsonb; p_after jsonb; p_details jsonb; p_result jsonb;
  p_audit audit_events%ROWTYPE; p_receipt case_execution_filing_followup_receipts%ROWTYPE;
BEGIN
  PERFORM 1 FROM cases c WHERE c.id=NEW.case_id AND c.department_id=NEW.department_id AND c.stage='EXECUTING' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'followup cannot change the workflow stage during commit' USING ERRCODE='23514'; END IF;
  IF p_kind='FEEDBACK' THEN
    p_root_name := 'feedbackId'; p_root := NEW.feedback_id;
    p_command := CASE WHEN NEW.from_revision=0 THEN 'FEEDBACK_RECORD' ELSE 'FEEDBACK_CORRECT' END;
    p_action := CASE WHEN NEW.from_revision=0 THEN 'case.execution.feedback.recorded' ELSE 'case.execution.feedback.corrected' END;
    p_permission := (CASE WHEN NEW.from_revision=0 THEN 'case.execution.feedback.record' ELSE 'case.execution.feedback.correct' END)::permission_action;
  ELSE
    p_root_name := 'supplementId'; p_root := NEW.supplement_id;
    p_command := CASE WHEN NEW.from_revision=0 THEN 'SUPPLEMENT_SUBMIT' ELSE 'SUPPLEMENT_CORRECT' END;
    p_action := CASE WHEN NEW.from_revision=0 THEN 'case.execution.supplement.submitted' ELSE 'case.execution.supplement.corrected' END;
    p_permission := (CASE WHEN NEW.from_revision=0 THEN 'case.execution.supplement.submit' ELSE 'case.execution.supplement.correct' END)::permission_action;
  END IF;
  IF NOT coalesce(execution_filing_followup_actor_authorized(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,p_permission,NEW.internal_actor_user_id,NEW.lawyer_account_binding_id),false) THEN
    RAISE EXCEPTION 'followup operator revoked before commit' USING ERRCODE='23514'; END IF;
  p_before := CASE WHEN NEW.from_revision=0 THEN 'null'::jsonb ELSE execution_filing_followup_values(p_kind,NEW.prior_version_id) END;
  p_after := execution_filing_followup_values(p_kind,NEW.id);
  IF p_after IS NULL OR (NEW.from_revision>0 AND p_before IS NULL) THEN
    RAISE EXCEPTION 'followup lacks exact version payload' USING ERRCODE='23514'; END IF;
  IF NEW.from_revision>0 AND p_before=p_after THEN
    RAISE EXCEPTION 'followup correction has no business change' USING ERRCODE='23514'; END IF;
  IF p_kind='SUPPLEMENT' AND jsonb_array_length(p_after->'contentVersionIds') NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'supplement requires one to ten precise files' USING ERRCODE='23514'; END IF;
  p_details := jsonb_build_object('versionId',NEW.id,'filingId',NEW.filing_id,p_root_name,p_root,
    'fromRevision',NEW.from_revision,'toRevision',NEW.to_revision,'correctionReason',NEW.correction_reason,
    'before',p_before,'after',p_after);
  SELECT * INTO p_audit FROM audit_events a WHERE a.id=NEW.audit_event_id AND a.xmin=pg_current_xact_id()::text::xid;
  IF p_audit.id IS NULL OR
    (p_audit.department_id,p_audit.actor_kind,p_audit.actor_user_id,p_audit.internal_actor_user_id,p_audit.lawyer_account_binding_id,p_audit.resource_type,p_audit.resource_id,p_audit.action)
    IS DISTINCT FROM (NEW.department_id,'HUMAN'::audit_actor_kind,NEW.recorded_by_user_id,NEW.internal_actor_user_id,NEW.lawyer_account_binding_id,'CASE',NEW.case_id,p_action)
    OR p_audit.customer_account_binding_id IS NOT NULL OR p_audit.notary_office_account_binding_id IS NOT NULL
    OR p_audit.details IS DISTINCT FROM p_details THEN
    RAISE EXCEPTION 'followup audit must retain exact before and after facts in this transaction' USING ERRCODE='23514'; END IF;
  SELECT * INTO p_receipt FROM case_execution_filing_followup_receipts r
    WHERE r.command=p_command AND r.case_id=NEW.case_id AND r.department_id=NEW.department_id
      AND r.filing_id=NEW.filing_id AND r.actor_user_id=NEW.recorded_by_user_id
      AND (CASE WHEN p_kind='FEEDBACK' THEN r.feedback_version_id ELSE r.supplement_version_id END)=NEW.id
      AND r.xmin=pg_current_xact_id()::text::xid;
  p_result := jsonb_build_object('id',NEW.id,'filingId',NEW.filing_id,p_root_name,p_root,'revision',NEW.to_revision,
    'recordedAt',to_char(NEW.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  IF p_receipt.id IS NULL OR p_receipt.result_snapshot IS DISTINCT FROM p_result THEN
    RAISE EXCEPTION 'followup receipt must retain its original exact typed result' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "ef_feedback_final" AFTER INSERT ON case_execution_filing_feedbacks
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_execution_filing_followup_final('FEEDBACK');
CREATE CONSTRAINT TRIGGER "ef_supplement_final" AFTER INSERT ON case_execution_filing_supplements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_execution_filing_followup_final('SUPPLEMENT');

-- A transaction cannot hide a workflow version/stage change alongside a new
-- followup, regardless of whether it updates the case before or after the fact.
CREATE FUNCTION "check_execution_followup_case_final"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.stage,NEW.version) IS DISTINCT FROM (OLD.stage,OLD.version) AND (
    EXISTS(SELECT 1 FROM case_execution_filing_feedbacks f WHERE f.case_id=NEW.id AND f.department_id=NEW.department_id AND f.xmin=pg_current_xact_id()::text::xid) OR
    EXISTS(SELECT 1 FROM case_execution_filing_supplements s WHERE s.case_id=NEW.id AND s.department_id=NEW.department_id AND s.xmin=pg_current_xact_id()::text::xid)) THEN
    RAISE EXCEPTION 'execution filing followup cannot change workflow version or stage' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "ef_case_final" AFTER UPDATE ON cases
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_execution_followup_case_final();

CREATE FUNCTION "check_execution_supplement_document"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_version case_execution_filing_supplements%ROWTYPE;
BEGIN
  SELECT * INTO p_version FROM case_execution_filing_supplements s WHERE s.id=NEW.version_id
    AND s.supplement_id=NEW.supplement_id AND s.filing_id=NEW.filing_id AND s.case_id=NEW.case_id
    AND s.department_id=NEW.department_id AND s.xmin=pg_current_xact_id()::text::xid;
  IF p_version.id IS NULL THEN
    RAISE EXCEPTION 'supplement document requires its same-transaction exact version' USING ERRCODE='23514'; END IF;
  PERFORM 1 FROM materials m JOIN content_versions v ON v.material_id=m.id
    WHERE m.id=NEW.material_id AND v.id=NEW.content_version_id AND m.owner_type='CASE'
      AND m.owner_id=NEW.case_id AND m.department_id=NEW.department_id AND m.category='EXECUTION_SUPPLEMENT'
      AND m.purpose='EXECUTION_SUPPLEMENT' AND m.status='ACTIVE' AND m.deleted_at IS NULL
      AND v.status='AVAILABLE' AND v.mime_type IN ('application/pdf','image/jpeg','image/png')
      AND v.size_bytes BETWEEN 1 AND 52428800
      AND (m.current_version_id=v.id OR case_execution_supplement_upload_first_freeze_proof(v.id,true))
      FOR SHARE OF m,v;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplement document requires same-transaction version and exact available file' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ef_document_insert" BEFORE INSERT ON case_execution_filing_supplement_documents
  FOR EACH ROW EXECUTE FUNCTION check_execution_supplement_document();
CREATE FUNCTION "check_execution_supplement_document_final"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM case_execution_filing_supplements s JOIN material_references r
    ON r.action_event_id=s.audit_event_id AND r.material_id=NEW.material_id AND r.content_version_id=NEW.content_version_id
      AND r.department_id=NEW.department_id AND r.resource_type='case' AND r.resource_id=NEW.case_id
      AND r.purpose='EXECUTION_SUPPLEMENT' AND r.asset_version_id IS NULL
    WHERE s.id=NEW.version_id AND s.supplement_id=NEW.supplement_id AND s.filing_id=NEW.filing_id
      AND s.case_id=NEW.case_id AND s.department_id=NEW.department_id AND r.xmin=pg_current_xact_id()::text::xid) THEN
    RAISE EXCEPTION 'supplement document lacks exact immutable material reference' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "ef_document_final" AFTER INSERT ON case_execution_filing_supplement_documents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_execution_supplement_document_final();

CREATE FUNCTION "guard_execution_followup_audit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF OLD.action IN ('case.execution.feedback.recorded','case.execution.feedback.corrected','case.execution.supplement.submitted','case.execution.supplement.corrected') OR
      (TG_OP='UPDATE' AND NEW.action IN ('case.execution.feedback.recorded','case.execution.feedback.corrected','case.execution.supplement.submitted','case.execution.supplement.corrected')) THEN
      RAISE EXCEPTION 'execution followup audit is immutable' USING ERRCODE='23514'; END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ef_audit_immutable" BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION guard_execution_followup_audit();

CREATE FUNCTION "guard_execution_followup_reference"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_action text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF EXISTS(SELECT 1 FROM case_execution_filing_supplements s
      WHERE s.audit_event_id=OLD.action_event_id AND EXISTS(SELECT 1 FROM case_execution_filing_supplement_documents d
        WHERE d.version_id=s.id AND d.material_id=OLD.material_id AND d.content_version_id=OLD.content_version_id)) THEN
      RAISE EXCEPTION 'execution supplement reference is immutable' USING ERRCODE='23514'; END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  END IF;
  SELECT a.action INTO p_action FROM audit_events a WHERE a.id=NEW.action_event_id;
  IF p_action IN ('case.execution.supplement.submitted','case.execution.supplement.corrected') OR NEW.purpose='EXECUTION_SUPPLEMENT' THEN
    IF NOT EXISTS (SELECT 1 FROM case_execution_filing_supplements s
      JOIN case_execution_filing_supplement_documents d ON d.version_id=s.id
        AND d.supplement_id=s.supplement_id AND d.filing_id=s.filing_id AND d.case_id=s.case_id AND d.department_id=s.department_id
      WHERE s.audit_event_id=NEW.action_event_id AND s.case_id=NEW.resource_id AND s.department_id=NEW.department_id
        AND NEW.resource_type='case' AND NEW.purpose='EXECUTION_SUPPLEMENT' AND NEW.asset_version_id IS NULL
        AND d.material_id=NEW.material_id AND d.content_version_id=NEW.content_version_id
        AND s.xmin=pg_current_xact_id()::text::xid AND d.xmin=pg_current_xact_id()::text::xid) THEN
      RAISE EXCEPTION 'execution supplement reference lacks exact same-transaction document and audit' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "ef_reference_insert" AFTER INSERT OR UPDATE ON material_references
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_execution_followup_reference();
CREATE TRIGGER "ef_reference_immutable" BEFORE UPDATE OR DELETE ON material_references FOR EACH ROW EXECUTE FUNCTION guard_execution_followup_reference();

CREATE FUNCTION "check_execution_followup_link_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_version record; p_table text; p_id uuid;
BEGIN
  IF TG_TABLE_NAME='audit_events' THEN
    IF NEW.action NOT IN ('case.execution.feedback.recorded','case.execution.feedback.corrected','case.execution.supplement.submitted','case.execution.supplement.corrected') THEN RETURN NEW; END IF;
    IF NEW.action IN ('case.execution.feedback.recorded','case.execution.feedback.corrected') THEN p_table:='case_execution_filing_feedbacks';
    ELSE p_table:='case_execution_filing_supplements'; END IF;
    EXECUTE format('SELECT id FROM %I WHERE audit_event_id=$1 AND xmin=pg_current_xact_id()::text::xid',p_table) INTO p_version USING NEW.id;
  ELSE
    IF NEW.command IN ('FEEDBACK_RECORD','FEEDBACK_CORRECT') THEN p_table:='case_execution_filing_feedbacks'; p_id:=NEW.feedback_version_id;
    ELSE p_table:='case_execution_filing_supplements'; p_id:=NEW.supplement_version_id; END IF;
    EXECUTE format('SELECT id FROM %I WHERE id=$1 AND filing_id=$2 AND case_id=$3 AND department_id=$4 AND recorded_by_user_id=$5 AND xmin=pg_current_xact_id()::text::xid',p_table)
      INTO p_version USING p_id,NEW.filing_id,NEW.case_id,NEW.department_id,NEW.actor_user_id;
  END IF;
  IF p_version.id IS NULL THEN RAISE EXCEPTION 'followup audit or receipt lacks its same-transaction typed fact' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "ef_audit_fact_final" AFTER INSERT ON audit_events
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_execution_followup_link_final();
CREATE CONSTRAINT TRIGGER "ef_receipt_fact_final" AFTER INSERT ON case_execution_filing_followup_receipts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_execution_followup_link_final();

-- No boolean/current-pointer shortcut: release a draft target only through an
-- exact immutable version + document + same-actor audit + material reference.
CREATE FUNCTION "case_execution_supplement_upload_first_freeze_proof"(p_version uuid,p_prior_only boolean)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM content_versions v JOIN upload_drafts u ON u.id=v.execution_supplement_upload_draft_id
    JOIN materials m ON m.id=v.material_id AND m.owner_type='CASE' AND m.owner_id=u.owner_id AND m.department_id=u.department_id
      AND m.category='EXECUTION_SUPPLEMENT' AND m.purpose='EXECUTION_SUPPLEMENT' AND m.status='ACTIVE' AND m.deleted_at IS NULL
    JOIN case_execution_filing_supplement_documents d ON d.content_version_id=v.id AND d.material_id=m.id
      AND d.case_id=u.owner_id AND d.department_id=u.department_id AND d.filing_id=u.execution_supplement_filing_id AND d.supplement_id=u.execution_supplement_target_id
    JOIN case_execution_filing_supplements s ON s.id=d.version_id AND s.supplement_id=d.supplement_id AND s.filing_id=d.filing_id
      AND s.case_id=d.case_id AND s.department_id=d.department_id AND s.from_revision=u.execution_supplement_revision
      AND s.recorded_by_user_id=u.actor_user_id AND s.internal_actor_user_id IS NOT DISTINCT FROM u.internal_actor_user_id
      AND s.lawyer_account_binding_id IS NOT DISTINCT FROM u.lawyer_account_binding_id
    JOIN audit_events a ON a.id=s.audit_event_id AND a.department_id=s.department_id AND a.resource_type='CASE' AND a.resource_id=s.case_id
      AND a.actor_kind='HUMAN' AND a.actor_user_id=s.recorded_by_user_id
      AND a.internal_actor_user_id IS NOT DISTINCT FROM s.internal_actor_user_id
      AND a.lawyer_account_binding_id IS NOT DISTINCT FROM s.lawyer_account_binding_id
      AND a.customer_account_binding_id IS NULL AND a.notary_office_account_binding_id IS NULL
      AND a.action=(CASE WHEN s.from_revision=0 THEN 'case.execution.supplement.submitted' ELSE 'case.execution.supplement.corrected' END)
      AND a.details @> jsonb_build_object('versionId',s.id,'filingId',s.filing_id,'supplementId',s.supplement_id,'fromRevision',s.from_revision,'toRevision',s.to_revision)
    JOIN material_references r ON r.material_id=m.id AND r.content_version_id=v.id AND r.department_id=s.department_id
      AND r.resource_type='case' AND r.resource_id=s.case_id AND r.purpose='EXECUTION_SUPPLEMENT' AND r.action_event_id=s.audit_event_id AND r.asset_version_id IS NULL
    WHERE v.id=p_version AND v.status='AVAILABLE' AND v.uploaded_by=u.actor_user_id AND v.original_filename=u.original_filename
      AND u.status='FINALIZED' AND u.owner_type='CASE' AND u.category='EXECUTION_SUPPLEMENT' AND u.purpose='EXECUTION_SUPPLEMENT'
      AND u.execution_supplement_filing_id IS NOT NULL AND u.execution_supplement_target_id IS NOT NULL AND u.execution_supplement_revision IS NOT NULL
      AND (NOT p_prior_only OR (s.xmin<>pg_current_xact_id()::text::xid AND d.xmin<>pg_current_xact_id()::text::xid
        AND a.xmin<>pg_current_xact_id()::text::xid AND r.xmin<>pg_current_xact_id()::text::xid))
  );
$$;

CREATE FUNCTION "guard_execution_supplement_consumption"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_version uuid; p_draft upload_drafts%ROWTYPE; p_exact boolean;
BEGIN
  p_version := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
  IF p_version IS NULL THEN RETURN NEW; END IF;
  SELECT u.* INTO p_draft FROM content_versions v JOIN upload_drafts u ON u.id=v.execution_supplement_upload_draft_id WHERE v.id=p_version;
  IF p_draft.id IS NULL THEN RETURN NEW; END IF;
  -- Keep table-specific record fields inside their own procedural branch;
  -- a SQL boolean short circuit cannot establish another trigger row's shape.
  IF TG_TABLE_NAME='material_references' THEN
    IF NEW.resource_type<>'case' OR NEW.resource_id IS DISTINCT FROM p_draft.owner_id OR NEW.department_id IS DISTINCT FROM p_draft.department_id OR NEW.purpose<>'EXECUTION_SUPPLEMENT' OR NEW.action_event_id IS NULL OR NEW.asset_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'supplement upload reference cannot escape its case or purpose' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='content_versions' THEN
    IF NOT EXISTS (
      SELECT 1 FROM materials m WHERE m.id=NEW.material_id AND m.owner_type='CASE' AND m.owner_id=p_draft.owner_id
        AND m.department_id=p_draft.department_id AND m.category='EXECUTION_SUPPLEMENT' AND m.purpose='EXECUTION_SUPPLEMENT') THEN
      RAISE EXCEPTION 'supplement content lineage cannot escape its case or category' USING ERRCODE='23514'; END IF;
  END IF;
  IF case_execution_supplement_upload_first_freeze_proof(p_version,true) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME NOT IN ('case_execution_filing_supplement_documents','material_references') OR NOT case_execution_supplement_upload_first_freeze_proof(p_version,false) THEN
    RAISE EXCEPTION 'unconsumed supplement content cannot be used by workflow or unrelated target' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='case_execution_filing_supplement_documents' THEN
    SELECT EXISTS(SELECT 1 FROM case_execution_filing_supplements s WHERE s.id=NEW.version_id AND s.supplement_id=p_draft.execution_supplement_target_id
      AND s.filing_id=p_draft.execution_supplement_filing_id AND s.case_id=p_draft.owner_id AND s.department_id=p_draft.department_id
      AND s.from_revision=p_draft.execution_supplement_revision AND s.recorded_by_user_id=p_draft.actor_user_id AND s.xmin=pg_current_xact_id()::text::xid) INTO p_exact;
  ELSE
    SELECT EXISTS(SELECT 1 FROM case_execution_filing_supplements s JOIN case_execution_filing_supplement_documents d ON d.version_id=s.id
      WHERE s.supplement_id=p_draft.execution_supplement_target_id AND s.filing_id=p_draft.execution_supplement_filing_id AND s.case_id=p_draft.owner_id AND s.department_id=p_draft.department_id
      AND s.from_revision=p_draft.execution_supplement_revision AND s.recorded_by_user_id=p_draft.actor_user_id AND s.audit_event_id=NEW.action_event_id
      AND d.material_id=NEW.material_id AND d.content_version_id=p_version AND s.xmin=pg_current_xact_id()::text::xid AND d.xmin=pg_current_xact_id()::text::xid) INTO p_exact;
  END IF;
  IF p_exact IS DISTINCT FROM true THEN RAISE EXCEPTION 'first supplement consumption must match its exact target transaction' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;

-- Cover the complete existing direct-consumer list plus the new typed document.
DO $$
DECLARE p_item text[]; p_consumers text[][] := ARRAY[
  ARRAY['case_complaint_mailing_versions','content_version_id'], ARRAY['case_execution_mailing_versions','content_version_id'],
  ARRAY['case_execution_filing_versions','content_version_id'], ARRAY['case_execution_finish_versions','content_version_id'],
  ARRAY['case_judgment_versions','content_version_id'], ARRAY['case_closure_documents','content_version_id'],
  ARRAY['case_execution_mailing_record_documents','content_version_id'], ARRAY['case_execution_filing_record_documents','content_version_id'],
  ARRAY['case_execution_finish_record_documents','content_version_id'], ARRAY['case_judgment_record_documents','content_version_id'],
  ARRAY['case_closure_record_documents','content_version_id'], ARRAY['material_references','content_version_id'],
  ARRAY['case_complaint_confirmations','confirmed_complaint_content_version_id'], ARRAY['case_filing_versions','content_version_id'],
  ARRAY['case_acceptance_versions','content_version_id'], ARRAY['case_second_instance_progress_versions','content_version_id'],
  ARRAY['case_second_instance_result_versions','content_version_id'], ARRAY['case_execution_submission_versions','content_version_id'],
  ARRAY['case_execution_confirmation_versions','content_version_id'], ARRAY['notary_matter_materials','content_version_id'],
  ARRAY['case_execution_filing_supplement_documents','content_version_id'],
  ARRAY['content_versions','derived_from_version_id']
];
BEGIN
  FOREACH p_item SLICE 1 IN ARRAY p_consumers LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_execution_supplement_consumption(%L)',
      'ef_upload_consumer_'||p_item[1],p_item[1],p_item[2]);
  END LOOP;
END; $$;

CREATE FUNCTION "guard_execution_supplement_content"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_draft upload_drafts%ROWTYPE; p_material materials%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.execution_supplement_upload_draft_id IS NOT NULL THEN
      RAISE EXCEPTION 'supplement uploaded content provenance is immutable' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.execution_supplement_upload_draft_id IS NOT NULL OR NEW.execution_supplement_upload_draft_id IS NOT NULL THEN
      IF to_jsonb(NEW)=to_jsonb(OLD) THEN RETURN NEW; END IF;
      -- Retain the existing unreferenced 90-day cleanup status transitions only.
      IF OLD.execution_supplement_upload_draft_id IS NOT NULL AND
        (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') AND
        ((OLD.status IN ('AVAILABLE','DELETED') AND NEW.status='DELETED') OR (OLD.status='DELETED' AND NEW.status='PURGED')) AND
        EXISTS(SELECT 1 FROM materials m WHERE m.id=OLD.material_id AND m.status='DELETED' AND m.deleted_at+interval '90 days'<=CURRENT_TIMESTAMP) AND
        NOT EXISTS(SELECT 1 FROM material_references r WHERE r.content_version_id=OLD.id) AND
        NOT EXISTS(SELECT 1 FROM case_execution_filing_supplement_documents d WHERE d.content_version_id=OLD.id) THEN RETURN NEW; END IF;
      RAISE EXCEPTION 'supplement uploaded content bytes and anchors are immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO p_material FROM materials m WHERE m.id=NEW.material_id;
  IF NEW.execution_supplement_upload_draft_id IS NULL THEN
    IF p_material.category='EXECUTION_SUPPLEMENT' THEN RAISE EXCEPTION 'supplement content requires structured upload context' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO p_draft FROM upload_drafts u WHERE u.id=NEW.execution_supplement_upload_draft_id;
  IF p_draft.id IS NULL THEN RAISE EXCEPTION 'supplement content draft is missing' USING ERRCODE='23514'; END IF;
  PERFORM assert_execution_supplement_upload_target(p_draft.actor_user_id,p_draft.owner_id,p_draft.department_id,
    p_draft.execution_supplement_filing_id,p_draft.execution_supplement_target_id,p_draft.execution_supplement_revision,p_draft.internal_actor_user_id,p_draft.lawyer_account_binding_id);
  SELECT * INTO p_draft FROM upload_drafts u WHERE u.id=NEW.execution_supplement_upload_draft_id FOR UPDATE;
  SELECT * INTO p_material FROM materials m WHERE m.id=NEW.material_id FOR UPDATE;
  IF p_material.id IS NULL OR p_draft.status<>'OPEN' OR p_draft.pending_storage_key IS NULL OR
    NEW.storage_key IS DISTINCT FROM p_draft.pending_storage_key OR p_draft.expires_at<=CURRENT_TIMESTAMP OR
    p_draft.owner_type<>'CASE' OR p_draft.category<>'EXECUTION_SUPPLEMENT' OR p_draft.purpose<>'EXECUTION_SUPPLEMENT' OR
    NEW.uploaded_by IS DISTINCT FROM p_draft.actor_user_id OR NEW.original_filename IS DISTINCT FROM p_draft.original_filename OR
    NEW.status<>'AVAILABLE' OR NEW.derived_from_version_id IS NOT NULL OR NEW.case_section_record_upload_draft_id IS NOT NULL OR
    NEW.mime_type NOT IN ('application/pdf','image/jpeg','image/png') OR NEW.mime_type IS DISTINCT FROM p_draft.declared_mime_type OR NEW.size_bytes NOT BETWEEN 1 AND 52428800 OR
    p_material.owner_type<>'CASE' OR p_material.owner_id IS DISTINCT FROM p_draft.owner_id OR p_material.department_id IS DISTINCT FROM p_draft.department_id OR
    p_material.category<>'EXECUTION_SUPPLEMENT' OR p_material.purpose<>'EXECUTION_SUPPLEMENT' OR p_material.status<>'ACTIVE' OR p_material.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'supplement content does not match exact claimed draft and material' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ef_upload_content_guard" BEFORE INSERT OR UPDATE OR DELETE ON content_versions FOR EACH ROW EXECUTE FUNCTION guard_execution_supplement_content();

CREATE FUNCTION "check_execution_supplement_content_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_draft upload_drafts%ROWTYPE; p_material materials%ROWTYPE;
BEGIN
  IF NEW.execution_supplement_upload_draft_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p_draft FROM upload_drafts u WHERE u.id=NEW.execution_supplement_upload_draft_id;
  SELECT * INTO p_material FROM materials m WHERE m.id=NEW.material_id;
  IF p_draft.status<>'FINALIZED' OR p_material.current_version_id IS DISTINCT FROM NEW.id OR
    p_material.owner_type<>'CASE' OR p_material.owner_id IS DISTINCT FROM p_draft.owner_id OR p_material.department_id IS DISTINCT FROM p_draft.department_id OR
    p_material.category<>'EXECUTION_SUPPLEMENT' OR p_material.purpose<>'EXECUTION_SUPPLEMENT' THEN
    RAISE EXCEPTION 'supplement content lacks exact finalized draft and current material' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "ef_upload_content_final" AFTER INSERT ON content_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_execution_supplement_content_final();

CREATE FUNCTION "check_execution_supplement_draft_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_version content_versions%ROWTYPE;
BEGIN
  IF NEW.execution_supplement_target_id IS NULL OR NEW.status<>'FINALIZED' THEN RETURN NEW; END IF;
  SELECT * INTO p_version FROM content_versions v WHERE v.execution_supplement_upload_draft_id=NEW.id;
  IF p_version.id IS NULL OR (TG_OP='UPDATE' AND OLD.status='OPEN' AND p_version.storage_key IS DISTINCT FROM OLD.pending_storage_key) THEN
    RAISE EXCEPTION 'finalized supplement draft lacks one exact claimed version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "ef_upload_draft_final" AFTER INSERT OR UPDATE ON upload_drafts
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_execution_supplement_draft_final();

CREATE FUNCTION "guard_execution_supplement_material"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM content_versions v WHERE v.material_id=OLD.id AND v.execution_supplement_upload_draft_id IS NOT NULL) AND
    (TG_OP='DELETE' OR (NEW.id,NEW.owner_type,NEW.owner_id,NEW.department_id,NEW.category,NEW.purpose) IS DISTINCT FROM (OLD.id,OLD.owner_type,OLD.owner_id,OLD.department_id,OLD.category,OLD.purpose)) THEN
    RAISE EXCEPTION 'supplement material scope and identity are immutable' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM case_execution_filing_supplement_documents d WHERE d.material_id=OLD.id) AND
    (TG_OP='DELETE' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at) THEN
    RAISE EXCEPTION 'frozen supplement material cannot be deleted or restored' USING ERRCODE='23514'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "ef_upload_material_guard" BEFORE UPDATE OR DELETE ON materials FOR EACH ROW EXECUTE FUNCTION guard_execution_supplement_material();

CREATE FUNCTION "check_execution_supplement_material_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p_material materials%ROWTYPE; p_count integer; p_draft upload_drafts%ROWTYPE; p_action text;
BEGIN
  SELECT * INTO p_material FROM materials m WHERE m.id=NEW.id;
  IF p_material.id IS NULL OR p_material.category<>'EXECUTION_SUPPLEMENT' THEN RETURN NEW; END IF;
  IF p_material.owner_type<>'CASE' OR p_material.purpose<>'EXECUTION_SUPPLEMENT' OR NOT EXISTS (
    SELECT 1 FROM content_versions v JOIN upload_drafts u ON u.id=v.execution_supplement_upload_draft_id
      AND u.owner_id=p_material.owner_id AND u.department_id=p_material.department_id
    WHERE v.id=p_material.current_version_id AND v.material_id=p_material.id AND u.status='FINALIZED') THEN
    RAISE EXCEPTION 'supplement material requires its exact finalized controlled version' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT u.* INTO p_draft FROM content_versions v JOIN upload_drafts u ON u.id=v.execution_supplement_upload_draft_id
      WHERE v.id=NEW.current_version_id AND v.material_id=NEW.id AND v.status='AVAILABLE'
        AND v.uploaded_by=u.actor_user_id AND v.original_filename=u.original_filename
        AND u.owner_type='CASE' AND u.owner_id=NEW.owner_id AND u.department_id=NEW.department_id
        AND u.category='EXECUTION_SUPPLEMENT' AND u.purpose='EXECUTION_SUPPLEMENT' AND u.status='FINALIZED';
    IF p_draft.id IS NULL OR NEW.version::bigint<>OLD.version::bigint+1 OR
      (to_jsonb(NEW)-'status'-'deleted_at'-'version'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'deleted_at'-'version'-'updated_at') OR
      EXISTS(SELECT 1 FROM material_references r WHERE r.material_id=NEW.id) OR
      case_execution_supplement_upload_first_freeze_proof(NEW.current_version_id,false) THEN
      RAISE EXCEPTION 'supplement lifecycle requires an own unconsumed exact preparation' USING ERRCODE='23514'; END IF;
    IF OLD.status='ACTIVE' AND NEW.status='DELETED' AND NEW.deleted_at IS NOT NULL THEN
      p_action:='material.deleted';
    ELSIF OLD.status='DELETED' AND NEW.status='ACTIVE' AND NEW.deleted_at IS NULL AND OLD.deleted_at IS NOT NULL
      AND OLD.deleted_at+interval '90 days'>CURRENT_TIMESTAMP THEN
      p_action:='material.restored';
    ELSE RAISE EXCEPTION 'invalid supplement preparation lifecycle transition' USING ERRCODE='23514'; END IF;
    PERFORM assert_execution_supplement_upload_target(p_draft.actor_user_id,NEW.owner_id,NEW.department_id,
      p_draft.execution_supplement_filing_id,p_draft.execution_supplement_target_id,p_draft.execution_supplement_revision,
      p_draft.internal_actor_user_id,p_draft.lawyer_account_binding_id,p_action='material.deleted');
    IF NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.department_id=NEW.department_id AND a.resource_type='material'
      AND a.resource_id=NEW.id AND a.action=p_action AND a.actor_kind='HUMAN' AND a.actor_user_id=p_draft.actor_user_id
      AND a.internal_actor_user_id IS NOT DISTINCT FROM p_draft.internal_actor_user_id
      AND a.lawyer_account_binding_id IS NOT DISTINCT FROM p_draft.lawyer_account_binding_id
      AND a.customer_account_binding_id IS NULL AND a.notary_office_account_binding_id IS NULL
      AND a.details=jsonb_build_object('fromVersion',OLD.version,'toVersion',NEW.version)
      AND a.xmin=pg_current_xact_id()::text::xid) THEN
      RAISE EXCEPTION 'supplement lifecycle requires exact same-actor audit in this transaction' USING ERRCODE='23514'; END IF;
  END IF;
  PERFORM 1 FROM cases c WHERE c.id=p_material.owner_id AND c.department_id=p_material.department_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_material.department_id::text||':CASE:'||p_material.owner_id::text||':EXECUTION_SUPPLEMENT',0));
  SELECT count(*) INTO p_count FROM materials m WHERE m.owner_type='CASE' AND m.owner_id=p_material.owner_id
    AND m.department_id=p_material.department_id AND m.category='EXECUTION_SUPPLEMENT' AND m.status='ACTIVE'
    AND NOT case_execution_supplement_upload_first_freeze_proof(m.current_version_id,false);
  IF p_count>10 THEN RAISE EXCEPTION 'supplement pending pool exceeds ten unconsumed current versions' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "ef_upload_material_final" AFTER INSERT OR UPDATE ON materials
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_execution_supplement_material_final();

COMMIT;
