BEGIN;

-- Capture the rights holder's name when the choice is inserted. Do not
-- revalidate historical snapshots when that rights holder is renamed later.
CREATE FUNCTION "check_case_judgment_plaintiff_snapshot"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_name text;
BEGIN
  IF NEW."plaintiff_rights_holder_id" IS NOT NULL THEN
    SELECT h."name" INTO current_name
      FROM "rights_holders" h JOIN "cases" c
        ON c."id" = NEW."case_id" AND c."department_id" = NEW."department_id"
       AND c."rights_holder_id" = h."id" AND c."department_id" = h."department_id"
      WHERE h."id" = NEW."plaintiff_rights_holder_id"
      FOR SHARE OF h;
    IF NOT FOUND OR NEW."plaintiff_name" IS DISTINCT FROM current_name THEN
      RAISE EXCEPTION 'appeal plaintiff snapshot mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "case_judgment_plaintiff_snapshot_guard"
  BEFORE INSERT ON "case_judgment_next_steps"
  FOR EACH ROW EXECUTE FUNCTION "check_case_judgment_plaintiff_snapshot"();

COMMIT;
