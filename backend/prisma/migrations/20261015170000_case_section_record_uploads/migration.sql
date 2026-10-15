-- Dedicated section-record uploads are structurally bound to one correction target.
-- The existing 155/156 immutable correction, document, reference and audit chain is retained.
BEGIN;

ALTER TABLE "upload_drafts"
  ADD COLUMN "case_section_record_command" "case_section_record_edit_command",
  ADD COLUMN "case_section_record_target_id" uuid,
  ADD COLUMN "case_section_record_revision" integer,
  ADD COLUMN "case_section_record_trial_round_id" uuid,
  ADD COLUMN "case_section_record_closure_version_id" uuid,
  ADD CONSTRAINT "upload_drafts_section_record_shape" CHECK (
    ("case_section_record_command" IS NULL AND "case_section_record_target_id" IS NULL
      AND "case_section_record_revision" IS NULL AND "case_section_record_trial_round_id" IS NULL
      AND "case_section_record_closure_version_id" IS NULL)
    OR ("case_section_record_command" IS NOT NULL
      AND "case_section_record_command" IN ('EXECUTION_MAILING_CORRECTION',
      'EXECUTION_FILING_CORRECTION','EXECUTION_FINISH_CORRECTION',
      'JUDGMENT_RECORD_CORRECTION','CLOSURE_RECORD_CORRECTION')
      AND "case_section_record_target_id" IS NOT NULL AND "case_section_record_revision" IS NOT NULL
      AND "case_section_record_revision" >= 0
      AND (("case_section_record_command" = 'JUDGMENT_RECORD_CORRECTION'
         AND "case_section_record_trial_round_id" IS NOT NULL AND "case_section_record_closure_version_id" IS NULL)
        OR ("case_section_record_command" = 'CLOSURE_RECORD_CORRECTION'
         AND "case_section_record_trial_round_id" IS NULL AND "case_section_record_closure_version_id" IS NOT NULL)
        OR ("case_section_record_command" IN ('EXECUTION_MAILING_CORRECTION',
          'EXECUTION_FILING_CORRECTION','EXECUTION_FINISH_CORRECTION')
         AND "case_section_record_trial_round_id" IS NULL AND "case_section_record_closure_version_id" IS NULL)))
  );

ALTER TABLE "content_versions"
  ADD COLUMN "case_section_record_upload_draft_id" uuid UNIQUE,
  ADD CONSTRAINT "content_versions_section_record_upload_draft_fkey"
    FOREIGN KEY ("case_section_record_upload_draft_id") REFERENCES "upload_drafts"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- A committed OPEN draft can be claimed, but its business anchors cannot drift.
CREATE FUNCTION "check_case_section_upload_draft"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wanted_category text; wanted_action "permission_action"; actual_round uuid;
  actual_closure uuid; head_revision integer; target_exists boolean; must_recheck boolean := false;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."case_section_record_command" IS NOT NULL AND
      (NEW."case_section_record_command",NEW."case_section_record_target_id",
       NEW."case_section_record_revision",NEW."case_section_record_trial_round_id",
       NEW."case_section_record_closure_version_id",NEW."owner_type",NEW."owner_id",
       NEW."department_id",NEW."actor_user_id",NEW."internal_actor_user_id",
       NEW."notary_office_account_binding_id",NEW."customer_account_binding_id",
       NEW."lawyer_account_binding_id",NEW."category",NEW."purpose",
       NEW."original_filename",NEW."declared_mime_type",NEW."expires_at",NEW."created_at")
      IS DISTINCT FROM
      (OLD."case_section_record_command",OLD."case_section_record_target_id",
       OLD."case_section_record_revision",OLD."case_section_record_trial_round_id",
       OLD."case_section_record_closure_version_id",OLD."owner_type",OLD."owner_id",
       OLD."department_id",OLD."actor_user_id",OLD."internal_actor_user_id",
       OLD."notary_office_account_binding_id",OLD."customer_account_binding_id",
       OLD."lawyer_account_binding_id",OLD."category",OLD."purpose",
       OLD."original_filename",OLD."declared_mime_type",OLD."expires_at",OLD."created_at") THEN
      RAISE EXCEPTION 'section upload anchors are immutable' USING ERRCODE='23514';
    END IF;
    IF OLD."case_section_record_command" IS NULL AND NEW."case_section_record_command" IS NOT NULL THEN
      RAISE EXCEPTION 'ordinary draft cannot become a section upload' USING ERRCODE='23514';
    END IF;
    IF OLD."case_section_record_command" IS NOT NULL THEN
      IF OLD."status"='OPEN' THEN
        IF NEW."status"='OPEN' THEN
          IF OLD."pending_storage_key" IS NULL AND NEW."pending_storage_key" IS NOT NULL THEN
            must_recheck := true; -- first claim
          ELSIF OLD."pending_storage_key" IS NOT NULL AND NEW."pending_storage_key" IS NOT NULL
            AND OLD."pending_storage_key" IS DISTINCT FROM NEW."pending_storage_key" THEN
            RAISE EXCEPTION 'section upload claim cannot change key' USING ERRCODE='23514';
          END IF; -- same key maintenance or failed-claim cleanup to NULL
        ELSIF NEW."status"='FINALIZED' THEN
          IF OLD."pending_storage_key" IS NULL OR NEW."pending_storage_key" IS NOT NULL THEN
            RAISE EXCEPTION 'section upload finalization needs claimed and cleared key' USING ERRCODE='23514';
          END IF;
          must_recheck := true;
        ELSIF NEW."status"='EXPIRED' THEN
          IF NEW."pending_storage_key" IS NOT NULL AND NEW."pending_storage_key" IS DISTINCT FROM OLD."pending_storage_key" THEN
            RAISE EXCEPTION 'expired section upload cannot change claim' USING ERRCODE='23514';
          END IF;
        END IF;
      ELSIF NEW."status" IS DISTINCT FROM OLD."status" OR
        (OLD."status"='FINALIZED' AND NEW."pending_storage_key" IS NOT NULL) OR
        (OLD."status"='EXPIRED' AND NEW."pending_storage_key" IS NOT NULL
          AND NEW."pending_storage_key" IS DISTINCT FROM OLD."pending_storage_key") THEN
        RAISE EXCEPTION 'section upload terminal state cannot reopen' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF NEW."case_section_record_command" IS NULL THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' AND (NEW."status" <> 'OPEN' OR NEW."pending_storage_key" IS NOT NULL) THEN
    RAISE EXCEPTION 'section upload must start as an unclaimed open draft' USING ERRCODE='23514';
  END IF;
  IF NEW."owner_type" <> 'CASE' OR NEW."internal_actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
    OR NEW."notary_office_account_binding_id" IS NOT NULL
    OR NEW."customer_account_binding_id" IS NOT NULL OR NEW."lawyer_account_binding_id" IS NOT NULL THEN
    RAISE EXCEPTION 'section upload requires internal case actor' USING ERRCODE='23514';
  END IF;
  CASE NEW."case_section_record_command"
    WHEN 'EXECUTION_MAILING_CORRECTION' THEN wanted_category := 'MAIL_RECEIPT'; wanted_action := 'case.execution.mailing.correct';
    WHEN 'EXECUTION_FILING_CORRECTION' THEN wanted_category := 'EXECUTION_FILING_PROOF'; wanted_action := 'case.execution.filing.correct';
    WHEN 'EXECUTION_FINISH_CORRECTION' THEN wanted_category := 'EXECUTION_FINISH_BASIS'; wanted_action := 'case.execution.finish.correct';
    WHEN 'JUDGMENT_RECORD_CORRECTION' THEN wanted_category := 'JUDGMENT'; wanted_action := 'case.judgment.correct';
    WHEN 'CLOSURE_RECORD_CORRECTION' THEN wanted_category := 'CASE_CLOSURE_DOCUMENT'; wanted_action := 'case.closure.correct';
    ELSE RAISE EXCEPTION 'invalid section upload command' USING ERRCODE='23514';
  END CASE;
  IF NEW."category"::text <> wanted_category OR NEW."purpose" <> wanted_category THEN
    RAISE EXCEPTION 'section upload category and purpose mismatch' USING ERRCODE='23514';
  END IF;
  -- Claim and finalization recheck the current scope and real target. Historical FINALIZED
  -- drafts remain valid after a later correction advances the head.
  IF TG_OP='INSERT' OR must_recheck THEN
    PERFORM 1 FROM "cases" WHERE "id"=NEW."owner_id" AND "department_id"=NEW."department_id" FOR UPDATE;
    IF NOT FOUND OR NOT case_record_edit_actor_authorized(NEW."actor_user_id",NEW."owner_id",NEW."department_id",wanted_action) THEN
      RAISE EXCEPTION 'section upload actor or case scope invalid' USING ERRCODE='23514';
    END IF;
    CASE NEW."case_section_record_command"
      WHEN 'EXECUTION_MAILING_CORRECTION' THEN
        SELECT EXISTS(SELECT 1 FROM "case_execution_mailings" WHERE "id"=NEW."case_section_record_target_id" AND "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id") INTO target_exists;
        SELECT max("to_revision") INTO head_revision FROM "case_execution_mailing_record_corrections" WHERE "mailing_id"=NEW."case_section_record_target_id" AND "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";
      WHEN 'EXECUTION_FILING_CORRECTION' THEN
        SELECT EXISTS(SELECT 1 FROM "case_execution_filings" WHERE "id"=NEW."case_section_record_target_id" AND "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id") INTO target_exists;
        SELECT max("to_revision") INTO head_revision FROM "case_execution_filing_record_corrections" WHERE "filing_id"=NEW."case_section_record_target_id" AND "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";
      WHEN 'EXECUTION_FINISH_CORRECTION' THEN
        SELECT EXISTS(SELECT 1 FROM "case_execution_finishes" WHERE "id"=NEW."case_section_record_target_id" AND "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id") INTO target_exists;
        SELECT max("to_revision") INTO head_revision FROM "case_execution_finish_record_corrections" WHERE "finish_id"=NEW."case_section_record_target_id" AND "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";
      WHEN 'JUDGMENT_RECORD_CORRECTION' THEN
        SELECT "trial_round_id" INTO actual_round FROM "case_judgment_facts" WHERE "id"=NEW."case_section_record_target_id" AND "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";
        target_exists := FOUND;
        SELECT max("to_revision") INTO head_revision FROM "case_judgment_record_corrections" WHERE "judgment_id"=NEW."case_section_record_target_id" AND "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";
      WHEN 'CLOSURE_RECORD_CORRECTION' THEN
        SELECT "current_version_id" INTO actual_closure FROM "case_closures" WHERE "id"=NEW."case_section_record_target_id" AND "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";
        target_exists := FOUND;
        SELECT max("to_revision") INTO head_revision FROM "case_closure_record_corrections" WHERE "closure_id"=NEW."case_section_record_target_id" AND "case_id"=NEW."owner_id" AND "department_id"=NEW."department_id";
    END CASE;
    IF NOT target_exists OR coalesce(head_revision,0) <> NEW."case_section_record_revision"
      OR (NEW."case_section_record_command"='JUDGMENT_RECORD_CORRECTION' AND actual_round IS DISTINCT FROM NEW."case_section_record_trial_round_id")
      OR (NEW."case_section_record_command"='CLOSURE_RECORD_CORRECTION' AND actual_closure IS DISTINCT FROM NEW."case_section_record_closure_version_id") THEN
      RAISE EXCEPTION 'section upload target, revision or source anchor changed' USING ERRCODE='23514';
    END IF;
    IF NEW."expires_at" <= CURRENT_TIMESTAMP OR NEW."expires_at" > NEW."created_at" + interval '24 hours' THEN
      RAISE EXCEPTION 'section upload must be open for at most 24 hours' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "section_upload_draft_guard" BEFORE INSERT OR UPDATE ON "upload_drafts"
  FOR EACH ROW EXECUTE FUNCTION "check_case_section_upload_draft"();

CREATE FUNCTION "reject_section_upload_draft_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."case_section_record_command" IS NOT NULL THEN
    RAISE EXCEPTION 'section upload draft is immutable' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END; $$;
CREATE TRIGGER "section_upload_draft_delete" BEFORE DELETE ON "upload_drafts"
  FOR EACH ROW EXECUTE FUNCTION "reject_section_upload_draft_delete"();

CREATE FUNCTION "check_section_upload_content"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "upload_drafts"%ROWTYPE; m "materials"%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD."case_section_record_upload_draft_id" IS NOT NULL THEN
      RAISE EXCEPTION 'section uploaded content is immutable' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD."case_section_record_upload_draft_id" IS NOT NULL OR NEW."case_section_record_upload_draft_id" IS NOT NULL THEN
      IF to_jsonb(NEW) = to_jsonb(OLD) THEN RETURN NEW; END IF;
      -- The original 90-day soft-delete cleanup can mark and purge only an
      -- unreferenced version; its binding, storage key and bytes remain immutable.
      IF OLD."case_section_record_upload_draft_id" IS NOT NULL
        AND (to_jsonb(NEW)-'status') = (to_jsonb(OLD)-'status')
        AND ((OLD."status" IN ('AVAILABLE','DELETED') AND NEW."status"='DELETED')
          OR (OLD."status"='DELETED' AND NEW."status"='PURGED'))
        AND EXISTS (SELECT 1 FROM "materials" m WHERE m."id"=OLD."material_id" AND m."status"='DELETED'
          AND m."deleted_at" + INTERVAL '90 days' <= CURRENT_TIMESTAMP)
        AND NOT EXISTS (SELECT 1 FROM "material_references" r WHERE r."content_version_id"=OLD."id") THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'section uploaded content is immutable' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."case_section_record_upload_draft_id" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO d FROM "upload_drafts" WHERE "id"=NEW."case_section_record_upload_draft_id" FOR UPDATE;
  SELECT * INTO m FROM "materials" WHERE "id"=NEW."material_id" FOR UPDATE;
  IF d."id" IS NULL OR d."case_section_record_command" IS NULL OR m."id" IS NULL
    OR (d."status"='OPEN' AND (d."pending_storage_key" IS NULL OR NEW."storage_key" IS DISTINCT FROM d."pending_storage_key"))
    OR d."status" NOT IN ('OPEN','FINALIZED')
    OR NEW."uploaded_by" IS DISTINCT FROM d."actor_user_id" OR NEW."original_filename" IS DISTINCT FROM d."original_filename"
    OR NEW."derived_from_version_id" IS NOT NULL OR NEW."status" <> 'AVAILABLE'
    OR NEW."mime_type" NOT IN ('application/pdf','image/jpeg','image/png') OR NEW."mime_type" IS DISTINCT FROM d."declared_mime_type"
    OR NEW."size_bytes" <= 0 OR NEW."size_bytes" > CASE WHEN d."category"='MAIL_RECEIPT' THEN 20971520 ELSE 52428800 END
    OR m."department_id" IS DISTINCT FROM d."department_id" OR m."owner_type" <> 'CASE'
    OR m."owner_id" IS DISTINCT FROM d."owner_id" OR m."category" IS DISTINCT FROM d."category"
    OR m."purpose" IS DISTINCT FROM d."purpose" OR m."status" <> 'ACTIVE' OR m."deleted_at" IS NOT NULL THEN
    RAISE EXCEPTION 'section content does not match claimed draft and case material' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "section_upload_content_insert" BEFORE INSERT OR UPDATE OR DELETE ON "content_versions"
  FOR EACH ROW EXECUTE FUNCTION "check_section_upload_content"();

CREATE FUNCTION "check_section_upload_content_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d "upload_drafts"%ROWTYPE; m "materials"%ROWTYPE;
BEGIN
  IF NEW."case_section_record_upload_draft_id" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO d FROM "upload_drafts" WHERE "id"=NEW."case_section_record_upload_draft_id";
  SELECT * INTO m FROM "materials" WHERE "id"=NEW."material_id";
  IF d."status" <> 'FINALIZED' OR m."current_version_id" IS DISTINCT FROM NEW."id"
    OR m."department_id" IS DISTINCT FROM d."department_id" OR m."owner_id" IS DISTINCT FROM d."owner_id"
    OR m."owner_type" <> 'CASE' OR m."category" IS DISTINCT FROM d."category" OR m."purpose" IS DISTINCT FROM d."purpose" THEN
    RAISE EXCEPTION 'section content lacks finalized exact draft and current material' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "section_upload_content_final" AFTER INSERT ON "content_versions"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_section_upload_content_final"();

CREATE FUNCTION "check_section_upload_draft_final"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "content_versions"%ROWTYPE;
BEGIN
  IF NEW."case_section_record_command" IS NOT NULL AND NEW."status"='FINALIZED' THEN
    SELECT * INTO v FROM "content_versions" WHERE "case_section_record_upload_draft_id"=NEW."id";
    IF v."id" IS NULL OR (TG_OP='UPDATE' AND OLD."status"='OPEN'
      AND v."storage_key" IS DISTINCT FROM OLD."pending_storage_key") THEN
      RAISE EXCEPTION 'finalized section draft lacks exact claimed content version' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "section_upload_draft_final" AFTER INSERT OR UPDATE ON "upload_drafts"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_section_upload_draft_final"();

-- A proof is a committed-capable fact chain, not a draft boolean or a current-version pointer.
-- The five table/column choices below are constants selected from the stored command.
CREATE FUNCTION "case_section_upload_first_freeze_proof"(p_version_id uuid,p_prior_only boolean) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE d "upload_drafts"%ROWTYPE; v "content_versions"%ROWTYPE; m "materials"%ROWTYPE;
  correction_table text; document_table text; target_column text; category_name text; audit_action text;
  proof boolean; extra_predicate text := '';
BEGIN
  SELECT * INTO v FROM "content_versions" WHERE "id"=p_version_id;
  IF v."case_section_record_upload_draft_id" IS NULL THEN RETURN false; END IF;
  SELECT * INTO d FROM "upload_drafts" WHERE "id"=v."case_section_record_upload_draft_id";
  SELECT * INTO m FROM "materials" WHERE "id"=v."material_id";
  IF d."id" IS NULL OR d."status" <> 'FINALIZED' OR m."id" IS NULL
    OR m."owner_type" <> 'CASE' OR m."owner_id" IS DISTINCT FROM d."owner_id"
    OR m."department_id" IS DISTINCT FROM d."department_id"
    OR m."category" IS DISTINCT FROM d."category" OR m."purpose" IS DISTINCT FROM d."purpose"
    OR m."status" <> 'ACTIVE' OR m."deleted_at" IS NOT NULL
    OR v."uploaded_by" IS DISTINCT FROM d."actor_user_id"
    OR v."original_filename" IS DISTINCT FROM d."original_filename"
    OR v."status" <> 'AVAILABLE' THEN RETURN false; END IF;
  CASE d."case_section_record_command"
    WHEN 'EXECUTION_MAILING_CORRECTION' THEN correction_table:='case_execution_mailing_record_corrections'; document_table:='case_execution_mailing_record_documents'; target_column:='mailing_id'; category_name:='MAIL_RECEIPT'; audit_action:='case.execution.mailing.record-corrected';
    WHEN 'EXECUTION_FILING_CORRECTION' THEN correction_table:='case_execution_filing_record_corrections'; document_table:='case_execution_filing_record_documents'; target_column:='filing_id'; category_name:='EXECUTION_FILING_PROOF'; audit_action:='case.execution.filing.record-corrected';
    WHEN 'EXECUTION_FINISH_CORRECTION' THEN correction_table:='case_execution_finish_record_corrections'; document_table:='case_execution_finish_record_documents'; target_column:='finish_id'; category_name:='EXECUTION_FINISH_BASIS'; audit_action:='case.execution.finish.record-corrected';
    WHEN 'JUDGMENT_RECORD_CORRECTION' THEN correction_table:='case_judgment_record_corrections'; document_table:='case_judgment_record_documents'; target_column:='judgment_id'; category_name:='JUDGMENT'; audit_action:='case.judgment.record-corrected';
    WHEN 'CLOSURE_RECORD_CORRECTION' THEN correction_table:='case_closure_record_corrections'; document_table:='case_closure_record_documents'; target_column:='closure_id'; category_name:='CASE_CLOSURE_DOCUMENT'; audit_action:='case.closure.record-corrected';
    ELSE RETURN false;
  END CASE;
  IF d."category"::text <> category_name OR d."purpose" <> category_name THEN RETURN false; END IF;
  IF d."case_section_record_command"='JUDGMENT_RECORD_CORRECTION' THEN
    extra_predicate := ' AND c.trial_round_id=$10';
  ELSIF d."case_section_record_command"='CLOSURE_RECORD_CORRECTION' THEN
    extra_predicate := ' AND c.source_closure_version_id=$11';
  END IF;
  EXECUTE format('SELECT EXISTS (
    SELECT 1 FROM %I c JOIN %I doc ON doc.correction_id=c.id AND doc.case_id=c.case_id AND doc.department_id=c.department_id
    JOIN material_references r ON r.material_id=doc.material_id AND r.content_version_id=doc.content_version_id
      AND r.department_id=doc.department_id AND r.resource_type=''case'' AND r.resource_id=doc.case_id
      AND r.purpose=$1 AND r.action_event_id=c.audit_event_id AND r.asset_version_id IS NULL
    JOIN audit_events a ON a.id=c.audit_event_id AND a.department_id=c.department_id
      AND a.resource_type=''CASE'' AND a.resource_id=c.case_id AND a.actor_user_id=c.recorded_by_user_id
      AND a.internal_actor_user_id=c.recorded_by_user_id AND a.action=$2
    WHERE doc.content_version_id=$3 AND doc.material_id=$4 AND c.case_id=$5 AND c.department_id=$6
      AND c.%I=$7 AND c.from_revision=$8 AND c.recorded_by_user_id=$9 %s
      AND (NOT $12 OR c.xmin<>pg_current_xact_id()::text::xid)
      AND a.details @> jsonb_build_object(''correctionId'',c.id,''fromRevision'',c.from_revision,
        ''toRevision'',c.to_revision)
  )', correction_table, document_table, target_column,extra_predicate)
    INTO proof USING category_name,audit_action,p_version_id,v."material_id",d."owner_id",d."department_id",
      d."case_section_record_target_id",d."case_section_record_revision",d."actor_user_id",
      d."case_section_record_trial_round_id",d."case_section_record_closure_version_id",p_prior_only;
  RETURN coalesce(proof,false);
END; $$;

-- The proof chain may first be formed only by the matching correction transaction.
-- Every other direct ContentVersion consumer fails even when a forged current AVAILABLE
-- pointer or an unrelated material reference exists.
CREATE FUNCTION "case_section_upload_has_first_freeze"(p_version_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT case_section_upload_first_freeze_proof(p_version_id,false); $$;

CREATE FUNCTION "case_section_upload_has_prior_first_freeze"(p_version_id uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT case_section_upload_first_freeze_proof(p_version_id,true); $$;

CREATE FUNCTION "guard_section_upload_consumption"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_id uuid; d "upload_drafts"%ROWTYPE;
  expected_documents text; expected_corrections text; expected_target_column text; correction_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  version_id := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
  IF version_id IS NULL THEN RETURN NEW; END IF;
  SELECT u.* INTO d FROM "content_versions" v JOIN "upload_drafts" u
    ON u."id"=v."case_section_record_upload_draft_id" WHERE v."id"=version_id;
  IF d."id" IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='material_references' THEN
    IF NEW."resource_type" <> 'case' OR NEW."resource_id" IS DISTINCT FROM d."owner_id"
      OR NEW."department_id" IS DISTINCT FROM d."department_id" OR NEW."action_event_id" IS NULL THEN
      RAISE EXCEPTION 'section upload cannot be referenced outside exact correction' USING ERRCODE='23514';
    END IF;
  END IF;
  -- Only a complete proof committed by an earlier transaction releases the
  -- initial target/revision binding. Ordinary typed/category rules still run.
  IF case_section_upload_has_prior_first_freeze(version_id) THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME <> 'material_references' AND TG_TABLE_NAME NOT IN ('case_execution_mailing_record_documents',
    'case_execution_filing_record_documents','case_execution_finish_record_documents',
    'case_judgment_record_documents','case_closure_record_documents') THEN
    RAISE EXCEPTION 'section upload cannot be consumed by workflow or unrelated typed fact' USING ERRCODE='23514';
  END IF;
  CASE d."case_section_record_command"
    WHEN 'EXECUTION_MAILING_CORRECTION' THEN expected_documents:='case_execution_mailing_record_documents'; expected_corrections:='case_execution_mailing_record_corrections'; expected_target_column:='mailing_id';
    WHEN 'EXECUTION_FILING_CORRECTION' THEN expected_documents:='case_execution_filing_record_documents'; expected_corrections:='case_execution_filing_record_corrections'; expected_target_column:='filing_id';
    WHEN 'EXECUTION_FINISH_CORRECTION' THEN expected_documents:='case_execution_finish_record_documents'; expected_corrections:='case_execution_finish_record_corrections'; expected_target_column:='finish_id';
    WHEN 'JUDGMENT_RECORD_CORRECTION' THEN expected_documents:='case_judgment_record_documents'; expected_corrections:='case_judgment_record_corrections'; expected_target_column:='judgment_id';
    WHEN 'CLOSURE_RECORD_CORRECTION' THEN expected_documents:='case_closure_record_documents'; expected_corrections:='case_closure_record_corrections'; expected_target_column:='closure_id';
    ELSE RAISE EXCEPTION 'invalid section upload command' USING ERRCODE='23514';
  END CASE;
  IF TG_TABLE_NAME <> 'material_references' AND TG_TABLE_NAME <> expected_documents THEN
    RAISE EXCEPTION 'section upload has wrong correction document kind' USING ERRCODE='23514';
  END IF;
  IF NOT case_section_upload_has_first_freeze(version_id) THEN
    RAISE EXCEPTION 'section upload lacks exact immutable first-freeze proof' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='material_references' THEN
    EXECUTE format('SELECT c.id FROM %I c JOIN %I doc ON doc.correction_id=c.id
      WHERE doc.content_version_id=$1 AND doc.material_id=$2 AND c.audit_event_id=$3
      AND c.case_id=$4 AND c.department_id=$5 AND c.%I=$6 AND c.from_revision=$7
      AND c.recorded_by_user_id=$8 AND c.xmin=pg_current_xact_id()::text::xid',
      expected_corrections,expected_documents,expected_target_column)
      INTO correction_id USING version_id,NEW."material_id",NEW."action_event_id",d."owner_id",d."department_id",
        d."case_section_record_target_id",d."case_section_record_revision",d."actor_user_id";
  ELSE
    EXECUTE format('SELECT c.id FROM %I c WHERE c.id=$1 AND c.case_id=$2
      AND c.department_id=$3 AND c.%I=$4 AND c.from_revision=$5
      AND c.recorded_by_user_id=$6 AND c.xmin=pg_current_xact_id()::text::xid',expected_corrections,expected_target_column)
      INTO correction_id USING NEW."correction_id",d."owner_id",d."department_id",
        d."case_section_record_target_id",d."case_section_record_revision",d."actor_user_id";
  END IF;
  IF correction_id IS NULL THEN
    RAISE EXCEPTION 'section upload first freeze must be in its correction transaction' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;

-- All twenty direct consumers of content_versions in the frozen schema.
DO $$
DECLARE item text[]; consumers text[][] := ARRAY[
  ARRAY['case_complaint_mailing_versions','content_version_id'],
  ARRAY['case_execution_mailing_versions','content_version_id'],
  ARRAY['case_execution_filing_versions','content_version_id'],
  ARRAY['case_execution_finish_versions','content_version_id'],
  ARRAY['case_judgment_versions','content_version_id'],
  ARRAY['case_closure_documents','content_version_id'],
  ARRAY['case_execution_mailing_record_documents','content_version_id'],
  ARRAY['case_execution_filing_record_documents','content_version_id'],
  ARRAY['case_execution_finish_record_documents','content_version_id'],
  ARRAY['case_judgment_record_documents','content_version_id'],
  ARRAY['case_closure_record_documents','content_version_id'],
  ARRAY['material_references','content_version_id'],
  ARRAY['case_complaint_confirmations','confirmed_complaint_content_version_id'],
  ARRAY['case_filing_versions','content_version_id'],
  ARRAY['case_acceptance_versions','content_version_id'],
  ARRAY['case_second_instance_progress_versions','content_version_id'],
  ARRAY['case_second_instance_result_versions','content_version_id'],
  ARRAY['case_execution_submission_versions','content_version_id'],
  ARRAY['case_execution_confirmation_versions','content_version_id'],
  ARRAY['notary_matter_materials','content_version_id']
];
BEGIN
  FOREACH item SLICE 1 IN ARRAY consumers LOOP
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE ON %I
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_section_upload_consumption(%L)',
      'section_upload_consumer_'||item[1],item[1],item[2]);
  END LOOP;
END; $$;

-- File lifecycle remains unchanged; an uploaded version cannot move to another
-- case, department or material purpose while retaining its original draft context.
CREATE FUNCTION "guard_section_upload_material_binding"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."id",NEW."owner_type",NEW."owner_id",NEW."department_id",NEW."category",NEW."purpose")
    IS DISTINCT FROM (OLD."id",OLD."owner_type",OLD."owner_id",OLD."department_id",OLD."category",OLD."purpose")
    AND EXISTS (SELECT 1 FROM "content_versions" WHERE "material_id"=OLD."id" AND "case_section_record_upload_draft_id" IS NOT NULL) THEN
    RAISE EXCEPTION 'section upload material binding is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "section_upload_material_binding" BEFORE UPDATE ON "materials"
  FOR EACH ROW EXECUTE FUNCTION "guard_section_upload_material_binding"();

-- Only the current version's genuine same-scope frozen fact excludes an item
-- from a dedicated pending upload pool. A material's older frozen history cannot.
CREATE FUNCTION "case_section_upload_current_is_frozen"(p_material uuid,p_case uuid,p_department uuid,p_category text)
RETURNS boolean LANGUAGE sql STABLE AS $$
WITH frozen AS (
  SELECT d."material_id",d."content_version_id",d."case_id",d."department_id",c."audit_event_id",
    'EXECUTION_FILING_PROOF'::text AS category,ARRAY['case.execution.filing.submitted']::text[] AS actions
    FROM "case_execution_filing_versions" d JOIN "case_execution_filings" c ON c."id"=d."filing_id" AND c."case_id"=d."case_id" AND c."department_id"=d."department_id"
  UNION ALL
  SELECT d."material_id",d."content_version_id",d."case_id",d."department_id",c."audit_event_id",
    'EXECUTION_FILING_PROOF',ARRAY['case.execution.filing.record-corrected']::text[]
    FROM "case_execution_filing_record_documents" d JOIN "case_execution_filing_record_corrections" c ON c."id"=d."correction_id" AND c."case_id"=d."case_id" AND c."department_id"=d."department_id"
  UNION ALL
  SELECT d."material_id",d."content_version_id",d."case_id",d."department_id",c."audit_event_id",
    'EXECUTION_FINISH_BASIS',ARRAY['case.execution.finished']::text[]
    FROM "case_execution_finish_versions" d JOIN "case_execution_finishes" c ON c."id"=d."finish_id" AND c."case_id"=d."case_id" AND c."department_id"=d."department_id"
  UNION ALL
  SELECT d."material_id",d."content_version_id",d."case_id",d."department_id",c."audit_event_id",
    'EXECUTION_FINISH_BASIS',ARRAY['case.execution.finish.record-corrected']::text[]
    FROM "case_execution_finish_record_documents" d JOIN "case_execution_finish_record_corrections" c ON c."id"=d."correction_id" AND c."case_id"=d."case_id" AND c."department_id"=d."department_id"
  UNION ALL
  SELECT d."material_id",d."content_version_id",d."case_id",d."department_id",c."audit_event_id",
    'CASE_CLOSURE_DOCUMENT',ARRAY['case.closure.recorded','case.closure.corrected']::text[]
    FROM "case_closure_documents" d JOIN "case_closure_versions" c ON c."id"=d."closure_version_id" AND c."case_id"=d."case_id" AND c."department_id"=d."department_id"
  UNION ALL
  SELECT d."material_id",d."content_version_id",d."case_id",d."department_id",c."audit_event_id",
    'CASE_CLOSURE_DOCUMENT',ARRAY['case.closure.record-corrected']::text[]
    FROM "case_closure_record_documents" d JOIN "case_closure_record_corrections" c ON c."id"=d."correction_id" AND c."case_id"=d."case_id" AND c."department_id"=d."department_id"
)
SELECT EXISTS (
  SELECT 1 FROM "materials" m JOIN "content_versions" v ON v."material_id"=m."id" AND v."id"=m."current_version_id"
  JOIN frozen f ON f."material_id"=m."id" AND f."content_version_id"=v."id" AND f."case_id"=p_case AND f."department_id"=p_department AND f.category=p_category
  JOIN "material_references" r ON r."material_id"=m."id" AND r."content_version_id"=v."id" AND r."department_id"=p_department AND r."resource_type"='case' AND r."resource_id"=p_case AND r."purpose"=p_category AND r."action_event_id"=f."audit_event_id" AND r."asset_version_id" IS NULL
  JOIN "audit_events" a ON a."id"=r."action_event_id" AND a."department_id"=p_department AND a."resource_type"='CASE' AND a."resource_id"=p_case AND a."action"=ANY(f.actions)
  WHERE m."id"=p_material AND m."owner_type"='CASE' AND m."owner_id"=p_case AND m."department_id"=p_department AND m."category"::text=p_category AND m."purpose"=p_category AND m."status"='ACTIVE' AND m."deleted_at" IS NULL AND v."status"='AVAILABLE'
);
$$;

COMMIT;
