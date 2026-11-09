-- Preserve the applied 283 migration. Fix only the SQL table alias that
-- collides with PL/pgSQL trigger variable OLD, after exact predecessor checks.
BEGIN;
DO $preflight$ DECLARE installed record; attached record; BEGIN
 SELECT p.oid,p.prosrc,l.lanname,p.prorettype,p.prosecdef,p.proconfig,p.provolatile
  INTO installed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure(format('%I.validate_litigation_refund_command()',current_schema()))
   AND n.nspname=current_schema();
 IF installed.oid IS NULL OR installed.lanname IS DISTINCT FROM 'plpgsql'
  OR installed.prorettype IS DISTINCT FROM 'trigger'::regtype::oid
  OR installed.prosecdef OR installed.proconfig IS NOT NULL OR installed.provolatile<>'v'
  OR encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
   IS DISTINCT FROM '46f30cb3ed88494fd3a8db1de5551a0eb5997596eb3edbbeeb24bca15b9284a3'
 THEN RAISE EXCEPTION 'unexpected litigation refund validator predecessor' USING ERRCODE='23514'; END IF;
 SELECT t.oid,t.tgtype,t.tgdeferrable,t.tginitdeferred,t.tgenabled,t.tgisinternal,
   t.tgfoid,t.tgconstraint,t.tgqual,octet_length(t.tgargs) AS args_length
  INTO attached FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname=current_schema() AND c.relname='case_litigation_refund_commands'
   AND t.tgname='litigation_refund_command_complete';
 IF attached.oid IS NULL OR attached.tgtype IS DISTINCT FROM 5
  OR attached.tgdeferrable IS NOT TRUE OR attached.tginitdeferred IS NOT TRUE
  OR attached.tgenabled IS DISTINCT FROM 'O' OR attached.tgisinternal
  OR attached.tgfoid IS DISTINCT FROM installed.oid OR attached.tgconstraint=0
  OR attached.tgqual IS NOT NULL OR attached.args_length<>0
 THEN RAISE EXCEPTION 'unexpected litigation refund validator trigger predecessor' USING ERRCODE='23514'; END IF;
END; $preflight$;

CREATE OR REPLACE FUNCTION validate_litigation_refund_command() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p case_litigation_refund_commands%ROWTYPE; v case_refund_inventory_versions%ROWTYPE;
 prior case_refund_inventory_versions%ROWTYPE; prior_count bigint; next_count bigint;
 m case_litigation_refund_item_meta%ROWTYPE; target_item case_refund_inventory_items%ROWTYPE;
 target_amount numeric(16,2);
BEGIN
 SELECT * INTO p FROM case_litigation_refund_commands WHERE id=NEW.id;
 SELECT * INTO v FROM case_refund_inventory_versions WHERE id=p.inventory_version_id;
 SELECT * INTO prior FROM case_refund_inventory_versions WHERE id=p.prior_version_id;
 SELECT * INTO m FROM case_litigation_refund_item_meta WHERE inventory_version_id=v.id AND item_id=p.item_id;
 SELECT * INTO target_item FROM case_refund_inventory_items
  WHERE inventory_version_id=v.id AND item_id=p.item_id;
 SELECT amount INTO target_amount FROM case_refund_inventory_item_amounts
  WHERE inventory_version_id=v.id AND item_id=p.item_id;
 IF v.id IS NULL
  OR NOT EXISTS (SELECT 1 FROM case_litigation_refund_commands x
      WHERE x.id=p.id AND x.xmin=pg_current_xact_id()::text::xid)
  OR NOT EXISTS (SELECT 1 FROM case_refund_inventory_versions x
      WHERE x.id=v.id AND x.xmin=pg_current_xact_id()::text::xid)
  OR v.case_id<>p.case_id OR v.department_id<>p.department_id OR v.recorded_by_user_id<>p.actor_user_id
  OR v.prior_version_id IS DISTINCT FROM p.prior_version_id
  OR m.item_id IS NULL OR p.recorded_at<>v.recorded_at
  OR (p.kind IN ('REGISTER','CORRECT') AND EXISTS
      (SELECT 1 FROM cases c WHERE c.id=p.case_id AND c.department_id=p.department_id
        AND c.stage='ARCHIVED'))
  OR (p.kind IN ('CORRECT','FOLLOW') AND (p.reason IS NULL OR length(btrim(p.reason))=0) AND
      EXISTS (SELECT 1 FROM cases c WHERE c.id=p.case_id AND c.stage='ARCHIVED'))
  OR (p.kind='CORRECT' AND (p.reason IS NULL OR length(btrim(p.reason))=0))
  OR (SELECT count(*) FROM case_litigation_refund_item_meta WHERE inventory_version_id=v.id)
      <>(SELECT count(*) FROM case_refund_inventory_items WHERE inventory_version_id=v.id)
  OR jsonb_typeof(p.result_snapshot)<>'object'
  OR p.result_snapshot->>'commandId' IS DISTINCT FROM p.id::text
  OR p.result_snapshot->>'inventoryVersionId' IS DISTINCT FROM v.id::text
  OR p.result_snapshot#>>'{item,itemId}' IS DISTINCT FROM p.item_id::text
  OR p.result_snapshot#>>'{item,inventoryVersionId}' IS DISTINCT FROM v.id::text
 THEN RAISE EXCEPTION 'litigation refund command is incomplete' USING ERRCODE='23514'; END IF;
 -- The replayed row must seal the exact persisted financial fact. Display
 -- labels may be refreshed by later case edits; they are not money evidence.
 IF target_item.item_id IS NULL
  OR p.result_snapshot#>>'{item,caseId}' IS DISTINCT FROM p.case_id::text
  OR p.result_snapshot#>>'{item,party}' IS DISTINCT FROM target_item.party
  OR p.result_snapshot#>>'{item,status}' IS DISTINCT FROM target_item.status
  OR p.result_snapshot#>>'{item,description}' IS DISTINCT FROM target_item.description
  OR p.result_snapshot#>>'{item,amount}' IS DISTINCT FROM target_amount::text
  OR p.result_snapshot#>>'{item,remark}' IS DISTINCT FROM m.remark
  OR (m.source_type IS NULL AND jsonb_typeof(p.result_snapshot#>'{item,source}') IS DISTINCT FROM 'null')
  OR (m.source_type IS NOT NULL AND (
    jsonb_typeof(p.result_snapshot#>'{item,source}') IS DISTINCT FROM 'object'
    OR p.result_snapshot#>>'{item,source,type}' IS DISTINCT FROM m.source_type
    OR p.result_snapshot#>>'{item,source,id}' IS DISTINCT FROM m.source_id::text
    OR p.result_snapshot#>>'{item,source,trialRoundId}' IS DISTINCT FROM m.trial_round_id::text))
 THEN RAISE EXCEPTION 'litigation refund replay differs from persisted item' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO next_count FROM case_refund_inventory_items WHERE inventory_version_id=v.id;
 SELECT count(*) INTO prior_count FROM case_refund_inventory_items WHERE inventory_version_id=prior.id;
 IF p.kind='REGISTER' AND (next_count<>prior_count+1 OR
   v.declaration<>'UNKNOWN' OR
   EXISTS (SELECT 1 FROM case_refund_inventory_items WHERE inventory_version_id=prior.id AND item_id=p.item_id) OR
   EXISTS (SELECT 1 FROM case_refund_inventory_items
     WHERE inventory_version_id=v.id AND item_id=p.item_id AND status<>'PENDING'))
  THEN RAISE EXCEPTION 'refund registration must add one new item' USING ERRCODE='23514'; END IF;
 IF p.kind<>'REGISTER' AND (prior.id IS NULL OR next_count<>prior_count OR
   NOT EXISTS (SELECT 1 FROM case_refund_inventory_items WHERE inventory_version_id=prior.id AND item_id=p.item_id))
  THEN RAISE EXCEPTION 'refund revision needs existing item' USING ERRCODE='23514'; END IF;
 IF p.kind='FOLLOW' AND v.declaration IS DISTINCT FROM prior.declaration
  THEN RAISE EXCEPTION 'refund follow cannot change inventory completeness' USING ERRCODE='23514'; END IF;
 IF EXISTS (
  SELECT 1 FROM case_refund_inventory_items prior_item WHERE prior_item.inventory_version_id=prior.id
   AND NOT EXISTS (SELECT 1 FROM case_refund_inventory_items n
     WHERE n.inventory_version_id=v.id AND n.item_id=prior_item.item_id)
 ) THEN RAISE EXCEPTION 'refund revision cannot replace other identities' USING ERRCODE='23514'; END IF;
 IF p.kind='REGISTER' AND EXISTS (
  SELECT 1 FROM case_refund_inventory_items n JOIN case_refund_inventory_items prior_item
   ON prior_item.inventory_version_id=prior.id AND prior_item.item_id=n.item_id
  LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=n.inventory_version_id AND a.item_id=n.item_id
  LEFT JOIN case_refund_inventory_item_amounts b ON b.inventory_version_id=prior_item.inventory_version_id AND b.item_id=prior_item.item_id
  WHERE n.inventory_version_id=v.id AND
   (n.party<>prior_item.party OR n.status<>prior_item.status OR n.description<>prior_item.description OR a.amount IS DISTINCT FROM b.amount)
 ) THEN RAISE EXCEPTION 'refund registration cannot alter prior items' USING ERRCODE='23514'; END IF;
 IF p.kind='FOLLOW' AND EXISTS (
  SELECT 1 FROM case_refund_inventory_items i JOIN case_refund_inventory_items prior_item
   ON prior_item.inventory_version_id=prior.id AND prior_item.item_id=i.item_id
  LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id
  LEFT JOIN case_refund_inventory_item_amounts b ON b.inventory_version_id=prior_item.inventory_version_id AND b.item_id=prior_item.item_id
  WHERE i.inventory_version_id=v.id AND
   (i.party<>prior_item.party OR i.description<>prior_item.description OR a.amount IS DISTINCT FROM b.amount
    OR (i.item_id<>p.item_id AND i.status<>prior_item.status))
 ) THEN RAISE EXCEPTION 'refund follow may change only target status' USING ERRCODE='23514'; END IF;
 IF p.kind='CORRECT' AND EXISTS (
  SELECT 1 FROM case_refund_inventory_items i JOIN case_refund_inventory_items prior_item
   ON prior_item.inventory_version_id=prior.id AND prior_item.item_id=i.item_id
  LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id
  LEFT JOIN case_refund_inventory_item_amounts b ON b.inventory_version_id=prior_item.inventory_version_id AND b.item_id=prior_item.item_id
  WHERE i.inventory_version_id=v.id AND
   (i.item_id<>p.item_id AND (i.party<>prior_item.party OR i.description<>prior_item.description
      OR a.amount IS DISTINCT FROM b.amount OR i.status<>prior_item.status))
 ) THEN RAISE EXCEPTION 'refund correction may change only target registration' USING ERRCODE='23514'; END IF;
 IF p.kind='CORRECT' AND EXISTS (
  SELECT 1 FROM case_refund_inventory_items n JOIN case_refund_inventory_items prior_item
   ON prior_item.inventory_version_id=prior.id AND prior_item.item_id=n.item_id
  WHERE n.inventory_version_id=v.id AND n.item_id=p.item_id AND n.status<>prior_item.status
 ) THEN RAISE EXCEPTION 'refund correction cannot change follow status' USING ERRCODE='23514'; END IF;
 IF p.kind IN ('REGISTER','CORRECT') AND EXISTS (
  SELECT 1 FROM case_litigation_refund_item_meta n
  LEFT JOIN case_litigation_refund_item_meta prior_item ON prior_item.inventory_version_id=prior.id AND prior_item.item_id=n.item_id
  WHERE n.inventory_version_id=v.id AND n.item_id<>p.item_id AND prior_item.item_id IS NOT NULL AND
   (n.source_type IS DISTINCT FROM prior_item.source_type OR n.source_id IS DISTINCT FROM prior_item.source_id
    OR n.trial_round_id IS DISTINCT FROM prior_item.trial_round_id OR n.remark IS DISTINCT FROM prior_item.remark)
 ) THEN RAISE EXCEPTION 'refund registration cannot alter other source metadata' USING ERRCODE='23514'; END IF;
 IF p.kind='CORRECT' AND EXISTS (
  SELECT 1 FROM case_litigation_refund_item_meta n
  LEFT JOIN case_litigation_refund_item_meta prior_item ON prior_item.inventory_version_id=prior.id AND prior_item.item_id=n.item_id
  WHERE n.inventory_version_id=v.id AND n.item_id=p.item_id AND prior_item.item_id IS NOT NULL
   AND n.remark IS DISTINCT FROM prior_item.remark
 ) THEN RAISE EXCEPTION 'refund correction cannot change follow remark' USING ERRCODE='23514'; END IF;
 -- Source identity is carried on every new version. A new or corrected source
 -- must be a live official fact in the same case and trial round.
 IF p.kind IN ('REGISTER','CORRECT') AND NOT (
  (m.source_type='JUDGMENT' AND EXISTS (
    SELECT 1 FROM case_judgment_facts j JOIN case_trial_rounds r ON r.id=j.trial_round_id
    WHERE j.id=m.source_id AND j.case_id=p.case_id AND j.department_id=p.department_id
      AND j.trial_round_id=m.trial_round_id AND j.kind='REGISTER' AND r.revoked_at IS NULL))
  OR (m.source_type='SECOND_INSTANCE_RESULT' AND EXISTS (
    SELECT 1 FROM case_second_instance_results s JOIN case_trial_rounds r ON r.id=s.trial_round_id
    WHERE s.id=m.source_id AND s.case_id=p.case_id AND s.department_id=p.department_id
      AND s.trial_round_id=m.trial_round_id AND r.revoked_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM case_second_instance_result_revocations x WHERE x.result_id=s.id)))
 ) THEN RAISE EXCEPTION 'refund source is not an effective case fact' USING ERRCODE='23514'; END IF;
 IF p.kind='FOLLOW' AND EXISTS (
  SELECT 1 FROM case_litigation_refund_item_meta n
  LEFT JOIN case_litigation_refund_item_meta prior_item ON prior_item.inventory_version_id=prior.id AND prior_item.item_id=n.item_id
  WHERE n.inventory_version_id=v.id AND prior_item.item_id IS NOT NULL AND
   (n.source_type IS DISTINCT FROM prior_item.source_type OR n.source_id IS DISTINCT FROM prior_item.source_id
    OR n.trial_round_id IS DISTINCT FROM prior_item.trial_round_id
    OR (n.item_id<>p.item_id AND n.remark IS DISTINCT FROM prior_item.remark))
 ) THEN RAISE EXCEPTION 'refund follow may change only target remark' USING ERRCODE='23514'; END IF;
 PERFORM validate_case_refund_inventory_snapshot(v.id);
 RETURN NEW;
END; $$;
COMMIT;