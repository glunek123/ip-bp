-- Forward-only optional correction reason. No backfill or gate changes.
-- NOT VALID preserves all old rows, including whitespace accepted by historical BTRIM.
-- PostgreSQL still enforces this CHECK for every future INSERT/UPDATE.
BEGIN;
DO $reason$
DECLARE candidate record; matched integer:=0; expected_definition text;
BEGIN
 LOCK TABLE case_closure_versions IN ACCESS EXCLUSIVE MODE;
 -- Let the target PostgreSQL version deparse the known predecessor itself.
 -- This avoids guessing whitespace, casts or parenthesis formatting.
 CREATE TEMP TABLE closure_reason_predecessor_shape (
  kind case_closure_kind, prior_version_id uuid, correction_reason varchar(500),
  CONSTRAINT closure_reason_predecessor_check CHECK (
   (kind='REGISTER' AND prior_version_id IS NULL AND correction_reason IS NULL) OR
   (kind='CORRECT' AND prior_version_id IS NOT NULL AND correction_reason IS NOT NULL AND CHAR_LENGTH(BTRIM(correction_reason)) BETWEEN 1 AND 500)
  )
 ) ON COMMIT DROP;
 SELECT pg_get_constraintdef(oid) INTO expected_definition FROM pg_constraint
  WHERE conrelid='pg_temp.closure_reason_predecessor_shape'::regclass AND conname='closure_reason_predecessor_check';
 FOR candidate IN SELECT oid,conname,convalidated,pg_get_constraintdef(oid) AS definition FROM pg_constraint
  WHERE conrelid='case_closure_versions'::regclass AND contype='c' LOOP
  IF position('correction_reason' IN candidate.definition)>0 THEN
   matched:=matched+1;
   IF candidate.convalidated IS DISTINCT FROM true OR candidate.definition IS DISTINCT FROM expected_definition
   THEN RAISE EXCEPTION 'unknown closure correction reason constraint %',candidate.conname USING ERRCODE='23514'; END IF;
   EXECUTE format('ALTER TABLE case_closure_versions DROP CONSTRAINT %I',candidate.conname);
   EXECUTE format('ALTER TABLE case_closure_versions ADD CONSTRAINT %I CHECK (
    (kind=''REGISTER'' AND prior_version_id IS NULL AND correction_reason IS NULL) OR
    (kind=''CORRECT'' AND prior_version_id IS NOT NULL AND
      (correction_reason IS NULL OR (char_length(btrim(correction_reason)) BETWEEN 1 AND 500 AND correction_reason ~ ''[^[:space:]]'')))) NOT VALID',candidate.conname);
  END IF;
 END LOOP;
 IF matched<>1 THEN RAISE EXCEPTION 'closure correction reason constraint inventory changed: %',matched USING ERRCODE='23514'; END IF;
END;
$reason$;
COMMIT;
