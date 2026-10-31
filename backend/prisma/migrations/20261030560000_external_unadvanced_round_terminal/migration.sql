-- Narrow follow-up for real unadvanced external HEARING/JUDGMENT/direct SECOND roots.
-- No business facts or historical rows are created/changed. Normal-source guards remain intact.
BEGIN;
DO $preflight$ DECLARE spec record; p record; BEGIN
 FOR spec IN SELECT * FROM (VALUES ('ca018_assert_external_trial_round','target_case uuid, target_department uuid','5da77fdc9f7e8162eafee84d01e57ff56e5082ec4e301b02502f3995a8881c54','void','plpgsql','v'),
('ca018_h_direct_second_chain','target_case uuid, target_department uuid','996a74c6aed91090fe371676b32b96cc83369eae215ad1cc06617c883656e51e','void','plpgsql','v'),
('case_archive_source_checks_final','','9bf39beaea3c223cecb5f2763f35c557c24ae2445c0596d5da37868defe0adc6','trigger','plpgsql','v'),
('case_early_archive_final','','852e1215d143a84ee987b0323dffea66b5c480cdc945957e8276167cac4eca64','trigger','plpgsql','v'),
('case_early_closure_source_checks_final','','fc985cb4911e9428440ae8afa9a131e8a193ea009b05d148cae2f496d29a36d6','trigger','plpgsql','v'),
('check_case_archive_final','','a55570b0318b33e3bec6241811ccbbcd1f36f7f8ae07a22f2977cf31785850e0','trigger','plpgsql','v'),
('check_case_closure_final','','c0a9ef636750592eb2960ece32d71a4a3c22d700a54853776cf0fcccf2a8b1f5','trigger','plpgsql','v'),
('check_case_execution_confirmation_final','','6f73227c3f5d35d46d28bbe698b9927ffe0f94a6d344cac4cba6787c3607185b','trigger','plpgsql','v'),
('check_case_execution_filing_final','','5d40e00548ba07a57f132176dad832510da0b1f680dc55822abe50bc5d4f58f5','trigger','plpgsql','v'),
('check_case_execution_finish_final','','600aef1af1b4e55e45acee510184e7aab6734fd50a066cfa33ebc72dc40a9892','trigger','plpgsql','v'),
('check_case_execution_mailing_final','','f3cf4bba51757222f48e47c48c59c8d7c451cd102d958d319d641e7a6b81937a','trigger','plpgsql','v'),
('check_case_execution_submission_final','','fa6f8a930ba283dd6d8a3f388462cae651500ed6d7797fcccc1e71660843e470','trigger','plpgsql','v'),
('check_case_external_source_final','','05cda3414687d75dadcbbf7678179f1b8975d518de2c2b6325194d6f365bf4ad','trigger','plpgsql','v'),
('check_case_judgment_final','','8dcf0485260946315bf60fb16a8ce423684f31f2088cef41d3e7e4175c245c3a','trigger','plpgsql','v'),
('check_case_judgment_next_step_final','','0b246fe23b66a3550b6f4bc63bc7cc296ca5d823450e38d25b35ff5a99f254e0','trigger','plpgsql','v'),
('check_case_second_instance_final','','563008b7df062707a3f6d2df32d7b51bb08a9b4aad715b3161e18b875ac00d44','trigger','plpgsql','v'),
('check_case_trial_round_foundation','','cf22bbe4311b8a698a830e8c9fef3ea5a71fd7d16e3213b88aef7c32e6cf9ad0','trigger','plpgsql','v'),
('check_empty_remand_child_version','','05240eaedde81fd66bab23d005abd2193357dea01038fcb3250fc7f34e6f62c1','trigger','plpgsql','v'),
('check_execution_followup_case_final','','aa840691716adb4822c0d034946b97f55b2d2faca7e416a24f9782402d065e94','trigger','plpgsql','v'),
('check_retrial_prejudgment_version','','8459a982ec7967f14633fd34849731e9ad9c2cda1ac0e9865ca01d8c818efdca','trigger','plpgsql','v'),
('external_prehearing_early_empty_judgment_draft','target_case uuid, target_department uuid','6c3d81d0e5ea65094f604ec8d3b5fd0c69742fa4713179675d9c05787aa49670','boolean','sql','s')) expected(name,args,sha,result,lang,volatility) LOOP
  SELECT f.*,l.lanname INTO p FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace JOIN pg_language l ON l.oid=f.prolang
   WHERE f.proname=spec.name AND pg_get_function_identity_arguments(f.oid)=spec.args AND n.nspname=current_schema();
  IF p.oid IS NULL OR p.prosecdef OR p.proconfig IS NOT NULL OR p.lanname IS DISTINCT FROM spec.lang
   OR p.prorettype IS DISTINCT FROM spec.result::regtype::oid OR p.provolatile::text IS DISTINCT FROM spec.volatility
   OR encode(sha256(convert_to(replace(p.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') IS DISTINCT FROM spec.sha THEN
   RAISE EXCEPTION 'unexpected 3056 terminal predecessor %',spec.name USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR spec IN SELECT * FROM (VALUES ('case_judgment_facts','case_judgment_fact_guard','CREATE CONSTRAINT TRIGGER case_judgment_fact_guard AFTER INSERT ON case_judgment_facts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_final()'),
('case_judgment_next_step_revocations','case_judgment_next_step_revoke_guard','CREATE CONSTRAINT TRIGGER case_judgment_next_step_revoke_guard AFTER INSERT ON case_judgment_next_step_revocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_next_step_final()'),
('case_judgment_next_steps','case_judgment_next_step_fact_guard','CREATE CONSTRAINT TRIGGER case_judgment_next_step_fact_guard AFTER INSERT ON case_judgment_next_steps DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_next_step_final()'),
('case_second_instance_progresses','case_second_instance_progress_guard','CREATE CONSTRAINT TRIGGER case_second_instance_progress_guard AFTER INSERT ON case_second_instance_progresses DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_second_instance_final()'),
('case_second_instance_result_revocations','case_second_instance_revoke_guard','CREATE CONSTRAINT TRIGGER case_second_instance_revoke_guard AFTER INSERT ON case_second_instance_result_revocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_second_instance_final()'),
('case_second_instance_results','case_second_instance_result_guard','CREATE CONSTRAINT TRIGGER case_second_instance_result_guard AFTER INSERT ON case_second_instance_results DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_second_instance_final()'),
('cases','case_archive_case_final','CREATE CONSTRAINT TRIGGER case_archive_case_final AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_archive_final()'),
('cases','case_archive_source_checks_final','CREATE CONSTRAINT TRIGGER case_archive_source_checks_final AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION case_archive_source_checks_final()'),
('cases','case_closure_case_final','CREATE CONSTRAINT TRIGGER case_closure_case_final AFTER UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_closure_final()'),
('cases','case_early_archive_case_final','CREATE CONSTRAINT TRIGGER case_early_archive_case_final AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION case_early_archive_final()'),
('cases','case_early_closure_source_checks_case_final','CREATE CONSTRAINT TRIGGER case_early_closure_source_checks_case_final AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION case_early_closure_source_checks_final()'),
('cases','case_execution_confirmation_head_guard','CREATE CONSTRAINT TRIGGER case_execution_confirmation_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_confirmation_final()'),
('cases','case_execution_filing_head_guard','CREATE CONSTRAINT TRIGGER case_execution_filing_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_filing_final()'),
('cases','case_execution_finish_head_guard','CREATE CONSTRAINT TRIGGER case_execution_finish_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_finish_final()'),
('cases','case_execution_head_guard','CREATE CONSTRAINT TRIGGER case_execution_head_guard AFTER UPDATE OF stage, version, current_trial_round_id, current_judgment_next_step_id, current_second_instance_result_id, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_submission_final()'),
('cases','case_execution_mailing_head_guard','CREATE CONSTRAINT TRIGGER case_execution_mailing_head_guard AFTER UPDATE OF stage, version, current_execution_submission_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_execution_mailing_final()'),
('cases','case_external_source_case_final','CREATE CONSTRAINT TRIGGER case_external_source_case_final AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_external_source_final()'),
('cases','case_judgment_case_guard','CREATE CONSTRAINT TRIGGER case_judgment_case_guard AFTER UPDATE OF stage, version, current_judgment_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_final()'),
('cases','case_judgment_next_step_case_guard','CREATE CONSTRAINT TRIGGER case_judgment_next_step_case_guard AFTER UPDATE OF stage, version, current_judgment_id, current_judgment_next_step_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_judgment_next_step_final()'),
('cases','case_second_instance_case_guard','CREATE CONSTRAINT TRIGGER case_second_instance_case_guard AFTER UPDATE OF stage, version, current_trial_round_id, current_second_instance_progress_id, current_second_instance_result_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_second_instance_final()'),
('cases','case_trial_round_case_guard','CREATE CONSTRAINT TRIGGER case_trial_round_case_guard AFTER INSERT OR UPDATE OF stage, current_trial_round_id, current_acceptance_id, court_case_no, current_hearing_arrangement_id, current_hearing_advance_id, current_judgment_id, current_judgment_next_step_id ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_case_trial_round_foundation()'),
('cases','cases_empty_remand_child_version_guard','CREATE CONSTRAINT TRIGGER cases_empty_remand_child_version_guard AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_empty_remand_child_version()'),
('cases','cases_retrial_prejudgment_version_guard','CREATE CONSTRAINT TRIGGER cases_retrial_prejudgment_version_guard AFTER INSERT OR UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_retrial_prejudgment_version()'),
('cases','ef_case_final','CREATE CONSTRAINT TRIGGER ef_case_final AFTER UPDATE ON cases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_execution_followup_case_final()')) expected(tbl,name,definition) LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=to_regclass(format('%I.%I',current_schema(),spec.tbl))
   AND t.tgname=spec.name AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable AND t.tginitdeferred
   AND pg_get_triggerdef(t.oid,true)=spec.definition) THEN
   RAISE EXCEPTION 'unexpected 3056 terminal trigger %.%',spec.tbl,spec.name USING ERRCODE='23514'; END IF;
 END LOOP;
END; $preflight$;
CREATE FUNCTION external_unadvanced_round_early_terminal(target_case uuid,target_department uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM cases c
  JOIN case_external_entries e ON e.case_id=c.id AND e.department_id=c.department_id
  JOIN case_trial_rounds r ON r.id=c.current_trial_round_id AND r.case_id=c.id AND r.department_id=c.department_id
  JOIN case_early_closures ec ON ec.case_id=c.id AND ec.department_id=c.department_id
  JOIN case_closures h ON h.case_id=c.id AND h.department_id=c.department_id AND h.early_closure_id=ec.id
  JOIN case_closure_versions v ON v.id=h.current_version_id AND v.closure_id=h.id AND v.case_id=c.id AND v.department_id=c.department_id AND v.early_closure_id=ec.id
  JOIN case_closure_versions root ON root.closure_id=h.id AND root.case_id=c.id AND root.department_id=c.department_id
   AND root.kind='REGISTER' AND root.prior_version_id IS NULL AND root.early_closure_id=ec.id
  WHERE c.id=target_case AND c.department_id=target_department AND c.stage IN ('WAITING_ARCHIVE','ARCHIVED')
   AND c.source_lead_id IS NULL AND c.source_notary_matter_id IS NULL AND c.certificate_id IS NULL
   AND e.initial_stage IN ('WAITING_HEARING','WAITING_JUDGMENT','SECOND_INSTANCE') AND ec.from_stage=e.initial_stage
   AND ec.source_stage_locked AND ec.from_version=1 AND ec.to_version=ec.from_version+1
   AND r.origin='EXTERNAL_CURRENT' AND r.sequence=1 AND r.external_entry_id=e.id AND r.source_result_id IS NULL AND r.revoked_at IS NULL
   AND (SELECT count(*) FROM case_trial_rounds z WHERE z.case_id=c.id AND z.department_id=c.department_id)=1
   AND root.from_version=ec.to_version AND root.to_version=root.from_version+1
   AND root.finish_id IS NULL AND root.external_entry_id IS NULL
   AND h.finish_id IS NULL AND h.external_entry_id IS NULL AND v.finish_id IS NULL AND v.external_entry_id IS NULL
   AND v.to_version>=root.to_version
   AND ((c.stage='WAITING_ARCHIVE' AND c.version=v.to_version AND NOT EXISTS (SELECT 1 FROM case_archives z WHERE z.case_id=c.id AND z.department_id=c.department_id))
    OR (c.stage='ARCHIVED' AND EXISTS (SELECT 1 FROM case_archives a JOIN case_archive_versions av ON av.id=a.current_version_id AND av.archive_id=a.id
     AND av.case_id=a.case_id AND av.department_id=a.department_id WHERE a.case_id=c.id AND a.department_id=c.department_id
      AND a.closure_id=h.id AND a.closure_version_id=v.id AND av.closure_version_id=v.id AND av.to_version=c.version)))
   AND c.current_acceptance_id IS NULL AND c.current_hearing_arrangement_id IS NULL AND c.current_hearing_advance_id IS NULL
   AND c.current_judgment_id IS NULL AND c.current_judgment_next_step_id IS NULL
   AND c.current_second_instance_progress_id IS NULL AND c.current_second_instance_result_id IS NULL AND c.current_execution_submission_id IS NULL
   AND NOT EXISTS(SELECT 1 FROM case_acceptances z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_hearing_arrangements z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_hearing_advances z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_judgment_facts z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_judgment_next_steps z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_second_instance_progresses z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_second_instance_results z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_execution_submissions z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_execution_confirmations z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_execution_mailings z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_execution_filings z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_execution_finishes z WHERE z.case_id=c.id AND z.department_id=c.department_id)
   AND NOT EXISTS(SELECT 1 FROM case_early_archives z WHERE z.case_id=c.id AND z.department_id=c.department_id)
 );
$$;
CREATE OR REPLACE FUNCTION check_case_judgment_final() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; case_head record; round_id uuid;
        latest_judgment record; latest_choice record; latest_revoke record; latest_progress record; active_result record; latest_result_revocation record;
        root_count integer; expected_version integer; expected_stage text;
BEGIN
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF TG_TABLE_NAME='cases' AND (external_prehearing_early_empty_judgment_draft(target_case,NEW."department_id") OR external_unadvanced_round_early_terminal(target_case,NEW."department_id")) THEN RETURN NEW; END IF;
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE c."id"=target_case AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME='case_judgment_facts' THEN
      IF NOT EXISTS (
      SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
      WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id" AND r."id"=NEW."trial_round_id"
        AND NEW."external_entry_id"=e."id" AND NEW."judgment_received_at">=e."stage_reached_on"
        AND (e."known"->>'acceptedOn' IS NULL OR NEW."judgment_received_at">=(e."known"->>'acceptedOn')::date)
        AND (r."origin"<>'EXTERNAL_CURRENT' OR e."initial_stage"='WAITING_JUDGMENT' OR
          (e."initial_stage"='WAITING_HEARING' AND EXISTS (SELECT 1 FROM "case_hearing_advances" h
            WHERE h."id"=(SELECT c."current_hearing_advance_id" FROM "cases" c WHERE c."id"=NEW."case_id")
              AND h."trial_round_id"=r."id" AND h."external_entry_id"=e."id")) OR EXISTS (
            SELECT 1 FROM "cases" progressed
            JOIN "case_acceptances" acceptance ON acceptance."id"=progressed."current_acceptance_id"
              AND acceptance."case_id"=progressed."id" AND acceptance."department_id"=progressed."department_id"
              AND acceptance."trial_round_id"=r."id" AND acceptance."external_entry_id"=e."id"
            JOIN "case_hearing_advances" advance ON advance."id"=progressed."current_hearing_advance_id"
              AND advance."case_id"=progressed."id" AND advance."department_id"=progressed."department_id"
              AND advance."trial_round_id"=r."id" AND advance."external_entry_id"=e."id"
            WHERE progressed."id"=NEW."case_id" AND progressed."department_id"=NEW."department_id"
              AND progressed."current_trial_round_id"=r."id"))) THEN
        RAISE EXCEPTION 'external judgment source/date mismatch' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO case_head FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  round_id := case_head."current_trial_round_id";
  SELECT f."id", f."to_version" INTO latest_judgment FROM "case_judgment_facts" f
    WHERE f."case_id" = target_case AND f."department_id" = target_department AND f."trial_round_id" = round_id
    ORDER BY f."to_version" DESC LIMIT 1;
  IF latest_judgment."id" IS NULL THEN
    IF case_head."current_judgment_id" IS NOT NULL OR case_head."current_judgment_next_step_id" IS NOT NULL OR
       case_head."stage" IN ('SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION', 'WAITING_EXECUTION_STAMP', 'WAITING_EXECUTION_FILING', 'EXECUTING','WAITING_ARCHIVE','ARCHIVED') THEN
      RAISE EXCEPTION 'current round has no judgment for stage' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT count(*) INTO root_count FROM "case_judgment_facts" f WHERE f."case_id" = target_case
      AND f."department_id" = target_department AND f."trial_round_id" = round_id AND f."kind" = 'REGISTER';
    IF root_count <> 1 OR case_head."current_judgment_id" IS DISTINCT FROM latest_judgment."id" THEN
      RAISE EXCEPTION 'current round judgment head mismatch' USING ERRCODE = '23514';
    END IF;
    SELECT s."id", s."judgment_id", s."next", s."to_version" INTO latest_choice
      FROM "case_judgment_next_steps" s WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = round_id ORDER BY s."to_version" DESC LIMIT 1;
    expected_version := latest_judgment."to_version";
    IF latest_choice."id" IS NOT NULL THEN
      SELECT v."id", v."to_version" INTO latest_revoke FROM "case_judgment_next_step_revocations" v
        WHERE v."choice_id" = latest_choice."id" AND v."case_id" = target_case AND v."department_id" = target_department;
      IF latest_revoke."id" IS NULL THEN
        IF case_head."current_judgment_next_step_id" IS DISTINCT FROM latest_choice."id" OR
           case_head."current_judgment_id" IS DISTINCT FROM latest_choice."judgment_id" THEN
          RAISE EXCEPTION 'current round active choice mismatch' USING ERRCODE = '23514';
        END IF;
        expected_stage := CASE WHEN latest_choice."next" = 'APPEAL' THEN 'SECOND_INSTANCE' ELSE 'WAITING_EXECUTION_DOCUMENTS' END;
        expected_version := latest_choice."to_version";
        IF latest_choice."next" = 'APPEAL' THEN
          SELECT p."id", p."to_version" INTO latest_progress FROM "case_second_instance_progresses" p
            WHERE p."case_id" = target_case AND p."department_id" = target_department AND p."trial_round_id" = round_id
              AND p."choice_id" = latest_choice."id" ORDER BY p."to_version" DESC LIMIT 1;
          IF case_head."current_second_instance_progress_id" IS DISTINCT FROM latest_progress."id" THEN
            RAISE EXCEPTION 'active second-instance progress head mismatch' USING ERRCODE = '23514';
          END IF;
          expected_version := greatest(expected_version, coalesce(latest_progress."to_version", 0));
          SELECT s."id", s."result", s."to_version" INTO active_result FROM "case_second_instance_results" s
            LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
            WHERE s."case_id" = target_case AND s."department_id" = target_department AND s."trial_round_id" = round_id
              AND s."choice_id" = latest_choice."id" AND v."id" IS NULL ORDER BY s."to_version" DESC LIMIT 1;
          IF active_result."id" IS NOT NULL THEN
            IF active_result."result" = 'REMAND' OR case_head."current_second_instance_result_id" IS DISTINCT FROM active_result."id" THEN
              RAISE EXCEPTION 'source round with active remand/result mismatch' USING ERRCODE = '23514';
            END IF;
            expected_stage := 'WAITING_EXECUTION_DOCUMENTS';
            expected_version := active_result."to_version";
          ELSE
            IF case_head."current_second_instance_result_id" IS NOT NULL THEN
              RAISE EXCEPTION 'second-instance result pointer without active result' USING ERRCODE = '23514';
            END IF;
            SELECT v."to_version" INTO latest_result_revocation FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id" = v."result_id"
              WHERE s."case_id" = target_case AND s."department_id" = target_department
                AND s."trial_round_id" = round_id AND s."choice_id" = latest_choice."id"
              ORDER BY v."to_version" DESC LIMIT 1;
            expected_version := greatest(expected_version, coalesce(latest_result_revocation."to_version", 0));
          END IF;
        END IF;
        IF EXISTS (SELECT 1 FROM "case_execution_submissions" e WHERE e."case_id" = target_case AND e."department_id" = target_department AND e."trial_round_id" = round_id) THEN
  IF expected_stage <> 'WAITING_EXECUTION_DOCUMENTS' OR NOT EXISTS (
    SELECT 1 FROM "case_execution_submissions" e WHERE e."id" = case_head."current_execution_submission_id"
      AND e."case_id" = target_case AND e."department_id" = target_department AND e."trial_round_id" = round_id
      AND e."judgment_next_step_id" = latest_choice."id"
      AND e."second_instance_result_id" IS NOT DISTINCT FROM case_head."current_second_instance_result_id"
      AND e."id" = (SELECT x."id" FROM "case_execution_submissions" x WHERE x."case_id" = target_case
        AND x."department_id" = target_department AND x."trial_round_id" = round_id ORDER BY x."to_version" DESC LIMIT 1)) THEN
    RAISE EXCEPTION 'execution head or source mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT e."to_version" INTO expected_version FROM "case_execution_submissions" e WHERE e."id" = case_head."current_execution_submission_id";
  IF EXISTS (SELECT 1 FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department) THEN
  SELECT f."to_version" INTO expected_version FROM "case_execution_confirmations" f WHERE f."case_id" = target_case AND f."department_id" = target_department AND f."submission_id" = case_head."current_execution_submission_id";
  IF EXISTS (SELECT 1 FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department) THEN
 SELECT case_closure_terminal_version(target_case,target_department,ef."id",ef."to_version") INTO expected_version FROM "case_execution_finishes" ef WHERE ef."case_id"=target_case AND ef."department_id"=target_department;
 expected_stage := CASE WHEN EXISTS (SELECT 1 FROM "case_archives" WHERE "case_id"=target_case AND "department_id"=target_department) THEN 'ARCHIVED'::case_stage ELSE 'WAITING_ARCHIVE'::case_stage END;
ELSIF EXISTS (SELECT 1 FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department) THEN
 SELECT ff."to_version" INTO expected_version FROM "case_execution_filings" ff WHERE ff."case_id"=target_case AND ff."department_id"=target_department;
 expected_stage := 'EXECUTING';
ELSIF EXISTS (SELECT 1 FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department) THEN
 SELECT mm."to_version" INTO expected_version FROM "case_execution_mailings" mm WHERE mm."case_id"=target_case AND mm."department_id"=target_department;
 expected_stage := 'WAITING_EXECUTION_FILING';
ELSE expected_stage := 'WAITING_EXECUTION_STAMP'; END IF;
ELSE expected_stage := 'WAITING_EXECUTION_CONFIRMATION'; END IF;
ELSIF case_head."current_execution_submission_id" IS NOT NULL THEN
  RAISE EXCEPTION 'execution pointer without fact' USING ERRCODE = '23514';
END IF;
IF case_head."stage"::text IS DISTINCT FROM expected_stage OR case_head."version" <> expected_version THEN
          RAISE EXCEPTION 'active judgment choice stage/version mismatch' USING ERRCODE = '23514';
        END IF;
      ELSE
        expected_version := greatest(expected_version, latest_revoke."to_version");
        IF case_head."current_judgment_next_step_id" IS NOT NULL OR case_head."stage" <> 'WAITING_JUDGMENT' OR case_head."version" <> expected_version THEN
          RAISE EXCEPTION 'revoked judgment choice mismatch' USING ERRCODE = '23514';
        END IF;
      END IF;
    ELSIF case_head."current_judgment_next_step_id" IS NOT NULL OR case_head."stage" <> 'WAITING_JUDGMENT' OR case_head."version" <> expected_version THEN
      RAISE EXCEPTION 'judgment stage/version mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_facts' THEN
    IF NEW."judgment_received_at" < (SELECT case_effective_acceptance_date(a."id") FROM "case_acceptances" a
          WHERE a."case_id" = target_case AND a."department_id" = target_department AND a."trial_round_id" = NEW."trial_round_id") OR
       NEW."judgment_received_at" > (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date OR
       (NEW."kind" = 'REGISTER' AND NEW."prior_fact_id" IS NOT NULL) OR
       (NEW."kind" = 'CORRECT' AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" prior
         WHERE prior."id" = NEW."prior_fact_id" AND prior."case_id" = NEW."case_id"
           AND prior."department_id" = NEW."department_id" AND prior."trial_round_id" = NEW."trial_round_id"
           AND prior."id" = (SELECT f."id" FROM "case_judgment_facts" f WHERE f."case_id" = NEW."case_id"
             AND f."department_id" = NEW."department_id" AND f."trial_round_id" = NEW."trial_round_id"
             AND f."id" <> NEW."id" ORDER BY f."to_version" DESC LIMIT 1)
           AND (prior."to_version" = NEW."from_version" OR EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v
             JOIN "case_judgment_next_steps" s ON s."id" = v."choice_id"
             WHERE s."judgment_id" = prior."id" AND s."trial_round_id" = NEW."trial_round_id"
               AND s."case_id" = NEW."case_id" AND s."department_id" = NEW."department_id"
               AND v."to_version" = NEW."from_version")))) OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = NEW."department_id" AND a."resource_type" = 'CASE' AND a."resource_id" = NEW."case_id"
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = CASE WHEN NEW."kind" = 'REGISTER' THEN 'case.judgment.registered' ELSE 'case.judgment.corrected' END
         AND a."details"->>'judgmentId' = NEW."id"::text AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text
         AND a."details"->>'judgmentReceivedAt' = NEW."judgment_received_at"::text
         AND a."details"->>'judgmentAmountState' = NEW."judgment_amount_state"::text
         AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
         AND a."details"->>'paidLitigationFeeState' = NEW."paid_litigation_fee_state"::text
         AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
         AND a."details"->>'priorFactId' IS NOT DISTINCT FROM NEW."prior_fact_id"::text
         AND a."details"->>'reason' IS NOT DISTINCT FROM NEW."reason") OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_receipts" v WHERE v."case_id" = NEW."case_id"
         AND v."department_id" = NEW."department_id" AND v."actor_user_id" = NEW."recorded_by_user_id"
         AND v."action" = NEW."kind" AND v."result_snapshot"->>'judgmentId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment fact or audit mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION check_case_judgment_next_step_final() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; choice_record record; case_record record;
        latest_prior_id uuid; latest_prior_revoked_to integer; expected_from integer; judgment_version integer;
BEGIN
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF TG_TABLE_NAME='cases' AND (external_prehearing_early_empty_judgment_draft(target_case,NEW."department_id") OR external_unadvanced_round_early_terminal(target_case,NEW."department_id")) THEN RETURN NEW; END IF;
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE c."id"=target_case AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      RETURN NEW;
    END IF;
    IF TG_TABLE_NAME='case_judgment_next_steps' THEN
      IF NOT EXISTS (
      SELECT 1 FROM "case_judgment_facts" j JOIN "case_external_entries" e ON e."case_id"=j."case_id" AND e."department_id"=j."department_id"
      WHERE j."id"=NEW."judgment_id" AND j."trial_round_id"=NEW."trial_round_id" AND j."external_entry_id"=e."id"
        AND NEW."external_entry_id"=e."id" AND j."case_id"=NEW."case_id" AND j."department_id"=NEW."department_id") THEN
        RAISE EXCEPTION 'external judgment choice lacks real judgment' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT c."stage", c."version", c."current_judgment_id", c."current_judgment_next_step_id", c."rights_holder_id"
    INTO case_record FROM "cases" c WHERE c."id" = target_case AND c."department_id" = target_department;
  IF case_record."stage" IN ('SECOND_INSTANCE', 'WAITING_EXECUTION_DOCUMENTS', 'WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') AND case_record."current_judgment_next_step_id" IS NULL THEN
    RAISE EXCEPTION 'advanced stage requires current choice' USING ERRCODE = '23514';
  END IF;
  IF TG_TABLE_NAME = 'case_judgment_next_steps' THEN
    SELECT f."to_version" INTO judgment_version FROM "case_judgment_facts" f
      WHERE f."id" = NEW."judgment_id" AND f."case_id" = target_case AND f."department_id" = target_department;
    SELECT s."id", r."to_version" INTO latest_prior_id, latest_prior_revoked_to
      FROM "case_judgment_next_steps" s LEFT JOIN "case_judgment_next_step_revocations" r ON r."choice_id" = s."id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department AND s."id" <> NEW."id" AND s."trial_round_id" = NEW."trial_round_id"
      ORDER BY s."to_version" DESC LIMIT 1;
    expected_from := greatest(judgment_version, coalesce(latest_prior_revoked_to, 0));
    IF judgment_version IS NULL OR (latest_prior_id IS NOT NULL AND latest_prior_revoked_to IS NULL) OR
       NEW."from_version" <> expected_from OR
       NEW."judgment_id" IS DISTINCT FROM case_record."current_judgment_id" OR
       (NEW."next" = 'APPEAL' AND NEW."plaintiff_rights_holder_id" IS NULL AND NOT EXISTS (
         SELECT 1 FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       (NEW."next" = 'EXECUTION' AND EXISTS (
         SELECT 1 FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       (NEW."plaintiff_rights_holder_id" IS NOT NULL AND NEW."plaintiff_rights_holder_id" <> case_record."rights_holder_id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.judgment.next_step' AND a."details"->>'choiceId' = NEW."id"::text
         AND a."details"->>'judgmentId' = NEW."judgment_id"::text AND a."details"->>'next' = NEW."next"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text AND a."details"->>'toVersion' = NEW."to_version"::text
         AND (a."details"->>'plaintiffAppeals')::boolean = (NEW."plaintiff_rights_holder_id" IS NOT NULL)
         AND (a."details"->>'executionReadinessConfirmed')::boolean = NEW."execution_readiness_confirmed"
         AND a."details"->'defendantIds' = (SELECT coalesce(jsonb_agg(d."defendant_id" ORDER BY d."defendant_id"), '[]'::jsonb)
            FROM "case_judgment_appeal_defendants" d WHERE d."choice_id" = NEW."id")) OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'CHOOSE' AND r."result_snapshot"->>'choiceId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment choice source, parties, audit or receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_judgment_next_step_revocations' THEN
    SELECT s."id", s."judgment_id", s."to_version", s."trial_round_id" INTO choice_record FROM "case_judgment_next_steps" s
      WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case AND s."department_id" = target_department;
    IF choice_record."id" IS NULL OR NEW."from_version" <> choice_record."to_version" OR
       NEW."choice_id" <> (SELECT s."id" FROM "case_judgment_next_steps" s WHERE s."case_id" = target_case AND s."trial_round_id" = choice_record."trial_round_id"
         ORDER BY s."to_version" DESC LIMIT 1) OR
       case_record."current_judgment_id" IS DISTINCT FROM choice_record."judgment_id" OR
       EXISTS (SELECT 1 FROM "case_second_instance_progresses" p WHERE p."choice_id" = NEW."choice_id") OR
       EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."choice_id" = NEW."choice_id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."internal_actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.judgment.next_step.revoke' AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'revocationId' = NEW."id"::text AND a."details"->>'reason' = NEW."reason"
         AND a."details"->>'fromVersion' = NEW."from_version"::text AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'REVOKE' AND r."result_snapshot"->>'revocationId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'judgment choice revocation mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION check_case_second_instance_final() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_case uuid; target_department uuid; case_head record; choice_record record; source_result record;
        prior_progress record; prior_result record; last_revocation record; expected_from integer; accepted_date date;
BEGIN
  IF TG_TABLE_NAME = 'cases' AND TG_OP = 'UPDATE' THEN
    IF case_early_closure_transition(OLD, NEW) OR case_early_closure_register_transition(OLD, NEW) OR case_early_closure_correction_transition(OLD, NEW) THEN RETURN NEW; END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN
    IF TG_OP = 'UPDATE' THEN
      IF case_early_archive_transition(OLD, NEW) THEN RETURN NEW; END IF;
    END IF;
  END IF;
IF TG_TABLE_NAME='cases' THEN target_case:=NEW."id"; ELSE target_case:=NEW."case_id"; END IF;
  target_department:=NEW."department_id";
  IF EXISTS (SELECT 1 FROM "case_external_entries" e WHERE e."case_id"=target_case
    AND e."department_id"=NEW."department_id") THEN
    PERFORM ca018_assert_external_trial_round(target_case,NEW."department_id");
    IF TG_TABLE_NAME='cases' AND (external_prehearing_early_empty_judgment_draft(target_case,NEW."department_id") OR external_unadvanced_round_early_terminal(target_case,NEW."department_id")) THEN RETURN NEW; END IF;
    IF ca018_h_is_unadvanced_root(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF ca018_h_downstream_entry_without_judgment(target_case,NEW."department_id") THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM "case_external_entries" e JOIN "cases" c ON c."id"=e."case_id" AND c."department_id"=e."department_id"
      WHERE e."case_id"=target_case
        AND e."department_id"=NEW."department_id" AND e."initial_stage"='SECOND_INSTANCE'
        AND c."current_judgment_id" IS NULL) THEN
      PERFORM ca018_h_direct_second_chain(target_case,NEW."department_id");
      IF TG_TABLE_NAME='case_second_instance_progresses' THEN
        IF NOT EXISTS (
        SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
        WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id"
          AND r."id"=NEW."trial_round_id" AND r."origin"='EXTERNAL_CURRENT'
          AND NEW."external_entry_id"=e."id" AND NEW."choice_id" IS NULL
          AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=greatest(1,
            coalesce((SELECT p."to_version" FROM "case_second_instance_progresses" p
              WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
                AND p."trial_round_id"=NEW."trial_round_id" AND p."id"<>NEW."id"
              ORDER BY p."to_version" DESC LIMIT 1),0),
            coalesce((SELECT v."to_version" FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id"=v."result_id"
              WHERE s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
                AND s."trial_round_id"=NEW."trial_round_id" AND s."choice_id" IS NULL
              ORDER BY v."to_version" DESC LIMIT 1),0))
          AND NEW."prior_progress_id" IS NOT DISTINCT FROM (SELECT p."id" FROM "case_second_instance_progresses" p
            WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
              AND p."trial_round_id"=NEW."trial_round_id" AND p."id"<>NEW."id"
            ORDER BY p."to_version" DESC LIMIT 1)
          AND (NEW."hearing_at" IS NULL OR
            (NEW."hearing_at">=e."stage_reached_on" AND
             (e."known"->>'acceptedOn' IS NULL OR NEW."hearing_at">=(e."known"->>'acceptedOn')::date) AND
             (e."known"->>'secondInstanceAcceptedOn' IS NULL OR NEW."hearing_at">=(e."known"->>'secondInstanceAcceptedOn')::date)))
          AND EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id" AND a."action"='case.second_instance.save'
            AND a."resource_id"=NEW."case_id" AND a."department_id"=NEW."department_id"
            AND a."resource_type"='CASE' AND a."actor_kind"='HUMAN'
            AND a."actor_user_id"=NEW."recorded_by_user_id"
            AND a."details"->>'progressId'=NEW."id"::text AND a."details"->>'choiceId' IS NULL
            AND a."details"->>'trialRoundId'=NEW."trial_round_id"::text
            AND a."details"->>'priorProgressId' IS NOT DISTINCT FROM NEW."prior_progress_id"::text
            AND a."details"->>'fromVersion'=NEW."from_version"::text
            AND a."details"->>'toVersion'=NEW."to_version"::text
            AND a."details"->>'hearingAt' IS NOT DISTINCT FROM NEW."hearing_at"::text
            AND a."details"->>'hearingPlace' IS NOT DISTINCT FROM NEW."hearing_place"
            AND a."details"->>'judgeName' IS NOT DISTINCT FROM NEW."judge_name")
          AND EXISTS (SELECT 1 FROM "case_second_instance_receipts" receipt WHERE receipt."case_id"=NEW."case_id"
            AND receipt."department_id"=NEW."department_id" AND receipt."actor_user_id"=NEW."recorded_by_user_id"
            AND receipt."action" IN ('SAVE','RESULT')
            AND receipt."result_snapshot"->>'progressId'=NEW."id"::text)) THEN
          RAISE EXCEPTION 'direct second progress source/audit/receipt mismatch' USING ERRCODE='23514';
        END IF;
      END IF;
      IF TG_TABLE_NAME='case_second_instance_results' THEN
        IF NOT EXISTS (
        SELECT 1 FROM "case_external_entries" e JOIN "case_trial_rounds" r ON r."case_id"=e."case_id" AND r."department_id"=e."department_id"
        WHERE e."case_id"=NEW."case_id" AND e."department_id"=NEW."department_id"
          AND r."id"=NEW."trial_round_id" AND r."origin"='EXTERNAL_CURRENT'
          AND NEW."external_entry_id"=e."id" AND NEW."choice_id" IS NULL AND NEW."judgment_id" IS NULL
          AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=greatest(1,
            coalesce((SELECT p."to_version" FROM "case_second_instance_progresses" p
              WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
                AND p."trial_round_id"=NEW."trial_round_id"
              ORDER BY p."to_version" DESC LIMIT 1),0),
            coalesce((SELECT v."to_version" FROM "case_second_instance_result_revocations" v
              JOIN "case_second_instance_results" s ON s."id"=v."result_id"
              WHERE s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
                AND s."trial_round_id"=NEW."trial_round_id" AND s."choice_id" IS NULL
              ORDER BY v."to_version" DESC LIMIT 1),0))
          AND NEW."progress_id" IS NOT DISTINCT FROM (SELECT p."id" FROM "case_second_instance_progresses" p
            WHERE p."case_id"=NEW."case_id" AND p."department_id"=NEW."department_id"
              AND p."trial_round_id"=NEW."trial_round_id" ORDER BY p."to_version" DESC LIMIT 1)
          AND NEW."result_received_at">=e."stage_reached_on"
          AND NEW."result_received_at" <= (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date
          AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" other
            WHERE other."case_id"=NEW."case_id" AND other."department_id"=NEW."department_id"
              AND other."trial_round_id"=NEW."trial_round_id" AND other."id"<>NEW."id"
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_result_revocations" v WHERE v."result_id"=other."id"))
          AND (NEW."result"<>'AFFIRM' OR NEW."judgment_amount_state" IS NOT NULL)
          AND EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id"=NEW."audit_event_id"
            AND a."action"='case.second_instance.result' AND a."resource_id"=NEW."case_id"
            AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE'
            AND a."actor_kind"='HUMAN' AND a."actor_user_id"=NEW."recorded_by_user_id"
            AND a."details"->>'resultId'=NEW."id"::text
            AND a."details"->>'trialRoundId'=NEW."trial_round_id"::text
            AND a."details"->>'choiceId' IS NULL AND a."details"->>'judgmentId' IS NULL
            AND a."details"->>'progressId' IS NOT DISTINCT FROM NEW."progress_id"::text
            AND a."details"->>'result'=NEW."result"::text
            AND a."details"->>'resultReceivedAt'=NEW."result_received_at"::text
            AND a."details"->>'judgmentAmountState' IS NOT DISTINCT FROM NEW."judgment_amount_state"::text
            AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
            AND a."details"->>'paidLitigationFeeState'=NEW."paid_litigation_fee_state"::text
            AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
            AND a."details"->>'fromVersion'=NEW."from_version"::text
            AND a."details"->>'toVersion'=NEW."to_version"::text)
          AND EXISTS (SELECT 1 FROM "case_second_instance_receipts" receipt WHERE receipt."case_id"=NEW."case_id"
            AND receipt."department_id"=NEW."department_id" AND receipt."actor_user_id"=NEW."recorded_by_user_id"
            AND receipt."action"='RESULT'
            AND receipt."result_snapshot"->>'resultId'=NEW."id"::text)) THEN
          RAISE EXCEPTION 'direct second result source/audit/receipt mismatch' USING ERRCODE='23514';
        END IF;
      END IF;
      IF TG_TABLE_NAME='case_second_instance_result_revocations' THEN
        IF NOT EXISTS (
        SELECT 1 FROM "case_second_instance_results" s JOIN "audit_events" a ON a."id"=NEW."audit_event_id"
        JOIN "case_second_instance_receipts" receipt ON receipt."case_id"=NEW."case_id"
          AND receipt."department_id"=NEW."department_id" AND receipt."action"='REVOKE'
          AND receipt."result_snapshot"->>'revocationId'=NEW."id"::text
        WHERE s."id"=NEW."result_id" AND s."case_id"=NEW."case_id" AND s."department_id"=NEW."department_id"
          AND s."external_entry_id"=(SELECT e."id" FROM "case_external_entries" e WHERE e."case_id"=NEW."case_id")
          AND s."choice_id" IS NULL AND NEW."to_version"=NEW."from_version"+1
          AND NEW."from_version"=(SELECT c."version"-1 FROM "cases" c WHERE c."id"=NEW."case_id")
          AND a."department_id"=NEW."department_id" AND a."resource_type"='CASE'
          AND a."actor_kind"='HUMAN' AND a."actor_user_id"=NEW."recorded_by_user_id"
          AND a."internal_actor_user_id"=NEW."recorded_by_user_id"
          AND a."action"='case.second_instance.result.revoke' AND a."resource_id"=NEW."case_id"
          AND a."details"->>'resultId'=NEW."result_id"::text
          AND a."details"->>'revocationId'=NEW."id"::text
          AND a."details"->>'reason'=NEW."reason"
          AND a."details"->>'fromVersion'=NEW."from_version"::text
          AND a."details"->>'toVersion'=NEW."to_version"::text
          AND receipt."actor_user_id"=NEW."recorded_by_user_id"
          AND NOT EXISTS (SELECT 1 FROM "cases" c WHERE c."id"=NEW."case_id"
            AND (c."current_second_instance_result_id" IS NOT NULL OR c."stage"<>'SECOND_INSTANCE'
              OR c."current_trial_round_id"<>s."trial_round_id"
              OR c."current_second_instance_progress_id" IS DISTINCT FROM s."progress_id"))
          AND NOT EXISTS (SELECT 1 FROM "case_execution_submissions" downstream
            WHERE downstream."second_instance_result_id"=s."id")
          AND (s."result"<>'REMAND' OR EXISTS (SELECT 1 FROM "case_trial_rounds" child
            WHERE child."source_result_id"=s."id" AND child."external_entry_id"=s."external_entry_id"
              AND child."revoked_at"=NEW."recorded_at"
              AND NOT EXISTS (SELECT 1 FROM "case_acceptances" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_hearing_advances" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_progresses" x WHERE x."trial_round_id"=child."id")
              AND NOT EXISTS (SELECT 1 FROM "case_second_instance_results" x WHERE x."trial_round_id"=child."id")))) THEN
          RAISE EXCEPTION 'direct second result revoke mismatch' USING ERRCODE='23514';
        END IF;
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'cases' THEN target_case := NEW."id"; target_department := NEW."department_id";
  ELSE target_case := NEW."case_id"; target_department := NEW."department_id"; END IF;
  SELECT * INTO case_head FROM "cases" WHERE "id" = target_case AND "department_id" = target_department;
  IF case_head."current_second_instance_progress_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "case_second_instance_progresses" p WHERE p."id" = case_head."current_second_instance_progress_id"
      AND p."case_id" = target_case AND p."department_id" = target_department
      AND p."trial_round_id" = case_head."current_trial_round_id" AND p."choice_id" = case_head."current_judgment_next_step_id") THEN
    RAISE EXCEPTION 'second-instance current progress pointer mismatch' USING ERRCODE = '23514';
  END IF;
  IF case_head."current_second_instance_result_id" IS NOT NULL THEN
    SELECT s.*, v."id" AS revocation_id INTO source_result FROM "case_second_instance_results" s
      LEFT JOIN "case_second_instance_result_revocations" v ON v."result_id" = s."id"
      WHERE s."id" = case_head."current_second_instance_result_id" AND s."case_id" = target_case
        AND s."department_id" = target_department;
    IF source_result."id" IS NULL OR source_result.revocation_id IS NOT NULL OR
       (source_result."result" = 'REMAND' AND (case_head."stage" <> 'WAITING_FORMAL_ACCEPTANCE' OR
         NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child WHERE child."id" = case_head."current_trial_round_id"
           AND child."source_result_id" = source_result."id" AND child."revoked_at" IS NULL))) OR
       (source_result."result" <> 'REMAND' AND (case_head."stage" NOT IN ('WAITING_EXECUTION_DOCUMENTS','WAITING_EXECUTION_CONFIRMATION','WAITING_EXECUTION_STAMP','WAITING_EXECUTION_FILING','EXECUTING','WAITING_ARCHIVE','ARCHIVED') OR
         source_result."trial_round_id" <> case_head."current_trial_round_id")) THEN
      RAISE EXCEPTION 'second-instance current result pointer mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'case_second_instance_progresses' THEN
    SELECT s."id", s."to_version" INTO choice_record FROM "case_judgment_next_steps" s
      WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."next" = 'APPEAL'
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id" = s."id");
    IF EXISTS (SELECT 1 FROM "case_external_entries" entry WHERE entry."case_id"=target_case AND entry."department_id"=target_department)
    AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_steps" actual
      JOIN "case_judgment_facts" judgment ON judgment."id"=actual."judgment_id"
      JOIN "case_external_entries" e ON e."case_id"=actual."case_id" AND e."department_id"=actual."department_id"
      WHERE actual."id"=NEW."choice_id" AND actual."trial_round_id"=NEW."trial_round_id"
        AND actual."case_id"=NEW."case_id" AND actual."department_id"=NEW."department_id"
        AND actual."external_entry_id"=e."id" AND judgment."external_entry_id"=e."id"
        AND judgment."trial_round_id"=NEW."trial_round_id" AND actual."next"='APPEAL'
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id"=actual."id")) THEN
      RAISE EXCEPTION 'external real appeal requires true source choice/judgment' USING ERRCODE='23514';
    END IF;
    SELECT p."id", p."to_version" INTO prior_progress FROM "case_second_instance_progresses" p
      WHERE p."case_id" = target_case AND p."department_id" = target_department
        AND p."trial_round_id" = NEW."trial_round_id" AND p."choice_id" = NEW."choice_id"
        AND p."id" <> NEW."id" ORDER BY p."to_version" DESC LIMIT 1;
    SELECT v."to_version" INTO last_revocation FROM "case_second_instance_result_revocations" v
      JOIN "case_second_instance_results" s ON s."id" = v."result_id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."choice_id" = NEW."choice_id"
      ORDER BY v."to_version" DESC LIMIT 1;
    expected_from := greatest(coalesce(choice_record."to_version", 0), coalesce(prior_progress."to_version", 0),
      coalesce(last_revocation."to_version", 0));
    IF choice_record."id" IS NULL OR NEW."prior_progress_id" IS DISTINCT FROM prior_progress."id" OR
       NEW."from_version" <> expected_from OR
       (case_head."current_trial_round_id" <> NEW."trial_round_id" AND NOT EXISTS (
         SELECT 1 FROM "case_second_instance_results" s WHERE s."trial_round_id" = NEW."trial_round_id"
           AND s."progress_id" = NEW."id" AND s."result" = 'REMAND' AND
           case_head."current_second_instance_result_id" = s."id")) OR
       (case_head."current_trial_round_id" = NEW."trial_round_id" AND case_head."current_second_instance_progress_id" IS DISTINCT FROM NEW."id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.save' AND a."details"->>'progressId' = NEW."id"::text
         AND a."details"->>'trialRoundId' = NEW."trial_round_id"::text
         AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'priorProgressId' IS NOT DISTINCT FROM NEW."prior_progress_id"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text
         AND a."details"->>'hearingAt' IS NOT DISTINCT FROM NEW."hearing_at"::text
         AND a."details"->>'hearingPlace' IS NOT DISTINCT FROM NEW."hearing_place"
         AND a."details"->>'judgeName' IS NOT DISTINCT FROM NEW."judge_name") OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" IN ('SAVE', 'RESULT') AND r."result_snapshot"->>'progressId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance progress chain/audit/receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_second_instance_results' THEN
    SELECT s."id", s."judgment_id", s."to_version", s."trial_round_id" INTO choice_record
      FROM "case_judgment_next_steps" s WHERE s."id" = NEW."choice_id" AND s."case_id" = target_case
        AND s."department_id" = target_department AND s."trial_round_id" = NEW."trial_round_id"
        AND s."next" = 'APPEAL' AND NOT EXISTS (SELECT 1 FROM "case_judgment_next_step_revocations" v WHERE v."choice_id" = s."id");
    SELECT case_effective_acceptance_date(a."id") INTO accepted_date FROM "case_acceptances" a WHERE a."case_id" = target_case
      AND a."department_id" = target_department AND a."trial_round_id" = NEW."trial_round_id";
    SELECT p."id", p."to_version" INTO prior_progress FROM "case_second_instance_progresses" p
      WHERE p."case_id" = target_case AND p."department_id" = target_department
        AND p."trial_round_id" = NEW."trial_round_id" AND p."choice_id" = NEW."choice_id"
      ORDER BY p."to_version" DESC LIMIT 1;
    SELECT v."to_version" INTO last_revocation FROM "case_second_instance_result_revocations" v
      JOIN "case_second_instance_results" s ON s."id" = v."result_id"
      WHERE s."case_id" = target_case AND s."department_id" = target_department
        AND s."trial_round_id" = NEW."trial_round_id" AND s."choice_id" = NEW."choice_id"
      ORDER BY v."to_version" DESC LIMIT 1;
    expected_from := greatest(coalesce(choice_record."to_version", 0), coalesce(prior_progress."to_version", 0),
      coalesce(last_revocation."to_version", 0));
    IF choice_record."id" IS NULL OR NEW."judgment_id" IS DISTINCT FROM choice_record."judgment_id" OR
       NEW."progress_id" IS DISTINCT FROM prior_progress."id" OR NEW."from_version" <> expected_from OR
       (accepted_date IS NULL AND NOT EXISTS (SELECT 1 FROM "case_external_entries" e
         WHERE e."case_id"=target_case AND e."department_id"=target_department
           AND e."initial_stage" IN ('WAITING_HEARING','WAITING_JUDGMENT') AND NEW."external_entry_id"=e."id")) OR
       NEW."result_received_at" < coalesce(accepted_date,(SELECT e."stage_reached_on" FROM "case_external_entries" e
         WHERE e."case_id"=target_case AND e."department_id"=target_department)) OR
       NEW."result_received_at" > (NEW."recorded_at" AT TIME ZONE 'Asia/Shanghai')::date OR
       case_head."current_second_instance_result_id" IS DISTINCT FROM NEW."id" OR
       (NEW."result" = 'AFFIRM' AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" j
         WHERE j."id" = NEW."judgment_id" AND j."judgment_amount_state" = NEW."judgment_amount_state"
           AND j."judgment_amount" IS NOT DISTINCT FROM NEW."judgment_amount")) OR
       (NEW."result" = 'REMAND' AND NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child
         WHERE child."source_result_id" = NEW."id" AND child."id" = case_head."current_trial_round_id")) OR
       (NEW."result" <> 'REMAND' AND case_head."current_trial_round_id" <> NEW."trial_round_id") OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.result' AND a."details"->>'resultId' = NEW."id"::text
         AND a."details"->>'trialRoundId' = NEW."trial_round_id"::text
         AND a."details"->>'choiceId' = NEW."choice_id"::text
         AND a."details"->>'judgmentId' = NEW."judgment_id"::text
         AND a."details"->>'progressId' IS NOT DISTINCT FROM NEW."progress_id"::text
         AND a."details"->>'result' = NEW."result"::text
         AND a."details"->>'resultReceivedAt' = NEW."result_received_at"::text
         AND a."details"->>'judgmentAmountState' IS NOT DISTINCT FROM NEW."judgment_amount_state"::text
         AND a."details"->>'judgmentAmount' IS NOT DISTINCT FROM NEW."judgment_amount"::text
         AND a."details"->>'paidLitigationFeeState' = NEW."paid_litigation_fee_state"::text
         AND a."details"->>'paidLitigationFee' IS NOT DISTINCT FROM NEW."paid_litigation_fee"::text
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'RESULT' AND r."result_snapshot"->>'resultId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance result source/audit/receipt mismatch' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'case_second_instance_result_revocations' THEN
    SELECT s.* INTO source_result FROM "case_second_instance_results" s WHERE s."id" = NEW."result_id"
      AND s."case_id" = target_case AND s."department_id" = target_department;
    IF source_result."id" IS NULL OR NEW."from_version" <> case_head."version" - 1 OR
       case_head."current_second_instance_result_id" IS NOT NULL OR case_head."stage" <> 'SECOND_INSTANCE' OR
       case_head."current_trial_round_id" <> source_result."trial_round_id" OR
       case_head."current_second_instance_progress_id" IS DISTINCT FROM source_result."progress_id" OR
       NOT EXISTS (SELECT 1 FROM "audit_events" a WHERE a."id" = NEW."audit_event_id"
         AND a."department_id" = target_department AND a."resource_type" = 'CASE' AND a."resource_id" = target_case
         AND a."actor_kind" = 'HUMAN' AND a."actor_user_id" = NEW."recorded_by_user_id"
         AND a."internal_actor_user_id" = NEW."recorded_by_user_id"
         AND a."action" = 'case.second_instance.result.revoke'
         AND a."details"->>'resultId' = NEW."result_id"::text
         AND a."details"->>'revocationId' = NEW."id"::text
         AND a."details"->>'reason' = NEW."reason"
         AND a."details"->>'fromVersion' = NEW."from_version"::text
         AND a."details"->>'toVersion' = NEW."to_version"::text) OR
       NOT EXISTS (SELECT 1 FROM "case_second_instance_receipts" r WHERE r."case_id" = target_case
         AND r."department_id" = target_department AND r."actor_user_id" = NEW."recorded_by_user_id"
         AND r."action" = 'REVOKE' AND r."result_snapshot"->>'revocationId' = NEW."id"::text) THEN
      RAISE EXCEPTION 'second-instance result revocation mismatch' USING ERRCODE = '23514';
    END IF;
    IF source_result."result" = 'REMAND' AND NOT EXISTS (SELECT 1 FROM "case_trial_rounds" child
      WHERE child."source_result_id" = source_result."id" AND child."revoked_at" = NEW."recorded_at"
        AND NOT EXISTS (SELECT 1 FROM "case_acceptances" a WHERE a."trial_round_id" = child."id")
        AND NOT EXISTS (SELECT 1 FROM "case_hearing_arrangements" h WHERE h."trial_round_id" = child."id")
        AND NOT EXISTS (SELECT 1 FROM "case_judgment_facts" j WHERE j."trial_round_id" = child."id")) THEN
      RAISE EXCEPTION 'remand child not empty/revoked' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
COMMIT;
