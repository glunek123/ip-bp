BEGIN;

ALTER TABLE "cases" ADD CONSTRAINT "cases_handling_group_customer_key" UNIQUE ("id", "customer_id", "department_id");

CREATE TABLE "case_handling_groups" (
  "id" UUID PRIMARY KEY,
  "department_id" UUID NOT NULL REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  "customer_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "status" VARCHAR(16) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL,
  "dissolved_at" TIMESTAMPTZ(3),
  UNIQUE ("id", "department_id"),
  UNIQUE ("id", "customer_id", "department_id"),
  FOREIGN KEY ("customer_id", "department_id") REFERENCES "customers"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (("revision" = 1 AND "status" = 'ACTIVE' AND "dissolved_at" IS NULL)
    OR ("revision" = 2 AND "status" = 'DISSOLVED' AND "dissolved_at" IS NOT NULL))
);
CREATE INDEX "case_handling_groups_department_id_created_at_id_idx" ON "case_handling_groups"("department_id", "created_at", "id");

CREATE TABLE "case_handling_group_members" (
  "group_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  PRIMARY KEY ("group_id", "case_id"),
  FOREIGN KEY ("group_id", "customer_id", "department_id") REFERENCES "case_handling_groups"("id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("case_id", "customer_id", "department_id") REFERENCES "cases"("id", "customer_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "case_handling_group_members_case_id_department_id_idx" ON "case_handling_group_members"("case_id", "department_id");

CREATE TABLE "case_handling_group_events" (
  "id" UUID PRIMARY KEY,
  "group_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "before_case_ids" UUID[] NOT NULL,
  "after_case_ids" UUID[] NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "actor_display_name_snapshot" TEXT NOT NULL CHECK (length(btrim("actor_display_name_snapshot")) > 0),
  "recorded_at" TIMESTAMPTZ(3) NOT NULL,
  "audit_event_id" UUID NOT NULL UNIQUE REFERENCES "audit_events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  UNIQUE ("group_id", "revision"),
  CONSTRAINT "cg_event_scope_key" UNIQUE ("id", "group_id", "department_id"),
  FOREIGN KEY ("group_id", "department_id") REFERENCES "case_handling_groups"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK (("revision" = 1 AND "status" = 'ACTIVE' AND cardinality("before_case_ids") = 0 AND cardinality("after_case_ids") BETWEEN 2 AND 20)
    OR ("revision" = 2 AND "status" = 'DISSOLVED' AND cardinality("before_case_ids") BETWEEN 2 AND 20 AND cardinality("after_case_ids") = 0))
);

CREATE TABLE "case_handling_group_receipts" (
  "id" UUID PRIMARY KEY,
  "group_id" UUID NOT NULL,
  "department_id" UUID NOT NULL,
  "actor_user_id" UUID NOT NULL,
  "command" VARCHAR(16) NOT NULL CHECK ("command" IN ('CREATE', 'DISSOLVE')),
  "idempotency_key" VARCHAR(128) NOT NULL CHECK (char_length("idempotency_key") BETWEEN 1 AND 128 AND "idempotency_key" = btrim("idempotency_key")),
  "request_fingerprint" CHAR(64) NOT NULL CHECK ("request_fingerprint" ~ '^[0-9a-f]{64}$'),
  "original_request" JSONB NOT NULL,
  "result_snapshot" JSONB NOT NULL,
  "event_id" UUID NOT NULL UNIQUE,
  CONSTRAINT "cg_receipt_event_scope_key" UNIQUE ("event_id", "group_id", "department_id"),
  CONSTRAINT "case_handling_group_receipts_actor_command_key" UNIQUE ("department_id", "actor_user_id", "command", "idempotency_key"),
  FOREIGN KEY ("group_id", "department_id") REFERENCES "case_handling_groups"("id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("actor_user_id", "department_id") REFERENCES "department_memberships"("user_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT,
  FOREIGN KEY ("event_id", "group_id", "department_id") REFERENCES "case_handling_group_events"("id", "group_id", "department_id") ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION guard_case_handling_group_root() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'handling group history cannot be deleted' USING ERRCODE = '55000'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."revision" <> 1 OR NEW."status" <> 'ACTIVE' OR NEW."dissolved_at" IS NOT NULL THEN
      RAISE EXCEPTION 'handling group must begin active' USING ERRCODE = '23514';
    END IF;
  ELSIF OLD."revision" <> 1 OR OLD."status" <> 'ACTIVE' OR NEW."revision" <> 2 OR NEW."status" <> 'DISSOLVED'
    OR NEW."dissolved_at" IS NULL
    OR ROW(NEW."id", NEW."department_id", NEW."customer_id", NEW."created_at") IS DISTINCT FROM ROW(OLD."id", OLD."department_id", OLD."customer_id", OLD."created_at") THEN
    RAISE EXCEPTION 'handling group only permits a single dissolve' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "guard_case_handling_group_root" BEFORE INSERT OR UPDATE OR DELETE ON "case_handling_groups" FOR EACH ROW EXECUTE FUNCTION guard_case_handling_group_root();

CREATE FUNCTION guard_case_handling_group_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'handling group members, events and receipts are immutable' USING ERRCODE = '55000';
END
$$;
CREATE TRIGGER "cg_members_immutable" BEFORE UPDATE OR DELETE ON "case_handling_group_members" FOR EACH ROW EXECUTE FUNCTION guard_case_handling_group_history();
CREATE TRIGGER "cg_events_immutable" BEFORE UPDATE OR DELETE ON "case_handling_group_events" FOR EACH ROW EXECUTE FUNCTION guard_case_handling_group_history();
CREATE TRIGGER "cg_receipts_immutable" BEFORE UPDATE OR DELETE ON "case_handling_group_receipts" FOR EACH ROW EXECUTE FUNCTION guard_case_handling_group_history();

CREATE FUNCTION guard_case_handling_group_actor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "user_accounts" actor WHERE actor."id" = NEW."actor_user_id" AND actor."active" AND actor."account_type" = 'INTERNAL') THEN
    RAISE EXCEPTION 'handling group actor must be internal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "cg_event_actor" BEFORE INSERT ON "case_handling_group_events" FOR EACH ROW EXECUTE FUNCTION guard_case_handling_group_actor();

CREATE FUNCTION assert_case_handling_group_integrity(target_id UUID) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE root RECORD; member_ids UUID[]; event RECORD; receipt RECORD; event_count INTEGER;
BEGIN
  SELECT * INTO root FROM "case_handling_groups" WHERE "id" = target_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'handling group root missing' USING ERRCODE = '23514'; END IF;
  SELECT array_agg("case_id" ORDER BY "case_id"::text) INTO member_ids FROM "case_handling_group_members" WHERE "group_id" = target_id;
  IF coalesce(cardinality(member_ids), 0) NOT BETWEEN 2 AND 20 THEN
    RAISE EXCEPTION 'handling group requires two to twenty distinct sources' USING ERRCODE = '23514';
  END IF;
  SELECT count(*) INTO event_count FROM "case_handling_group_events" WHERE "group_id" = target_id;
  IF event_count <> root."revision" THEN RAISE EXCEPTION 'handling group event chain missing' USING ERRCODE = '23514'; END IF;
  FOR event IN SELECT * FROM "case_handling_group_events" WHERE "group_id" = target_id ORDER BY "revision" LOOP
    IF event."department_id" <> root."department_id"
      OR (event."revision" = 1 AND (event."after_case_ids" IS DISTINCT FROM member_ids OR event."recorded_at" IS DISTINCT FROM root."created_at"))
      OR (event."revision" = 2 AND (event."before_case_ids" IS DISTINCT FROM member_ids OR event."recorded_at" IS DISTINCT FROM root."dissolved_at")) THEN
      RAISE EXCEPTION 'handling group source or time mismatch' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "audit_events" audit WHERE audit."id" = event."audit_event_id"
      AND audit."department_id" = root."department_id" AND audit."actor_user_id" = event."actor_user_id"
      AND audit."resource_type" = 'case-handling-group' AND audit."resource_id" = target_id
      AND audit."action" = CASE WHEN event."revision" = 1 THEN 'case.group.created' ELSE 'case.group.dissolved' END
      AND audit."details" = jsonb_build_object('groupId', target_id::text, 'fromRevision', event."revision" - 1, 'toRevision', event."revision", 'beforeCaseIds', to_jsonb(event."before_case_ids"), 'afterCaseIds', to_jsonb(event."after_case_ids"))) THEN
      RAISE EXCEPTION 'handling group audit missing or inconsistent' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO receipt FROM "case_handling_group_receipts" WHERE "event_id" = event."id";
    IF NOT FOUND THEN RAISE EXCEPTION 'handling group typed receipt missing' USING ERRCODE = '23514'; END IF;
    IF receipt."group_id" <> target_id OR receipt."department_id" <> root."department_id" OR receipt."actor_user_id" <> event."actor_user_id"
      OR receipt."command" <> (CASE WHEN event."revision" = 1 THEN 'CREATE' ELSE 'DISSOLVE' END)
      OR jsonb_typeof(receipt."original_request") IS DISTINCT FROM 'object'
      OR jsonb_typeof(receipt."result_snapshot") IS DISTINCT FROM 'object'
      OR receipt."original_request"->>'groupId' IS DISTINCT FROM target_id::text
      OR receipt."original_request"->>'idempotencyKey' IS DISTINCT FROM receipt."idempotency_key"
      OR receipt."result_snapshot" <> jsonb_build_object('id', target_id::text, 'revision', event."revision", 'status', event."status", 'recordedAt', receipt."result_snapshot"->>'recordedAt')
      OR (receipt."result_snapshot"->>'recordedAt') IS NULL
      OR (receipt."result_snapshot"->>'recordedAt')::timestamptz IS DISTINCT FROM event."recorded_at" THEN
      RAISE EXCEPTION 'handling group typed receipt mismatch' USING ERRCODE = '23514';
    END IF;
    IF event."revision" = 1 THEN
      IF receipt."original_request" <> jsonb_build_object('groupId', target_id::text, 'caseIds', to_jsonb(member_ids), 'idempotencyKey', receipt."idempotency_key") THEN
        RAISE EXCEPTION 'handling group creation request differs from sources' USING ERRCODE = '23514';
      END IF;
    ELSIF receipt."original_request" <> jsonb_build_object('groupId', target_id::text, 'expectedRevision', 1, 'idempotencyKey', receipt."idempotency_key") THEN
      RAISE EXCEPTION 'handling group dissolve request differs from prior revision' USING ERRCODE = '23514';
    END IF;
  END LOOP;
END
$$;

CREATE FUNCTION check_case_handling_group_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'case_handling_groups' THEN PERFORM assert_case_handling_group_integrity(NEW."id");
  ELSE PERFORM assert_case_handling_group_integrity(NEW."group_id"); END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER "cg_root_integrity" AFTER INSERT OR UPDATE ON "case_handling_groups" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_handling_group_integrity();
CREATE CONSTRAINT TRIGGER "cg_member_integrity" AFTER INSERT ON "case_handling_group_members" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_handling_group_integrity();
CREATE CONSTRAINT TRIGGER "cg_event_integrity" AFTER INSERT ON "case_handling_group_events" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_handling_group_integrity();
CREATE CONSTRAINT TRIGGER "cg_receipt_integrity" AFTER INSERT ON "case_handling_group_receipts" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_handling_group_integrity();

COMMIT;
