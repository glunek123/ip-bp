BEGIN;

-- A lawyer is an external account. Do not let SQL bypass create an internal
-- membership or role assignment for the same user, including inactive rows.
CREATE FUNCTION "reject_lawyer_internal_membership"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account_kind "user_account_type";
BEGIN
  SELECT "account_type" INTO account_kind FROM "user_accounts" WHERE "id" = NEW."user_id" FOR UPDATE;
  IF account_kind = 'LAWYER' THEN
    RAISE EXCEPTION 'lawyer account cannot have internal membership or role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "department_memberships_no_lawyer" BEFORE INSERT OR UPDATE ON "department_memberships"
  FOR EACH ROW EXECUTE FUNCTION "reject_lawyer_internal_membership"();
CREATE TRIGGER "role_assignments_no_lawyer" BEFORE INSERT OR UPDATE ON "role_assignments"
  FOR EACH ROW EXECUTE FUNCTION "reject_lawyer_internal_membership"();

CREATE FUNCTION "reject_lawyer_account_type_with_internal_grants"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."account_type" = 'LAWYER' AND (
    EXISTS (SELECT 1 FROM "department_memberships" WHERE "user_id" = NEW."id") OR
    EXISTS (SELECT 1 FROM "role_assignments" WHERE "user_id" = NEW."id")
  ) THEN
    RAISE EXCEPTION 'lawyer account cannot have internal membership or role' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "user_accounts_no_lawyer_internal_grants" BEFORE UPDATE OF "account_type" ON "user_accounts"
  FOR EACH ROW EXECUTE FUNCTION "reject_lawyer_account_type_with_internal_grants"();

COMMIT;
