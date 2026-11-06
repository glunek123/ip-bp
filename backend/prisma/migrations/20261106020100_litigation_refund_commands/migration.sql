-- Independent, append-only litigation refund commands. Existing settlement
-- composition and its receipts remain valid and unchanged.
BEGIN;

-- Fail before touching any object if the 281 predecessor differs from the
-- reviewed actor and atomic-command guards. These hashes are of prosrc, not
-- pg_get_functiondef formatting.
DO $preflight$ DECLARE expected record; installed record; attached record; BEGIN
 FOR expected IN SELECT * FROM (VALUES
  ('guard_case_financial_actor_draft','3b0ab62af4d87a6a3882193a77c51c5b6a537616547b7693b9f5705dcd6e6c27'),
  ('require_settlement_command_child_parent_final','84359f77d9edadb5a0a96c1d829e9814f9f55e0363510b2ec72f4ec1ad57dc8b')
 ) spec(name,body_sha256) LOOP
  SELECT p.oid,p.prosrc,l.lanname,p.prorettype,p.prosecdef,p.proconfig,p.provolatile
   INTO installed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=to_regprocedure(format('%I.%I()',current_schema(),expected.name))
    AND n.nspname=current_schema();
  IF installed.oid IS NULL OR installed.lanname IS DISTINCT FROM 'plpgsql'
   OR installed.prorettype IS DISTINCT FROM 'trigger'::regtype::oid
   OR installed.prosecdef OR installed.proconfig IS NOT NULL OR installed.provolatile<>'v'
   OR encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
      IS DISTINCT FROM expected.body_sha256
  THEN RAISE EXCEPTION 'unexpected litigation refund predecessor function %',expected.name
   USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR expected IN SELECT * FROM (VALUES
  ('case_refund_inventory_versions','case_refund_inventory_actor_draft_guard','guard_case_financial_actor_draft',31,false),
  ('case_refund_inventory_versions','settlement_refund_version_command_final','require_settlement_command_child_parent_final',5,true),
  ('case_refund_inventory_items','settlement_refund_item_command_final','require_settlement_command_child_parent_final',5,true),
  ('case_refund_inventory_receipts','settlement_refund_receipt_command_final','require_settlement_command_child_parent_final',5,true)
 ) spec(table_name,trigger_name,function_name,trigger_type,deferred) LOOP
  SELECT t.oid,t.tgtype,t.tgdeferrable,t.tginitdeferred,t.tgenabled,p.proname
   INTO attached FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
   WHERE n.nspname=current_schema() AND c.relname=expected.table_name
    AND t.tgname=expected.trigger_name AND NOT t.tgisinternal;
  IF attached.oid IS NULL OR attached.tgtype IS DISTINCT FROM expected.trigger_type
   OR attached.tgdeferrable IS DISTINCT FROM expected.deferred
   OR attached.tginitdeferred IS DISTINCT FROM expected.deferred
   OR attached.tgenabled IS DISTINCT FROM 'O'
   OR attached.proname IS DISTINCT FROM expected.function_name
  THEN RAISE EXCEPTION 'unexpected litigation refund predecessor trigger %.%',expected.table_name,expected.trigger_name
   USING ERRCODE='23514'; END IF;
 END LOOP;
END; $preflight$;

CREATE TABLE case_litigation_refund_commands (
 id uuid PRIMARY KEY,
 case_id uuid NOT NULL,
 department_id uuid NOT NULL,
 actor_user_id uuid NOT NULL,
 item_id uuid NOT NULL,
 kind varchar(16) NOT NULL CHECK (kind IN ('REGISTER','CORRECT','FOLLOW')),
 prior_version_id uuid,
 inventory_version_id uuid NOT NULL UNIQUE,
 reason varchar(1000),
 idempotency_key varchar(128) NOT NULL CHECK (length(btrim(idempotency_key))>0),
 request_fingerprint char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
 result_snapshot jsonb NOT NULL,
 recorded_at timestamptz(3) NOT NULL,
 UNIQUE (department_id,actor_user_id,idempotency_key),
 UNIQUE (id,case_id,department_id),
 FOREIGN KEY (case_id,department_id) REFERENCES cases(id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY (actor_user_id,department_id) REFERENCES department_memberships(user_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY (inventory_version_id,case_id,department_id)
  REFERENCES case_refund_inventory_versions(id,case_id,department_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY (prior_version_id,case_id,department_id)
  REFERENCES case_refund_inventory_versions(id,case_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE case_litigation_refund_item_meta (
 inventory_version_id uuid NOT NULL,
 item_id uuid NOT NULL,
 source_type varchar(40) CHECK (source_type IN ('JUDGMENT','SECOND_INSTANCE_RESULT')),
 source_id uuid,
 trial_round_id uuid,
 remark varchar(1000),
 PRIMARY KEY (inventory_version_id,item_id),
 CHECK ((source_type IS NULL AND source_id IS NULL AND trial_round_id IS NULL)
     OR (source_type IS NOT NULL AND source_id IS NOT NULL AND trial_round_id IS NOT NULL)),
 FOREIGN KEY (inventory_version_id,item_id)
  REFERENCES case_refund_inventory_items(inventory_version_id,item_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE FUNCTION guard_litigation_refund_append() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'litigation refund history requires serializable append' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='case_litigation_refund_item_meta' AND NOT EXISTS (
  SELECT 1 FROM case_refund_inventory_items i
  WHERE i.inventory_version_id=NEW.inventory_version_id AND i.item_id=NEW.item_id
   AND i.xmin=pg_current_xact_id()::text::xid
 ) THEN RAISE EXCEPTION 'refund metadata requires same-transaction item' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER litigation_refund_command_immutable BEFORE INSERT OR UPDATE OR DELETE
 ON case_litigation_refund_commands FOR EACH ROW EXECUTE FUNCTION guard_litigation_refund_append();
CREATE TRIGGER litigation_refund_meta_immutable BEFORE INSERT OR UPDATE OR DELETE
 ON case_litigation_refund_item_meta FOR EACH ROW EXECUTE FUNCTION guard_litigation_refund_append();

-- New path validates its own grant and current ownership. The historical
-- financial command still runs through assert_case_financial_actor_draft.
CREATE FUNCTION assert_litigation_refund_actor(
 target_actor uuid,target_case uuid,target_department uuid,target_audit uuid,
 target_version uuid,target_kind text
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE u user_accounts%ROWTYPE; c cases%ROWTYPE; a audit_events%ROWTYPE;
 member department_memberships%ROWTYPE; action_name text;
BEGIN
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'refund follow requires serializable transaction' USING ERRCODE='23514';
 END IF;
 IF NOT pg_try_advisory_xact_lock(hashtextextended('organization:'||target_department::text,0)) THEN
  RAISE EXCEPTION 'refund authorization facts busy' USING ERRCODE='55P03';
 END IF;
 SELECT * INTO u FROM user_accounts WHERE id=target_actor FOR SHARE NOWAIT;
 SELECT * INTO member FROM department_memberships WHERE user_id=target_actor AND department_id=target_department FOR SHARE NOWAIT;
 PERFORM id FROM role_assignments WHERE user_id=target_actor AND department_id=target_department ORDER BY id FOR SHARE NOWAIT;
 PERFORM id FROM role_templates WHERE id IN (
  SELECT role_template_id FROM role_assignments WHERE user_id=target_actor AND department_id=target_department
 ) ORDER BY id FOR SHARE NOWAIT;
 PERFORM id FROM role_grants WHERE role_template_id IN (
  SELECT role_template_id FROM role_assignments WHERE user_id=target_actor AND department_id=target_department
 ) ORDER BY id FOR SHARE NOWAIT;
 SELECT * INTO c FROM cases WHERE id=target_case AND department_id=target_department FOR UPDATE NOWAIT;
 SELECT * INTO a FROM audit_events WHERE id=target_audit FOR SHARE NOWAIT;
 action_name:=CASE WHEN target_kind='FOLLOW' THEN 'case.refund.follow' ELSE 'case.refund.record' END;
 IF u.id IS NULL OR u.active IS NOT TRUE OR u.account_type<>'INTERNAL'
  OR member.user_id IS NULL OR member.active IS NOT TRUE
  OR jsonb_typeof(a.details->'authorizationRevision') IS DISTINCT FROM 'number'
  OR u.authorization_revision IS DISTINCT FROM (a.details->>'authorizationRevision')::integer
  OR c.id IS NULL OR a.id IS NULL OR a.department_id IS DISTINCT FROM target_department
  OR a.actor_kind::text IS DISTINCT FROM 'HUMAN'
  OR a.actor_user_id IS DISTINCT FROM target_actor OR a.internal_actor_user_id IS DISTINCT FROM target_actor
  OR a.resource_type IS DISTINCT FROM 'CASE_REFUND_INVENTORY_VERSION' OR a.resource_id IS DISTINCT FROM target_version
  OR a.action IS DISTINCT FROM 'CASE_REFUND_INVENTORY_RECORD'
  OR a.customer_account_binding_id IS NOT NULL OR a.lawyer_account_binding_id IS NOT NULL
  OR a.notary_office_account_binding_id IS NOT NULL
  OR NOT EXISTS (
   SELECT 1 FROM role_assignments r JOIN role_templates t ON t.id=r.role_template_id
   JOIN role_grants g ON g.role_template_id=t.id
   WHERE r.user_id=target_actor AND r.department_id=target_department AND r.active
    AND t.department_id=target_department AND t.active AND g.action=action_name::permission_action
    AND (g.scope='DEPARTMENT' OR (g.scope='SELF' AND c.responsible_user_id=target_actor))
  )
  OR NOT EXISTS (
   SELECT 1 FROM role_assignments r JOIN role_templates t ON t.id=r.role_template_id
   JOIN role_grants g ON g.role_template_id=t.id
   WHERE r.user_id=target_actor AND r.department_id=target_department AND r.active
    AND t.department_id=target_department AND t.active AND g.action='case.read'
    AND (g.scope='DEPARTMENT' OR (g.scope='SELF' AND c.responsible_user_id=target_actor))
  )
 THEN RAISE EXCEPTION 'litigation refund actor unauthorized or stale' USING ERRCODE='23514'; END IF;
END; $$;

CREATE OR REPLACE FUNCTION guard_case_financial_actor_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_action text; expected_resource text; allowed text[];
 new_command case_litigation_refund_commands%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'financial history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='case_refund_inventory_versions' THEN
  SELECT * INTO new_command FROM case_litigation_refund_commands p
   WHERE p.inventory_version_id=NEW.id AND p.case_id=NEW.case_id
    AND p.department_id=NEW.department_id AND p.actor_user_id=NEW.recorded_by_user_id
    AND p.xmin=pg_current_xact_id()::text::xid;
  IF new_command.id IS NOT NULL THEN
   PERFORM assert_litigation_refund_actor(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,
    NEW.audit_event_id,NEW.id,new_command.kind);
   RETURN NEW;
  END IF;
 END IF;
 IF TG_TABLE_NAME='case_closure_payment_versions' THEN
  expected_resource := 'CASE_CLOSURE_PAYMENT_VERSION';
  expected_action := CASE WHEN NEW.revision=1 THEN 'CASE_CLOSURE_PAYMENT_RECORD'
   WHEN NEW.state='VOID' THEN 'CASE_CLOSURE_PAYMENT_VOID' ELSE 'CASE_CLOSURE_PAYMENT_CORRECT' END;
  allowed := ARRAY['WAITING_ARCHIVE','ARCHIVED'];
 ELSIF TG_TABLE_NAME='case_refund_inventory_versions' THEN
  expected_resource := 'CASE_REFUND_INVENTORY_VERSION';
  SELECT CASE WHEN NEW.declaration='UNKNOWN' OR (NEW.declaration='COMPLETE' AND EXISTS (
   SELECT 1 FROM case_refund_inventory_versions p WHERE p.id=NEW.prior_version_id AND p.declaration='COMPLETE'))
   THEN 'CASE_REFUND_INVENTORY_RECORD' ELSE 'CASE_REFUND_INVENTORY_CONFIRM' END INTO expected_action;
  allowed := ARRAY['WAITING_ARCHIVE'];
 ELSIF TG_TABLE_NAME='case_settlement_assessment_versions' THEN
  expected_resource := 'CASE_SETTLEMENT_ASSESSMENT_VERSION';
  expected_action := 'CASE_SETTLEMENT_ASSESSMENT_RECORD';
  allowed := ARRAY['WAITING_ARCHIVE','ARCHIVED'];
 ELSE RAISE EXCEPTION 'unsupported financial authorization target' USING ERRCODE='23514'; END IF;
 PERFORM assert_case_financial_actor_draft(NEW.recorded_by_user_id,NEW.case_id,NEW.department_id,
  NEW.audit_event_id,NEW.id,expected_resource,expected_action,allowed);
 IF NOT EXISTS (SELECT 1 FROM case_closures h JOIN case_closure_versions v
  ON v.id=h.current_version_id AND v.closure_id=h.id
   AND v.case_id=h.case_id AND v.department_id=h.department_id
  WHERE h.case_id=NEW.case_id AND h.department_id=NEW.department_id
   AND (TG_TABLE_NAME='case_refund_inventory_versions'
    OR v.id::text=to_jsonb(NEW)->>'closure_version_id')) THEN
  RAISE EXCEPTION 'financial write requires exact current same-case closure' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

-- The original settlement child route stays byte-for-byte equivalent. Only
-- inventory versions/items, never old receipts, may use the new parent.
CREATE OR REPLACE FUNCTION require_settlement_command_child_parent_final() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE child_id uuid; child_kind text;
BEGIN
 IF TG_RELID='case_settlement_assessment_versions'::regclass THEN
  child_id:=NEW.id; child_kind:='ASSESSMENT';
 ELSIF TG_RELID='case_settlement_assessment_receipts'::regclass THEN
  child_id:=NEW.assessment_version_id; child_kind:='ASSESSMENT';
 ELSIF TG_RELID='case_refund_inventory_versions'::regclass THEN
  child_id:=NEW.id; child_kind:='REFUND';
 ELSIF TG_RELID='case_refund_inventory_items'::regclass OR TG_RELID='case_refund_inventory_receipts'::regclass THEN
  child_id:=NEW.inventory_version_id; child_kind:='REFUND';
 ELSE RAISE EXCEPTION 'unsupported settlement child target' USING ERRCODE='23514'; END IF;
 IF child_kind='REFUND' AND TG_RELID<>'case_refund_inventory_receipts'::regclass
  AND EXISTS (
   SELECT 1 FROM case_litigation_refund_commands p JOIN case_refund_inventory_versions v
    ON v.id=p.inventory_version_id AND v.case_id=p.case_id AND v.department_id=p.department_id
   WHERE p.inventory_version_id=child_id AND p.xmin=pg_current_xact_id()::text::xid
    AND v.xmin=pg_current_xact_id()::text::xid
  ) THEN RETURN NEW; END IF;
 IF child_kind='ASSESSMENT' THEN
  IF EXISTS (
   SELECT 1 FROM case_settlement_assessment_versions v JOIN case_settlement_assessment_receipts c
    ON c.assessment_version_id=v.id AND c.case_id=v.case_id AND c.department_id=v.department_id
     AND c.actor_user_id=v.recorded_by_user_id AND c.audit_event_id=v.audit_event_id
   JOIN case_closure_amount_update_receipts p ON p.assessment_version_id=v.id
    AND p.case_id=v.case_id AND p.department_id=v.department_id AND p.actor_user_id=v.recorded_by_user_id
    AND p.closure_version_id=v.closure_version_id AND p.terms_version IS NOT DISTINCT FROM v.terms_version
   WHERE v.id=child_id AND v.xmin=pg_current_xact_id()::text::xid
    AND c.xmin=pg_current_xact_id()::text::xid AND p.xmin=pg_current_xact_id()::text::xid
  ) THEN RETURN NEW; END IF;
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM case_settlement_update_child_links l
  JOIN case_closure_settlement_update_receipts p ON p.case_id=l.case_id AND p.department_id=l.department_id
   AND p.actor_user_id=l.actor_user_id AND p.idempotency_key=l.parent_key AND p.request_fingerprint=l.request_fingerprint
   AND ((child_kind='ASSESSMENT' AND p.assessment_included AND p.assessment_version_id=l.child_version_id)
     OR (child_kind='REFUND' AND p.refund_included AND p.refund_version_id=l.child_version_id))
  WHERE l.kind=child_kind AND l.child_version_id=child_id
   AND l.xmin=pg_current_xact_id()::text::xid AND p.xmin=pg_current_xact_id()::text::xid
 ) THEN RAISE EXCEPTION 'settlement child requires its exact atomic command parent' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION validate_litigation_refund_command() RETURNS trigger LANGUAGE plpgsql AS $$
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
  SELECT 1 FROM case_refund_inventory_items old WHERE old.inventory_version_id=prior.id
   AND NOT EXISTS (SELECT 1 FROM case_refund_inventory_items n
     WHERE n.inventory_version_id=v.id AND n.item_id=old.item_id)
 ) THEN RAISE EXCEPTION 'refund revision cannot replace other identities' USING ERRCODE='23514'; END IF;
 IF p.kind='REGISTER' AND EXISTS (
  SELECT 1 FROM case_refund_inventory_items n JOIN case_refund_inventory_items old
   ON old.inventory_version_id=prior.id AND old.item_id=n.item_id
  LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=n.inventory_version_id AND a.item_id=n.item_id
  LEFT JOIN case_refund_inventory_item_amounts b ON b.inventory_version_id=old.inventory_version_id AND b.item_id=old.item_id
  WHERE n.inventory_version_id=v.id AND
   (n.party<>old.party OR n.status<>old.status OR n.description<>old.description OR a.amount IS DISTINCT FROM b.amount)
 ) THEN RAISE EXCEPTION 'refund registration cannot alter prior items' USING ERRCODE='23514'; END IF;
 IF p.kind='FOLLOW' AND EXISTS (
  SELECT 1 FROM case_refund_inventory_items i JOIN case_refund_inventory_items old
   ON old.inventory_version_id=prior.id AND old.item_id=i.item_id
  LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id
  LEFT JOIN case_refund_inventory_item_amounts b ON b.inventory_version_id=old.inventory_version_id AND b.item_id=old.item_id
  WHERE i.inventory_version_id=v.id AND
   (i.party<>old.party OR i.description<>old.description OR a.amount IS DISTINCT FROM b.amount
    OR (i.item_id<>p.item_id AND i.status<>old.status))
 ) THEN RAISE EXCEPTION 'refund follow may change only target status' USING ERRCODE='23514'; END IF;
 IF p.kind='CORRECT' AND EXISTS (
  SELECT 1 FROM case_refund_inventory_items i JOIN case_refund_inventory_items old
   ON old.inventory_version_id=prior.id AND old.item_id=i.item_id
  LEFT JOIN case_refund_inventory_item_amounts a ON a.inventory_version_id=i.inventory_version_id AND a.item_id=i.item_id
  LEFT JOIN case_refund_inventory_item_amounts b ON b.inventory_version_id=old.inventory_version_id AND b.item_id=old.item_id
  WHERE i.inventory_version_id=v.id AND
   (i.item_id<>p.item_id AND (i.party<>old.party OR i.description<>old.description
      OR a.amount IS DISTINCT FROM b.amount OR i.status<>old.status))
 ) THEN RAISE EXCEPTION 'refund correction may change only target registration' USING ERRCODE='23514'; END IF;
 IF p.kind='CORRECT' AND EXISTS (
  SELECT 1 FROM case_refund_inventory_items n JOIN case_refund_inventory_items old
   ON old.inventory_version_id=prior.id AND old.item_id=n.item_id
  WHERE n.inventory_version_id=v.id AND n.item_id=p.item_id AND n.status<>old.status
 ) THEN RAISE EXCEPTION 'refund correction cannot change follow status' USING ERRCODE='23514'; END IF;
 IF p.kind IN ('REGISTER','CORRECT') AND EXISTS (
  SELECT 1 FROM case_litigation_refund_item_meta n
  LEFT JOIN case_litigation_refund_item_meta old ON old.inventory_version_id=prior.id AND old.item_id=n.item_id
  WHERE n.inventory_version_id=v.id AND n.item_id<>p.item_id AND old.item_id IS NOT NULL AND
   (n.source_type IS DISTINCT FROM old.source_type OR n.source_id IS DISTINCT FROM old.source_id
    OR n.trial_round_id IS DISTINCT FROM old.trial_round_id OR n.remark IS DISTINCT FROM old.remark)
 ) THEN RAISE EXCEPTION 'refund registration cannot alter other source metadata' USING ERRCODE='23514'; END IF;
 IF p.kind='CORRECT' AND EXISTS (
  SELECT 1 FROM case_litigation_refund_item_meta n
  LEFT JOIN case_litigation_refund_item_meta old ON old.inventory_version_id=prior.id AND old.item_id=n.item_id
  WHERE n.inventory_version_id=v.id AND n.item_id=p.item_id AND old.item_id IS NOT NULL
   AND n.remark IS DISTINCT FROM old.remark
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
  LEFT JOIN case_litigation_refund_item_meta old ON old.inventory_version_id=prior.id AND old.item_id=n.item_id
  WHERE n.inventory_version_id=v.id AND old.item_id IS NOT NULL AND
   (n.source_type IS DISTINCT FROM old.source_type OR n.source_id IS DISTINCT FROM old.source_id
    OR n.trial_round_id IS DISTINCT FROM old.trial_round_id
    OR (n.item_id<>p.item_id AND n.remark IS DISTINCT FROM old.remark))
 ) THEN RAISE EXCEPTION 'refund follow may change only target remark' USING ERRCODE='23514'; END IF;
 PERFORM validate_case_refund_inventory_snapshot(v.id);
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER litigation_refund_command_complete AFTER INSERT ON case_litigation_refund_commands
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_litigation_refund_command();

COMMIT;
