-- DRAFT ONLY. No backfill: historical payment type stays unknown.
BEGIN;
ALTER TABLE "case_closure_versions" ADD COLUMN "payment_type" varchar(16);
ALTER TABLE "case_closure_versions" ADD CONSTRAINT "closure_payment_type_values" CHECK ("payment_type" IS NULL OR "payment_type" IN ('ONE_TIME','INSTALLMENTS'));
CREATE FUNCTION "guard_case_closure_payment_type_draft"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."payment_type" IS NOT NULL THEN
  RAISE EXCEPTION 'typed closure payment command is draft and not enabled' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "closure_payment_type_draft_guard" BEFORE INSERT OR UPDATE ON "case_closure_versions" FOR EACH ROW EXECUTE FUNCTION "guard_case_closure_payment_type_draft"();
-- Future command contract: SERIALIZABLE transaction with retries, case lock first,
-- append closure version and payments, move head, then deferred validation.
-- Serializable isolation also rejects stale snapshots that case locks cannot refresh.
CREATE FUNCTION "check_case_closure_effective_payment_type"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; selected_type text; selected_version uuid; active_count bigint;
BEGIN
 target_case:=NEW."case_id"; target_department:=NEW."department_id";
 PERFORM 1 FROM "cases" WHERE "id"=target_case AND "department_id"=target_department FOR UPDATE;
 SELECT v."payment_type",v."id" INTO selected_type,selected_version
 FROM "case_closures" c JOIN "case_closure_versions" v ON v."id"=c."current_version_id"
 WHERE c."case_id"=target_case AND c."department_id"=target_department;
 IF TG_TABLE_NAME='case_closure_payment_versions' THEN
 IF
  (selected_type IS NULL OR NEW."closure_version_id" IS DISTINCT FROM selected_version) THEN
  RAISE EXCEPTION 'payment requires exact current typed closure version' USING ERRCODE='23514';
 END IF;
 END IF;
 -- History remains unknown only until the first explicit selection. An old
 -- correction command cannot erase a known type by creating a null-typed head.
 IF selected_type IS NULL THEN
  IF EXISTS (SELECT 1 FROM "case_closure_versions" known
   WHERE known."case_id"=target_case AND known."department_id"=target_department
   AND known."payment_type" IS NOT NULL) THEN
   RAISE EXCEPTION 'known payment type cannot become unknown' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'typed payments require serializable transaction' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO active_count FROM "case_closure_payment_versions" p
 WHERE p."case_id"=target_case AND p."department_id"=target_department AND p."state"='ACTIVE'
 AND NOT EXISTS (SELECT 1 FROM "case_closure_payment_versions" n WHERE n."prior_version_id"=p."id");
 IF selected_type='ONE_TIME' AND active_count>1 THEN
  RAISE EXCEPTION 'one time payment permits at most one effective payment' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER "closure_payment_effective_count" AFTER INSERT OR UPDATE ON "case_closures" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_closure_effective_payment_type"();
CREATE CONSTRAINT TRIGGER "closure_payment_version_effective_count" AFTER INSERT ON "case_closure_payment_versions" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "check_case_closure_effective_payment_type"();
COMMIT;


