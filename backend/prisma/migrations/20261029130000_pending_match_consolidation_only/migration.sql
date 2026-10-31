-- The existing deferred integrity trigger continues to validate historic
-- complaint-stage consolidations. This guard applies only to new roots.
CREATE FUNCTION guard_new_case_consolidation_pending_match() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Lock every member case before checking its stage. Concurrent stage writes
  -- must finish first or wait until this new consolidation commits.
  PERFORM 1
  FROM "case_consolidation_members" member
  JOIN "cases" source ON source."id" = member."case_id"
  WHERE member."consolidation_id" = NEW."id"
  ORDER BY source."id"
  FOR SHARE OF source;

  IF EXISTS (
    SELECT 1
    FROM "case_consolidation_members" member
    JOIN "cases" source ON source."id" = member."case_id"
    WHERE member."consolidation_id" = NEW."id"
      AND source."stage" <> 'PENDING_MATCH'
  ) THEN
    RAISE EXCEPTION 'new consolidation requires pending-match source cases' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER "new_case_consolidation_pending_match"
  AFTER INSERT ON "case_consolidations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_new_case_consolidation_pending_match();
