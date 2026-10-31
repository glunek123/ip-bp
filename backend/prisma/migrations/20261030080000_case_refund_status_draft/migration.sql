-- DRAFT ONLY: not executed, no API, no historical import. All writes remain closed.
-- A version is a complete case inventory snapshot, not an application or fee refund.
-- UNKNOWN means inventory completeness is unconfirmed. Item/object changes must
-- first create UNKNOWN. Status-only changes preserve existing COMPLETE confirmation.
-- NOT_APPLICABLE is an explicit zero-item declaration, never inferred from absence.
BEGIN;
CREATE TABLE "case_refund_inventory_versions" (
 "id" uuid PRIMARY KEY, "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
 "revision" integer NOT NULL CHECK ("revision">0), "prior_version_id" uuid UNIQUE,
 "declaration" varchar(20) NOT NULL CHECK ("declaration" IN ('UNKNOWN','COMPLETE','NOT_APPLICABLE')),
 "recorded_by_user_id" uuid NOT NULL, "recorded_at" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "audit_event_id" uuid NOT NULL UNIQUE, "creation_xid" xid8 NOT NULL DEFAULT pg_current_xact_id(),
 UNIQUE ("case_id","revision"), UNIQUE ("id","case_id","department_id"),
 CHECK (("revision"=1 AND "prior_version_id" IS NULL) OR ("revision">1 AND "prior_version_id" IS NOT NULL)),
 FOREIGN KEY ("case_id","department_id") REFERENCES "cases"("id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("prior_version_id","case_id","department_id") REFERENCES "case_refund_inventory_versions"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("recorded_by_user_id","department_id") REFERENCES "department_memberships"("user_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY ("audit_event_id") REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE TABLE "case_refund_inventory_items" (
 "inventory_version_id" uuid NOT NULL, "item_id" uuid NOT NULL,
 "case_id" uuid NOT NULL, "department_id" uuid NOT NULL,
 "party" varchar(16) NOT NULL CHECK ("party" IN ('COURT','DEFENDANT')),
 "status" varchar(24) NOT NULL CHECK ("status" IN ('UNKNOWN','PENDING','SUBMITTED','RETURNED_UNSETTLED','SETTLED','RECEIVED','CONVERTED_TO_COST')),
 "description" varchar(1000) NOT NULL CHECK (length(btrim("description"))>0),
 PRIMARY KEY ("inventory_version_id","item_id"),
 CHECK ("status"<>'CONVERTED_TO_COST' OR "party"='DEFENDANT'),
 FOREIGN KEY ("inventory_version_id","case_id","department_id") REFERENCES "case_refund_inventory_versions"("id","case_id","department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
-- Permanent guards are independent from the temporary closed-write gate.
CREATE FUNCTION "guard_case_refund_inventory_version"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous "case_refund_inventory_versions"%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'refund inventory history is immutable' USING ERRCODE='23514';
 END IF;
 NEW."creation_xid" := pg_current_xact_id();
 PERFORM 1 FROM "cases" WHERE "id"=NEW."case_id" AND "department_id"=NEW."department_id" FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'refund inventory case missing' USING ERRCODE='23514'; END IF;
 IF NEW."revision">1 THEN
  SELECT * INTO previous FROM "case_refund_inventory_versions" WHERE "id"=NEW."prior_version_id" FOR UPDATE;
  IF previous."id" IS NULL OR previous."case_id"<>NEW."case_id"
   OR previous."department_id"<>NEW."department_id" OR previous."revision"+1<>NEW."revision"
   OR previous."recorded_at">NEW."recorded_at"
   OR EXISTS (SELECT 1 FROM "case_refund_inventory_versions" n WHERE n."prior_version_id"=previous."id") THEN
   RAISE EXCEPTION 'refund inventory requires latest consecutive version' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW."declaration"='COMPLETE' AND (previous."id" IS NULL OR previous."declaration" NOT IN ('UNKNOWN','COMPLETE')) THEN
  RAISE EXCEPTION 'complete inventory requires preceding inventory with the same item scope' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id"
  AND a."department_id"=NEW."department_id" AND a."actor_kind"='HUMAN'
  AND a."actor_user_id"=NEW."recorded_by_user_id"
  AND a."internal_actor_user_id"=NEW."recorded_by_user_id"
  AND a."resource_type"='CASE_REFUND_INVENTORY_VERSION' AND a."resource_id"=NEW."id"
  AND a."action"=CASE WHEN NEW."declaration"='UNKNOWN' OR (NEW."declaration"='COMPLETE' AND previous."declaration"='COMPLETE') THEN 'CASE_REFUND_INVENTORY_RECORD'
   ELSE 'CASE_REFUND_INVENTORY_CONFIRM' END) THEN
  RAISE EXCEPTION 'refund inventory requires exact internal actor audit' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_refund_inventory_version_guard" BEFORE INSERT OR UPDATE OR DELETE ON "case_refund_inventory_versions" FOR EACH ROW EXECUTE FUNCTION "guard_case_refund_inventory_version"();
-- Items can only be added in the same transaction as their parent snapshot.
-- A deferred validator below sees all rows before accepting a declaration.
CREATE FUNCTION "guard_case_refund_inventory_item"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'refund inventory items are immutable' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (SELECT 1 FROM "case_refund_inventory_versions" v
  WHERE v."id"=NEW."inventory_version_id" AND v."creation_xid"=pg_current_xact_id()) THEN
  RAISE EXCEPTION 'refund inventory snapshot cannot receive later items' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "case_refund_inventory_item_guard" BEFORE INSERT OR UPDATE OR DELETE ON "case_refund_inventory_items" FOR EACH ROW EXECUTE FUNCTION "guard_case_refund_inventory_item"();
CREATE FUNCTION "validate_case_refund_inventory_snapshot"(version_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE inventory "case_refund_inventory_versions"%ROWTYPE;
BEGIN
 SELECT * INTO STRICT inventory FROM "case_refund_inventory_versions" WHERE "id"=version_id;
 IF inventory."declaration"='NOT_APPLICABLE' AND EXISTS
  (SELECT 1 FROM "case_refund_inventory_items" i WHERE i."inventory_version_id"=inventory."id") THEN
  RAISE EXCEPTION 'not applicable refund inventory must contain zero items' USING ERRCODE='23514';
 END IF;
 IF inventory."declaration"='COMPLETE' THEN
  IF NOT EXISTS (SELECT 1 FROM "case_refund_inventory_items" i WHERE i."inventory_version_id"=inventory."id") THEN
   RAISE EXCEPTION 'empty refund inventory needs explicit not applicable declaration' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
   (SELECT "item_id","party","description" FROM "case_refund_inventory_items" WHERE "inventory_version_id"=inventory."id"
    EXCEPT SELECT "item_id","party","description" FROM "case_refund_inventory_items" WHERE "inventory_version_id"=inventory."prior_version_id")
   UNION ALL
   (SELECT "item_id","party","description" FROM "case_refund_inventory_items" WHERE "inventory_version_id"=inventory."prior_version_id"
    EXCEPT SELECT "item_id","party","description" FROM "case_refund_inventory_items" WHERE "inventory_version_id"=inventory."id")
  ) THEN
   RAISE EXCEPTION 'inventory changes require a new UNKNOWN version before confirmation' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN;
END; $$;
CREATE FUNCTION "check_case_refund_inventory_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM "validate_case_refund_inventory_snapshot"(NEW."id");
 RETURN NEW;
END; $$;
CREATE FUNCTION "check_case_refund_inventory_item_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM "validate_case_refund_inventory_snapshot"(NEW."inventory_version_id");
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "case_refund_inventory_snapshot_check" AFTER INSERT ON "case_refund_inventory_versions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_refund_inventory_snapshot"();
CREATE CONSTRAINT TRIGGER "case_refund_inventory_item_snapshot_check" AFTER INSERT ON "case_refund_inventory_items" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_refund_inventory_item_snapshot"();
-- Latest snapshot only: old complete declarations never approve new UNKNOWN edits.
-- Display-only draft projection. A future archive command must lock each source case,
-- re-read current versions, validate authorization and bind exact versions in its audit.
CREATE VIEW "case_refund_inventory_readiness_draft" AS
SELECT v."id" AS "inventory_version_id",v."case_id",v."department_id",v."revision",
 CASE WHEN v."declaration"='NOT_APPLICABLE' THEN 'PASSED'
 WHEN v."declaration"='UNKNOWN' THEN 'UNKNOWN'
 WHEN EXISTS (SELECT 1 FROM "case_refund_inventory_items" i WHERE i."inventory_version_id"=v."id"
  AND i."status" NOT IN ('UNKNOWN','RECEIVED','CONVERTED_TO_COST')) THEN 'BLOCKED'
 WHEN EXISTS (SELECT 1 FROM "case_refund_inventory_items" i WHERE i."inventory_version_id"=v."id" AND i."status"='UNKNOWN') THEN 'UNKNOWN'
 ELSE 'PASSED' END AS "readiness"
FROM "case_refund_inventory_versions" v
WHERE NOT EXISTS (SELECT 1 FROM "case_refund_inventory_versions" n WHERE n."prior_version_id"=v."id");
CREATE FUNCTION "guard_case_refund_inventory_draft"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'refund inventory persistence is draft and not enabled' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER "case_refund_inventory_draft_gate" BEFORE INSERT OR UPDATE OR DELETE ON "case_refund_inventory_versions" FOR EACH ROW EXECUTE FUNCTION "guard_case_refund_inventory_draft"();
CREATE TRIGGER "case_refund_inventory_item_draft_gate" BEFORE INSERT OR UPDATE OR DELETE ON "case_refund_inventory_items" FOR EACH ROW EXECUTE FUNCTION "guard_case_refund_inventory_draft"();
COMMIT;
