-- DRAFT ONLY: no backfill, no registered adapter, no enabled writes.
BEGIN;
CREATE TABLE "case_refund_inventory_receipts" (
 "id" uuid PRIMARY KEY, "department_id" uuid NOT NULL, "actor_user_id" uuid NOT NULL,
 "case_id" uuid NOT NULL, "inventory_version_id" uuid NOT NULL UNIQUE,
 "audit_event_id" uuid NOT NULL UNIQUE, "idempotency_key" varchar(128) NOT NULL,
 "request_fingerprint" char(64) NOT NULL, "result_snapshot" jsonb NOT NULL,
 "created_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("department_id","actor_user_id","idempotency_key"),
 CHECK (length("idempotency_key")>0 AND "idempotency_key" !~ '^\s|\s$'),
 CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
 CHECK (jsonb_typeof("result_snapshot")='object'),
 FOREIGN KEY ("inventory_version_id","case_id","department_id") REFERENCES "case_refund_inventory_versions"("id","case_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("actor_user_id","department_id") REFERENCES "department_memberships"("user_id","department_id") ON UPDATE RESTRICT ON DELETE RESTRICT,
 FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON UPDATE RESTRICT ON DELETE RESTRICT
);
CREATE FUNCTION "check_case_refund_inventory_receipt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v "case_refund_inventory_versions"%ROWTYPE; a "audit_events"%ROWTYPE;
 expected_items jsonb; supplied_items jsonb; readiness text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'refund receipts are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO STRICT v FROM "case_refund_inventory_versions" WHERE "id"=NEW."inventory_version_id";
 SELECT * INTO STRICT a FROM "audit_events" WHERE "id"=NEW."audit_event_id";
 IF v."case_id"<>NEW."case_id" OR v."department_id"<>NEW."department_id"
  OR v."recorded_by_user_id"<>NEW."actor_user_id" OR v."audit_event_id"<>NEW."audit_event_id"
  OR NEW."created_at"<v."recorded_at" OR a."department_id"<>NEW."department_id"
  OR a."actor_kind"<>'HUMAN' OR a."actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
  OR a."internal_actor_user_id" IS DISTINCT FROM NEW."actor_user_id"
  OR a."resource_type"<>'CASE_REFUND_INVENTORY_VERSION' OR a."resource_id"<>v."id"
  OR a."action" NOT IN ('CASE_REFUND_INVENTORY_RECORD','CASE_REFUND_INVENTORY_CONFIRM')
  OR (a."details"->>'requestFingerprint') IS DISTINCT FROM NEW."request_fingerprint"::text THEN
  RAISE EXCEPTION 'refund receipt requires exact inventory actor and audit' USING ERRCODE='23514';
 END IF;
 PERFORM "validate_case_refund_inventory_snapshot"(v."id");
 SELECT coalesce(jsonb_agg(jsonb_build_object('itemId',i."item_id",'party',i."party",'status',i."status",'description',i."description") ORDER BY i."item_id"::text),'[]'::jsonb)
 INTO expected_items FROM "case_refund_inventory_items" i WHERE i."inventory_version_id"=v."id";
 IF jsonb_typeof(NEW."result_snapshot"#>'{snapshot,items}') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'refund receipt items missing' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(value ORDER BY value->>'itemId'),'[]'::jsonb) INTO supplied_items
 FROM jsonb_array_elements(NEW."result_snapshot"#>'{snapshot,items}');
 readiness := CASE WHEN v."declaration"='NOT_APPLICABLE' THEN 'PASSED'
 WHEN v."declaration"='UNKNOWN' THEN 'UNKNOWN'
 WHEN EXISTS (SELECT 1 FROM "case_refund_inventory_items" WHERE "inventory_version_id"=v."id" AND "status" NOT IN ('UNKNOWN','RECEIVED','CONVERTED_TO_COST')) THEN 'BLOCKED'
 WHEN EXISTS (SELECT 1 FROM "case_refund_inventory_items" WHERE "inventory_version_id"=v."id" AND "status"='UNKNOWN') THEN 'UNKNOWN' ELSE 'PASSED' END;
 IF supplied_items IS DISTINCT FROM expected_items OR NEW."result_snapshot" IS DISTINCT FROM jsonb_build_object(
  'draft',true,'readiness',readiness,'snapshot',jsonb_build_object('id',v."id",'caseId',v."case_id",'departmentId',v."department_id",'revision',v."revision",'declaration',v."declaration",'items',NEW."result_snapshot"#>'{snapshot,items}')) THEN
  RAISE EXCEPTION 'refund receipt result must match exact immutable snapshot' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
-- Construct parent, then all items, then receipt. Receipt insertion seals the
-- snapshot immediately, independently of deferred checks or SET CONSTRAINTS.
-- Item insertion is already restricted to its parent's creation transaction;
-- therefore another transaction cannot race an item into a sealed snapshot.
CREATE FUNCTION "guard_case_refund_inventory_receipt_seal"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "case_refund_inventory_receipts" r WHERE r."inventory_version_id"=NEW."inventory_version_id") THEN
  RAISE EXCEPTION 'refund receipt seals inventory against later items' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "refund_inventory_receipt_item_seal" BEFORE INSERT ON "case_refund_inventory_items" FOR EACH ROW EXECUTE FUNCTION "guard_case_refund_inventory_receipt_seal"();
-- Deferred validation observes the entire snapshot, including same-transaction items.
CREATE CONSTRAINT TRIGGER "refund_inventory_receipt_consistency" AFTER INSERT OR UPDATE OR DELETE ON "case_refund_inventory_receipts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_refund_inventory_receipt"();
CREATE TRIGGER "refund_inventory_receipt_draft_gate" BEFORE INSERT OR UPDATE OR DELETE ON "case_refund_inventory_receipts" FOR EACH ROW EXECUTE FUNCTION "guard_case_refund_inventory_draft"();
COMMIT;
