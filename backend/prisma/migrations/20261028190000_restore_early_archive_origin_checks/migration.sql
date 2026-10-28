-- Allow an early archive to retain the facts required by its actual source
-- stage. Existing immediate checks continue to apply to every other stage;
-- archived rows are checked again at transaction end against that source.
BEGIN;

DO $migration$
DECLARE
  item record;
  body text;
  matching_body text;
  complaint_body text;
BEGIN
  FOR item IN
    SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conrelid = 'cases'::regclass
      AND conname IN ('cases_matching_state_check', 'cases_complaint_state_check')
    ORDER BY conname
  LOOP
    IF left(item.definition, 7) <> 'CHECK (' OR
       position('stage =' IN item.definition) = 0 OR
       position('''ARCHIVED''::case_stage' IN item.definition) = 0 THEN
      RAISE EXCEPTION 'unknown case state constraint %', item.conname USING ERRCODE = '23514';
    END IF;
    body := substr(item.definition, 8, length(item.definition) - 8);
    IF item.conname = 'cases_matching_state_check' THEN
      matching_body := replace(body, 'stage =', 'source_stage =');
    ELSE
      complaint_body := replace(body, 'stage =', 'source_stage =');
    END IF;
    EXECUTE format('ALTER TABLE cases DROP CONSTRAINT %I', item.conname);
    EXECUTE format(
      'ALTER TABLE cases ADD CONSTRAINT %I CHECK ((%s) OR stage = ''ARCHIVED''::case_stage)',
      item.conname, body
    );
  END LOOP;
  IF matching_body IS NULL OR complaint_body IS NULL THEN
    RAISE EXCEPTION 'missing case state constraint' USING ERRCODE = '23514';
  END IF;
  EXECUTE format(
    'CREATE FUNCTION case_archive_source_checks(c cases, source_stage case_stage) RETURNS boolean LANGUAGE sql IMMUTABLE AS $body$ SELECT ((%s) AND (%s)) FROM (SELECT (c).*) AS source_row $body$',
    matching_body, complaint_body
  );
END;
$migration$;

CREATE FUNCTION case_archive_source_checks_final() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_case cases%ROWTYPE;
  original_stage case_stage;
BEGIN
  SELECT * INTO current_case FROM cases WHERE id = NEW.id AND department_id = NEW.department_id;
  IF current_case.id IS NULL OR current_case.stage <> 'ARCHIVED' THEN RETURN NEW; END IF;
  SELECT from_stage INTO original_stage FROM case_early_archives
    WHERE case_id = current_case.id AND department_id = current_case.department_id;
  IF case_archive_source_checks(current_case, COALESCE(original_stage, 'ARCHIVED'::case_stage)) IS NOT TRUE THEN
    RAISE EXCEPTION 'archive source state does not satisfy original case checks' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER case_archive_source_checks_final
  AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION case_archive_source_checks_final();

COMMIT;
