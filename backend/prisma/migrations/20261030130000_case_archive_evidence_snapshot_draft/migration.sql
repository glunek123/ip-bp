-- DRAFT ONLY: evidence capture is NOT archive authorization. No history backfill.
-- Current financial truth may change later; this immutable set preserves what was
-- selected at archive time. Missing historical snapshots must display UNKNOWN.
-- Real authorization, calculator provenance and shared writer lock protocol are
-- still absent. Consequently this draft can ONLY claim UNKNOWN, never PASSED.
-- REQUIRED CALL ORDER (not implemented by an adapter): process each case in its
-- own transaction; keep snapshot completeness constraints DEFERRED while building.
-- Prepare ALL source facts first, insert parent then ALL payment/allocation items,
-- then switch the related constraints to IMMEDIATE once to validate the full set.
-- Building a nonempty snapshot row-by-row under IMMEDIATE is NOT supported:
-- the parent/first item can correctly fail before remaining items are present.
-- The source-order guard is transaction-wide, including OTHER cases. Never start
-- preparing another case's sources after creating a snapshot. If callers cannot
-- guarantee this order, keep the write gate closed. No batch workflow is enabled.
BEGIN;
CREATE TABLE "case_archive_evidence_snapshots" (
 "id" uuid PRIMARY KEY, "archive_version_id" uuid NOT NULL UNIQUE,
 "case_id" uuid NOT NULL, "department_id" uuid NOT NULL, "closure_version_id" uuid NOT NULL,
 "refund_inventory_version_id" uuid, "settlement_assessment_version_id" uuid,
 "consolidation_id" uuid, "source_case_ids" uuid[] NOT NULL,
 "readiness" varchar(16) NOT NULL DEFAULT 'UNKNOWN' CHECK ("readiness"='UNKNOWN'),
 "payment_readiness" varchar(16) NOT NULL DEFAULT 'UNKNOWN' CHECK ("payment_readiness"='UNKNOWN'),
 "refund_readiness" varchar(16) NOT NULL DEFAULT 'UNKNOWN' CHECK ("refund_readiness"='UNKNOWN'),
 "customer_readiness" varchar(16) NOT NULL DEFAULT 'UNKNOWN' CHECK ("customer_readiness"='UNKNOWN'),
 "lawyer_readiness" varchar(16) NOT NULL DEFAULT 'UNKNOWN' CHECK ("lawyer_readiness"='UNKNOWN'),
 "captured_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "creation_xid" xid8 NOT NULL DEFAULT pg_current_xact_id(),
 UNIQUE ("id","case_id","department_id"),
 FOREIGN KEY ("archive_version_id","case_id","department_id") REFERENCES "case_archive_versions"("id","case_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("closure_version_id","case_id","department_id") REFERENCES "case_closure_versions"("id","case_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("refund_inventory_version_id","case_id","department_id") REFERENCES "case_refund_inventory_versions"("id","case_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("settlement_assessment_version_id","case_id","department_id") REFERENCES "case_settlement_assessment_versions"("id","case_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("consolidation_id","department_id") REFERENCES "case_consolidations"("id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE TABLE "case_archive_snapshot_payments" (
 "snapshot_id" uuid NOT NULL REFERENCES "case_archive_evidence_snapshots"("id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "payment_version_id" uuid NOT NULL REFERENCES "case_closure_payment_versions"("id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 PRIMARY KEY ("snapshot_id","payment_version_id")
);
CREATE TABLE "case_archive_snapshot_allocations" (
 "snapshot_id" uuid NOT NULL REFERENCES "case_archive_evidence_snapshots"("id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 "allocation_id" uuid NOT NULL REFERENCES "case_settlement_actual_allocations"("id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 PRIMARY KEY ("snapshot_id","allocation_id")
);
CREATE FUNCTION "guard_case_archive_evidence_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'archive evidence snapshot is immutable' USING ERRCODE='23514'; END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'archive snapshot requires serializable transaction' USING ERRCODE='23514'; END IF;
 NEW."creation_xid":=pg_current_xact_id();
 NEW."captured_at":=CURRENT_TIMESTAMP;
 -- Never attach current evidence to an old archive. Initial archive must be
 -- created in this transaction, not an old ARCHIVE or later CORRECT version.
 IF NOT EXISTS (SELECT 1 FROM "case_archive_versions" a
  WHERE a."id"=NEW."archive_version_id" AND a."case_id"=NEW."case_id"
   AND a."department_id"=NEW."department_id" AND a."kind"='ARCHIVE'
   AND a."prior_version_id" IS NULL AND a."closure_version_id"=NEW."closure_version_id"
   AND a.xmin=pg_current_xact_id()::text::xid)
 THEN RAISE EXCEPTION 'snapshot requires transaction-local initial archive' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_archive_evidence_snapshot_guard" BEFORE INSERT OR UPDATE OR DELETE ON "case_archive_evidence_snapshots" FOR EACH ROW EXECUTE FUNCTION "guard_case_archive_evidence_snapshot"();
CREATE FUNCTION "guard_case_archive_snapshot_item"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'archive snapshot items are immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "case_archive_evidence_snapshots" s
  WHERE s."id"=NEW."snapshot_id" AND s."creation_xid"=pg_current_xact_id())
 THEN RAISE EXCEPTION 'archive snapshot cannot receive later evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_archive_snapshot_payment_guard" BEFORE INSERT OR UPDATE OR DELETE ON "case_archive_snapshot_payments" FOR EACH ROW EXECUTE FUNCTION "guard_case_archive_snapshot_item"();
CREATE TRIGGER "case_archive_snapshot_allocation_guard" BEFORE INSERT OR UPDATE OR DELETE ON "case_archive_snapshot_allocations" FOR EACH ROW EXECUTE FUNCTION "guard_case_archive_snapshot_item"();
-- Deferred validation sees the entire parent/child set, then the transaction
-- seals it. Any failing completeness check rolls back the complete snapshot.
CREATE FUNCTION "validate_case_archive_evidence_snapshot"(snapshot_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE snapshot "case_archive_evidence_snapshots"%ROWTYPE; expected_cases uuid[]; actual_consolidation uuid; refund_id uuid; assessment_id uuid;
BEGIN
 SELECT * INTO snapshot FROM "case_archive_evidence_snapshots" WHERE "id"=snapshot_id;
 IF snapshot."id" IS NULL THEN RAISE EXCEPTION 'archive snapshot missing' USING ERRCODE='23514'; END IF;
 SELECT c."id" INTO actual_consolidation FROM "case_consolidations" c
  WHERE c."main_case_id"=snapshot."case_id" AND c."department_id"=snapshot."department_id";
 SELECT array_agg(q."case_id" ORDER BY q."case_id") INTO expected_cases FROM (
  SELECT snapshot."case_id" AS "case_id"
  UNION SELECT m."case_id" FROM "case_consolidation_members" m
   WHERE m."consolidation_id"=actual_consolidation AND m."department_id"=snapshot."department_id"
 ) q;
 IF snapshot."consolidation_id" IS DISTINCT FROM actual_consolidation
  OR snapshot."source_case_ids" IS DISTINCT FROM expected_cases
 THEN RAISE EXCEPTION 'archive snapshot requires exact main and original case scope' USING ERRCODE='23514'; END IF;
 -- Establish deterministic case lock order. Future adapters must also make
 -- EVERY competing payment/refund/terms/allocation writer use this protocol.
 PERFORM 1 FROM "cases" c WHERE c."id"=ANY(expected_cases)
  AND c."department_id"=snapshot."department_id" ORDER BY c."id" FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM "case_closures" c WHERE c."case_id"=snapshot."case_id"
  AND c."department_id"=snapshot."department_id" AND c."current_version_id"=snapshot."closure_version_id")
 THEN RAISE EXCEPTION 'archive snapshot closure is not current' USING ERRCODE='23514'; END IF;
 SELECT v."id" INTO refund_id FROM "case_refund_inventory_versions" v
  WHERE v."case_id"=snapshot."case_id" AND v."department_id"=snapshot."department_id"
   AND NOT EXISTS (SELECT 1 FROM "case_refund_inventory_versions" n WHERE n."prior_version_id"=v."id");
 SELECT v."id" INTO assessment_id FROM "case_settlement_assessment_versions" v
  WHERE v."case_id"=snapshot."case_id" AND v."department_id"=snapshot."department_id"
   AND NOT EXISTS (SELECT 1 FROM "case_settlement_assessment_versions" n WHERE n."prior_version_id"=v."id");
 IF snapshot."refund_inventory_version_id" IS DISTINCT FROM refund_id
  OR snapshot."settlement_assessment_version_id" IS DISTINCT FROM assessment_id
  OR EXISTS (SELECT 1 FROM "case_settlement_assessment_versions" v WHERE v."id"=assessment_id
   AND v."closure_version_id"<>snapshot."closure_version_id")
 THEN RAISE EXCEPTION 'archive snapshot requires current exact financial versions' USING ERRCODE='23514'; END IF;
 -- Bidirectional set comparison rejects omissions, obsolete/void versions,
 -- foreign-case rows and duplicate logical payment revisions.
 IF EXISTS (
  (SELECT p."id" FROM "case_closure_payment_versions" p
   WHERE p."case_id"=snapshot."case_id" AND p."department_id"=snapshot."department_id" AND p."state"='ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM "case_closure_payment_versions" n WHERE n."prior_version_id"=p."id")
   EXCEPT SELECT s."payment_version_id" FROM "case_archive_snapshot_payments" s WHERE s."snapshot_id"=snapshot."id")
  UNION ALL
  (SELECT s."payment_version_id" FROM "case_archive_snapshot_payments" s WHERE s."snapshot_id"=snapshot."id"
   EXCEPT SELECT p."id" FROM "case_closure_payment_versions" p
   WHERE p."case_id"=snapshot."case_id" AND p."department_id"=snapshot."department_id" AND p."state"='ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM "case_closure_payment_versions" n WHERE n."prior_version_id"=p."id"))
 ) THEN RAISE EXCEPTION 'archive snapshot payment set is incomplete or invalid' USING ERRCODE='23514'; END IF;
 -- Count the allocation ID once, not the full source fact once per case.
 -- Main-case assessment amounts already include originals and are not summed.
 IF EXISTS (
  (SELECT a."id" FROM "case_settlement_actual_allocations" a WHERE a."case_id"=ANY(expected_cases) AND a."department_id"=snapshot."department_id"
   EXCEPT SELECT s."allocation_id" FROM "case_archive_snapshot_allocations" s WHERE s."snapshot_id"=snapshot."id")
  UNION ALL
  (SELECT s."allocation_id" FROM "case_archive_snapshot_allocations" s WHERE s."snapshot_id"=snapshot."id"
   EXCEPT SELECT a."id" FROM "case_settlement_actual_allocations" a WHERE a."case_id"=ANY(expected_cases) AND a."department_id"=snapshot."department_id")
 ) THEN RAISE EXCEPTION 'archive snapshot allocation set is incomplete or invalid' USING ERRCODE='23514'; END IF;
 RETURN;
END; $$;
CREATE FUNCTION "check_case_archive_evidence_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='case_archive_evidence_snapshots' THEN
  PERFORM validate_case_archive_evidence_snapshot(NEW."id");
 ELSE
  PERFORM validate_case_archive_evidence_snapshot(NEW."snapshot_id");
 END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_archive_evidence_snapshot_complete" AFTER INSERT ON "case_archive_evidence_snapshots" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_archive_evidence_snapshot"();
CREATE CONSTRAINT TRIGGER "case_archive_snapshot_payment_complete" AFTER INSERT ON "case_archive_snapshot_payments" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_archive_evidence_snapshot"();
CREATE CONSTRAINT TRIGGER "case_archive_snapshot_allocation_complete" AFTER INSERT ON "case_archive_snapshot_allocations" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_archive_evidence_snapshot"();
-- An IMMEDIATE constraint can run before later statements in this transaction.
-- Once evidence capture starts, freeze all relevant source writes in this
-- transaction. This conservative draft requires batch callers to prepare ALL
-- sources before creating ANY snapshot; this round uses independent per-case
-- transactions, not a batch workflow, and does not claim cross-case write freedom.
CREATE FUNCTION "guard_archive_snapshot_source_order"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "case_archive_evidence_snapshots" s
  WHERE s."creation_xid"=pg_current_xact_id())
 THEN RAISE EXCEPTION 'archive sources cannot change after snapshot capture' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
DO $source_guards$
DECLARE source_table text;
BEGIN
 FOREACH source_table IN ARRAY ARRAY[
  'case_closures','case_closure_versions','case_closure_payment_versions','case_closure_payment_documents','case_refund_inventory_versions',
  'case_refund_inventory_items','case_settlement_assessment_versions','case_settlement_terms',
  'settlement_actual_facts','settlement_actual_source_supplements','case_settlement_actual_allocations',
  'case_consolidations','case_consolidation_members'
 ] LOOP
  EXECUTE format('CREATE TRIGGER archive_snapshot_source_order BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_archive_snapshot_source_order()',source_table);
 END LOOP;
END; $source_guards$;
CREATE FUNCTION "guard_case_archive_snapshot_draft"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'archive evidence snapshot persistence is draft and not enabled' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER "case_archive_snapshot_draft_gate" BEFORE INSERT OR UPDATE OR DELETE ON "case_archive_evidence_snapshots" FOR EACH ROW EXECUTE FUNCTION "guard_case_archive_snapshot_draft"();
CREATE TRIGGER "case_archive_snapshot_payment_draft_gate" BEFORE INSERT OR UPDATE OR DELETE ON "case_archive_snapshot_payments" FOR EACH ROW EXECUTE FUNCTION "guard_case_archive_snapshot_draft"();
CREATE TRIGGER "case_archive_snapshot_allocation_draft_gate" BEFORE INSERT OR UPDATE OR DELETE ON "case_archive_snapshot_allocations" FOR EACH ROW EXECUTE FUNCTION "guard_case_archive_snapshot_draft"();
COMMIT;
