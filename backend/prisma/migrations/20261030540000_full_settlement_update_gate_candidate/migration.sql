-- LOCAL REVIEW CANDIDATE, NOT EXECUTED. Requires an independently fixed formal chain.
BEGIN;
DO $verify$ DECLARE spec record; installed record; BEGIN
 FOR spec IN SELECT * FROM (VALUES
  ('guard_case_settlement_assessment_draft','','trigger','v','f642128fc56a617a69454d6fb5fa2a524a2cb85043d6c0d916df1fb5feffb095'),
  ('guard_case_settlement_assessment_version','','trigger','v','4095ce08b8fb08f8406c7a05d49c6c51c119c4e3c0d8733cc34fe72f990dca4c'),
  ('check_case_settlement_assessment_receipt','','trigger','v','4c4d9112880c56f0ef9bb2d89f8e676acc4f1e05814f5c6db19331938726ebf2'),
  ('guard_case_settlement_assessment_audit','','trigger','v','1b4453736e9e8e7d1ec52bc90dc5e562cf617fe683a6cde753c26bed2d04c989'),
  ('guard_closure_amount_receipt_closed_draft','','trigger','v','2b79d4513488c7085f72e57bba9f84f16193221890a9e21bc17e4ecfe6907a63'),
  ('guard_closure_amount_receipt_immutable_draft','','trigger','v','b9a77820ee932b54c41e458d6381699e7d305a3f2ec8784523bbbeb7ebdb31fa'),
  ('check_closure_amount_receipt_draft','','trigger','v','112dd1fa7ba1de4183dc7fdbe6830c515d0d3062dfaa917f55842dbc2e484d7a'),
  ('guard_case_financial_actor_draft','','trigger','v','3b0ab62af4d87a6a3882193a77c51c5b6a537616547b7693b9f5705dcd6e6c27'),
  ('assert_case_financial_actor_draft','uuid,uuid,uuid,uuid,uuid,text,text,text[]','void','v','d5f368ecd4ecfbcb5b4d5042af81ba7d1ecf639ac910527a3778fbac128caadd'),
  ('guard_settlement_upload_target_draft','','trigger','v','1042346e9f3742816089e096a4f8fa9b51a15d03506b34270286a963753a1466'),
  ('check_settlement_upload_target_source','','trigger','v','fba30481a9eac5ef2ac2a4882b38a948c8c21d466d2fd54a346ae20182b6978b'),
  ('check_settlement_upload_target_identity','','trigger','v','b0b4412daa07522bcb6c69e173ab01dc0a4cb60ee729b122d0fc1a5819421f4f'),
  ('check_settlement_upload_target_reverse_final','','trigger','v','31edd0a3f102ec578280447810a9a0f661c7e26279c22b122ce549f52eb3d024'),
  ('reject_settlement_upload_target_mutation','','trigger','v','23e1582df0477f360a3d945f4d94a69d5663e6b1f7ba93723888dee41f0d5f8b'),
  ('settlement_update_document_upload_eligible','uuid,uuid,uuid,uuid,integer','boolean','s','10e803069a0b2f6d785f76e3b5183a09bfcbd239de0671cef2e2549885de8eba'),
  ('lock_settlement_upload_actor_current','uuid,uuid,uuid,integer','void','v','0d0ae1ea120d1c0a028740f56d9ab2e79e58a3b1e6195841a08d62067c9ea222'),
  ('guard_zero_archive_snapshot_gate','','trigger','v','d8858d7116d7e3743d211e7e067db91a7e881917fcbe887b55a5bf42d5df1013'),
  ('guard_case_archive_evidence_snapshot','','trigger','v','ba909139ee7067603342e2c742b4806ce4ff6b67312482c979fc57a5af1697e9'),
  ('guard_case_archive_snapshot_item','','trigger','v','b6438d909cb9c3a76fc846433913e34d6a9d327b1f4a913d4a170bc64784edca'),
  ('validate_case_archive_evidence_snapshot','uuid','void','v','1fddf0bcbff3d803c0c45a1f99696704f5240c72e105945443afed4e69bce0a3'),
  ('check_case_archive_evidence_snapshot','','trigger','v','d69eadf312351a08cdb355f38fc5800552649b652d39a36d191bee97654ad91f'),
  ('guard_archive_snapshot_source_order','','trigger','v','111a60f72b1639e282f5bfbab012772c62748d2f05eae70cbfa86bb5cb9ffbbc'),
  ('validate_archive_snapshot_readiness','uuid','void','v','cb53b32232e24d1802764d0eead03dee23919812243a99e22b87032a1aa94711'),
  ('check_archive_snapshot_readiness','','trigger','v','2f9f323ff73dc3b2929a4c5a94ed010b31bebe1fad4b43fa4a2e526746eb82d4'),
  ('check_new_archive_required_financial_snapshot_draft','','trigger','v','f1ea323f3ca7478c4c6ecd583bd5324559237574da8290fd9d41a82076043c64'),
  ('guard_case_closure_payment_draft','','trigger','v','f4c53f74ddcabe41e689d9ec3cfa51ec59997ff2d2809074e7ebd46a89071f10'),
  ('check_case_closure_payment_version','','trigger','v','b5ed54691c2c97449193127f99f328b10ae013277abf63d29959456e9bfc183c'),
  ('check_case_closure_effective_payment_type','','trigger','v','d47703bc5daf0a68b87a54e6bd014b8c3b3bddccba058e8ab736c84b2d8f800e'),
  ('check_case_closure_payment_receipt','','trigger','v','15d949757e50b31f57572d821eaf9b7117861c8059a382c59356cdc178c06850'),
  ('check_early_closure_initial_payment_actor_draft','','trigger','v','9b5cc99a3262ed616e38b2085f1810f89b859a6cba8e501b343983086937de32'),
  ('seal_original_payment_document_insert_draft','','trigger','v','ae01989a1a15d187c751f81f104aa8b0d31e76e97a59e7f1d71056af80c6cbc9'),
  ('check_original_payment_evidence_complete_draft','','trigger','v','52b6cb22f0abb97ebf4815cbd9ba482575f9a3282124bbf689cc78e50232a5b4'),
  ('guard_early_closure_actor_draft','','trigger','v','cc3113633dd7a5bc785c9a413adee44dd20edd7cc195678562cb1cde940ff1a0'),
  ('check_early_closure_source_authorization_revision_draft','','trigger','v','30f03717687b3cd1f17edeaa44b6cc377c8d19fe3cd7a0aa552b25c7bb3e0f42'),
  ('check_early_closure_register_receipt_final_draft','','trigger','v','dd5e026f059add01b8fbcc689c27d6a3753370f310acddfe22a5ff01d0ffcf36'),
  ('guard_early_zero_source_gate','','trigger','v','ed0b0581ecc7f91b7f774f0ff9484ada84fda4d5c5d08f099de8f8c096bacc5d'),
  ('check_early_zero_source_final','','trigger','v','369966b0064276f1fa4ae41ee96d4a6e088cb8fd6b8d1ae543af07acfc265999'),
  ('guard_zero_typed_closure_gate','','trigger','v','a4c0f431bd7e637bc07517e0d71a0b4f31e56964b19a974b09192f2d019b623b'),
  ('guard_early_typed_closure_register_gate','','trigger','v','fe56933fe58b3d2645918fcd282b21c2300e5aade30ef4266b1c450977618432'),
  ('guard_early_initial_payment_record_gate','','trigger','v','b9e840c98599147c1d023abf542cde306bdcba814d4c515898e5bfd75abcf5d1'),
  ('check_early_initial_payment_source_final','','trigger','v','defea6956d2ec9fe7f952b87a82765881b1ec7f772e72380db3277220e69c3e2'),
  ('validate_early_initial_payment_source','uuid,uuid,uuid','void','v','4ca5a0f04bc5a7ef696219c4d647c4ecac9384bc10c70d34bfa03e0be785e983'),
  ('guard_case_refund_inventory_draft','','trigger','v','a72c137827fedbc31cfbdc0e0dd9711aa1e1ab296e79be86d69a8ba9edf5ad09'),
  ('guard_case_refund_inventory_version','','trigger','v','f4e37714cddbe9d420e10925bffea58b789486287bac2e823e69b09f2d3780a1'),
  ('guard_case_refund_inventory_item','','trigger','v','9095d81e8be419abb645709344389fcf05eb91bd4e5f5f4ab299fee9499faff5'),
  ('validate_case_refund_inventory_snapshot','uuid','void','v','57f84355a172528f08b0e203c4cd332fd1e6fc086d50623ff839d09628698f20'),
  ('check_case_refund_inventory_receipt','','trigger','v','94a86a91b8e49714fe45a95cc2ee868f540b80fa25fd7c7daf1c9c0dfabab698'),
  ('guard_case_refund_inventory_receipt_seal','','trigger','v','64022973c564e6b39c25a26b18735559d701155ee88d9df4ef86488effc97b03'),
  ('check_refund_composition_parent','','trigger','v','15d3412c292d9a58076c8e486a92423cf470b87766c2edd2828963e20f3840c7'),
  ('guard_closure_settlement_update_receipt_draft','','trigger','v','24428d17a8bdf40ae38b1d5859fa1857d1877bbb4fdf6ab804e098d5e323e2dd'),
  ('reject_closure_settlement_update_mutation','','trigger','v','252c701f040882d9fc8a7bbadcbf15a3972cd28bcfb9297080151783e7daae0d'),
  ('check_closure_settlement_update_receipt_final','','trigger','v','c1386f7b12fc3d6120d1fa818e3d4bc167b4dc93ea6e91e74e130952c8851e40')
 ) expected(function_name,arguments,return_type,volatility,body_sha256) LOOP
  SELECT p.oid,p.prosrc,l.lanname,p.prorettype,p.prosecdef,p.proconfig,p.provolatile INTO installed
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE p.oid=to_regprocedure(format('%I.%I(%s)',current_schema(),spec.function_name,spec.arguments)) AND n.nspname=current_schema();
  IF installed.oid IS NULL OR installed.lanname IS DISTINCT FROM 'plpgsql' OR installed.prosecdef OR installed.proconfig IS NOT NULL
   OR installed.prorettype IS DISTINCT FROM spec.return_type::regtype::oid OR installed.provolatile::text IS DISTINCT FROM spec.volatility
   OR encode(sha256(convert_to(replace(installed.prosrc,E'\r\n',E'\n'),'UTF8')),'hex') IS DISTINCT FROM spec.body_sha256 THEN
   RAISE EXCEPTION 'unexpected next-gate prerequisite function %',spec.function_name USING ERRCODE='23514';
  END IF;
 END LOOP;
 FOR spec IN SELECT * FROM (VALUES
  ('case_settlement_assessment_versions','case_settlement_assessment_draft_gate','guard_case_settlement_assessment_draft',31,false),
  ('case_settlement_assessment_versions','case_settlement_assessment_guard','guard_case_settlement_assessment_version',31,false),
  ('case_settlement_assessment_versions','case_settlement_assessment_actor_draft_guard','guard_case_financial_actor_draft',31,false),
  ('case_settlement_assessment_receipts','case_settlement_assessment_receipt_draft_gate','guard_case_settlement_assessment_draft',31,false),
  ('case_settlement_assessment_receipts','case_settlement_assessment_receipt_consistency','check_case_settlement_assessment_receipt',31,false),
  ('audit_events','case_settlement_assessment_audit_guard','guard_case_settlement_assessment_audit',27,false),
  ('case_closure_amount_update_receipts','closure_amount_receipt_closed_draft','guard_closure_amount_receipt_closed_draft',31,false),
  ('case_closure_amount_update_receipts','closure_amount_receipt_immutable_draft','guard_closure_amount_receipt_immutable_draft',27,false),
  ('case_closure_amount_update_receipts','closure_amount_receipt_final_draft','check_closure_amount_receipt_draft',5,true),
  ('case_settlement_upload_targets','settlement_upload_target_draft_gate','guard_settlement_upload_target_draft',31,false),
  ('case_settlement_upload_targets','settlement_upload_target_source_guard','check_settlement_upload_target_source',7,false),
  ('case_settlement_upload_targets','settlement_upload_target_reverse_final','check_settlement_upload_target_reverse_final',5,true),
  ('case_settlement_upload_targets','settlement_upload_target_immutable','reject_settlement_upload_target_mutation',27,false),
  ('upload_drafts','settlement_upload_target_identity_guard','check_settlement_upload_target_identity',23,false),
  ('upload_drafts','case_closure_upload_actor_guard','check_case_closure_upload_actor',23,false),
  ('case_archive_evidence_snapshots','case_archive_snapshot_draft_gate','guard_zero_archive_snapshot_gate',31,false),
  ('case_archive_snapshot_payments','case_archive_snapshot_payment_draft_gate','guard_zero_archive_snapshot_gate',31,false),
  ('case_archive_snapshot_allocations','case_archive_snapshot_allocation_draft_gate','guard_zero_archive_snapshot_gate',31,false),
  ('case_archive_evidence_snapshots','case_archive_evidence_snapshot_guard','guard_case_archive_evidence_snapshot',31,false),
  ('case_archive_snapshot_payments','case_archive_snapshot_payment_guard','guard_case_archive_snapshot_item',31,false),
  ('case_archive_snapshot_allocations','case_archive_snapshot_allocation_guard','guard_case_archive_snapshot_item',31,false),
  ('case_archive_evidence_snapshots','case_archive_evidence_snapshot_complete','check_case_archive_evidence_snapshot',5,true),
  ('case_archive_snapshot_payments','case_archive_snapshot_payment_complete','check_case_archive_evidence_snapshot',5,true),
  ('case_archive_snapshot_allocations','case_archive_snapshot_allocation_complete','check_case_archive_evidence_snapshot',5,true),
  ('case_archive_evidence_snapshots','archive_snapshot_readiness_protocol','check_archive_snapshot_readiness',5,true),
  ('case_archive_snapshot_payments','archive_snapshot_payment_readiness_protocol','check_archive_snapshot_readiness',5,true),
  ('case_archive_snapshot_allocations','archive_snapshot_allocation_readiness_protocol','check_archive_snapshot_readiness',5,true),
  ('case_archive_versions','new_archive_required_financial_snapshot_draft','check_new_archive_required_financial_snapshot_draft',5,true),
  ('case_early_closures','case_early_closures_structure_guard','guard_early_zero_source_gate',31,false),
  ('case_early_closure_receipts','case_early_closure_receipts_structure_guard','guard_early_zero_source_gate',31,false),
  ('case_early_closures','early_closure_actor_draft_guard','guard_early_closure_actor_draft',7,false),
  ('case_early_closures','early_closure_source_authorization_revision_draft','check_early_closure_source_authorization_revision_draft',7,false),
  ('case_early_closures','early_closure_register_receipt_final_draft','check_early_closure_register_receipt_final_draft',5,true),
  ('case_closure_versions','closure_payment_type_draft_guard','guard_early_typed_closure_register_gate',23,false),
  ('case_closures','closure_payment_effective_count','check_case_closure_effective_payment_type',21,true),
  ('case_closure_payment_versions','closure_payment_version_effective_count','check_case_closure_effective_payment_type',5,true),
  ('case_closure_payment_versions','case_closure_payment_draft_guard','guard_early_initial_payment_record_gate',31,false),
  ('case_closure_payment_documents','case_closure_payment_document_draft_guard','guard_case_closure_payment_draft',31,false),
  ('case_closure_payment_receipts','closure_payment_receipt_draft_gate','guard_early_initial_payment_record_gate',31,false),
  ('case_closure_payment_versions','case_closure_payment_version_guard','check_case_closure_payment_version',31,false),
  ('case_closure_payment_receipts','closure_payment_receipt_consistency','check_case_closure_payment_receipt',31,false),
  ('case_closure_payment_versions','case_closure_payment_actor_draft_guard','guard_case_financial_actor_draft',31,false),
  ('case_closure_payment_versions','early_closure_initial_payment_actor_draft','check_early_closure_initial_payment_actor_draft',7,false),
  ('case_closure_payment_versions','early_closure_initial_payment_actor_final_draft','check_early_closure_initial_payment_actor_draft',5,true),
  ('case_closure_payment_documents','original_payment_document_insert_seal_draft','seal_original_payment_document_insert_draft',7,false),
  ('case_closure_payment_versions','original_payment_evidence_version_complete_draft','check_original_payment_evidence_complete_draft',5,true),
  ('case_closure_payment_receipts','original_payment_evidence_receipt_complete_draft','check_original_payment_evidence_complete_draft',5,true),
  ('case_closure_payment_documents','original_payment_evidence_document_complete_draft','check_original_payment_evidence_complete_draft',5,true),
  ('material_references','original_payment_evidence_reference_complete_draft','check_original_payment_evidence_complete_draft',5,true),
  ('case_early_closures','early_initial_payment_source_final','check_early_initial_payment_source_final',5,true),
  ('case_closure_payment_versions','early_initial_payment_version_set_final','check_early_initial_payment_source_final',5,true),
  ('case_closure_payment_receipts','early_initial_payment_receipt_set_final','check_early_initial_payment_source_final',5,true),
  ('case_closure_settlement_update_receipts','closure_settlement_update_receipt_gate','guard_closure_settlement_update_receipt_draft',31,false),
  ('case_closure_settlement_update_payments','closure_settlement_update_payment_gate','guard_closure_settlement_update_receipt_draft',31,false),
  ('case_closure_settlement_update_receipts','closure_settlement_update_receipt_final','check_closure_settlement_update_receipt_final',5,true),
  ('case_closure_settlement_update_payments','closure_settlement_update_payment_final','check_closure_settlement_update_receipt_final',5,true),
  ('case_closure_settlement_update_receipts','closure_settlement_update_receipt_immutable','reject_closure_settlement_update_mutation',27,false),
  ('case_closure_settlement_update_payments','closure_settlement_update_payment_immutable','reject_closure_settlement_update_mutation',27,false),
  ('case_refund_inventory_versions','case_refund_inventory_draft_gate','guard_case_refund_inventory_draft',31,false),
  ('case_refund_inventory_items','case_refund_inventory_item_draft_gate','guard_case_refund_inventory_draft',31,false),
  ('case_refund_inventory_receipts','refund_inventory_receipt_draft_gate','guard_case_refund_inventory_draft',31,false),
  ('case_refund_inventory_items','refund_inventory_receipt_item_seal','guard_case_refund_inventory_receipt_seal',7,false),
  ('case_refund_inventory_receipts','refund_inventory_receipt_consistency','check_case_refund_inventory_receipt',29,true),
  ('case_settlement_update_child_links','refund_composition_draft_gate','guard_case_refund_inventory_draft',31,false),
  ('case_settlement_update_child_links','refund_composition_parent_final','check_refund_composition_parent',29,true)
 ) expected(table_name,trigger_name,function_name,trigger_type,is_deferred) LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
   WHERE t.tgrelid=to_regclass(format('%I.%I',current_schema(),spec.table_name)) AND t.tgname=spec.trigger_name
    AND t.tgfoid=to_regprocedure(format('%I.%I()',current_schema(),spec.function_name)) AND t.tgtype::integer=spec.trigger_type
    AND t.tgenabled='O' AND NOT t.tgisinternal AND t.tgdeferrable=spec.is_deferred AND t.tginitdeferred=spec.is_deferred
    AND t.tgparentid=0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgargs=''::bytea AND t.tgattr::text='') THEN
   RAISE EXCEPTION 'unexpected next-gate prerequisite trigger %.%',spec.table_name,spec.trigger_name USING ERRCODE='23514';
  END IF;
 END LOOP;
END; $verify$;
DO $branch$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname=current_schema() AND p.oid=to_regprocedure(format('%I.check_case_closure_upload_actor()',current_schema()))
   AND position('NEW.settlement_update_upload_target_id IS NOT NULL' IN p.prosrc)>0
   AND position('settlement_update_document_upload_eligible' IN p.prosrc)>0) THEN
  RAISE EXCEPTION 'settlement upload actor branch absent' USING ERRCODE='23514';
 END IF;
END; $branch$;
-- FULL ATOMIC SETTLEMENT UPDATE CANDIDATE. No actual funding/invoice or payment screenshot writer is opened.

-- Smallest complete next command: CaseClosureAmountUpdateDraftService.update.
-- No closure correction, payment, refund, upload or archive gate is changed.
-- Existing 3010/3024/3025/3042 source, audit, amount and receipt constraints stay.
CREATE OR REPLACE FUNCTION guard_case_settlement_assessment_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'assessment history remains immutable' USING ERRCODE='23514';
 END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'amount assessment requires serializable transaction' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION guard_closure_amount_receipt_closed_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'closure amount receipt remains immutable' USING ERRCODE='23514';
 END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'closure amount command requires serializable transaction' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;


-- Reuse original immutable refund/item/receipt and 1700 parent-link validators.
CREATE OR REPLACE FUNCTION guard_case_refund_inventory_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'refund composition requires immutable serializable inserts' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION guard_closure_settlement_update_receipt_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' OR current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'settlement command requires immutable serializable inserts' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

-- Bind newly enabled children back to an existing command contract. Assessment
-- accepts either the independent 3042 amount command OR the 3016/1700 command;
-- refund accepts the latter. The original parent validators certify contents.
CREATE FUNCTION require_settlement_command_child_parent_final() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE CONSTRAINT TRIGGER settlement_assessment_version_command_final AFTER INSERT ON case_settlement_assessment_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_settlement_command_child_parent_final();
CREATE CONSTRAINT TRIGGER settlement_assessment_receipt_command_final AFTER INSERT ON case_settlement_assessment_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_settlement_command_child_parent_final();
CREATE CONSTRAINT TRIGGER settlement_refund_version_command_final AFTER INSERT ON case_refund_inventory_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_settlement_command_child_parent_final();
CREATE CONSTRAINT TRIGGER settlement_refund_item_command_final AFTER INSERT ON case_refund_inventory_items
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_settlement_command_child_parent_final();
CREATE CONSTRAINT TRIGGER settlement_refund_receipt_command_final AFTER INSERT ON case_refund_inventory_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_settlement_command_child_parent_final();

CREATE FUNCTION require_typed_settlement_correction_parent_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.kind='CORRECT' AND NEW.payment_type IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM case_closure_settlement_update_receipts r
  WHERE r.closure_version_id=NEW.id AND r.closure_audit_event_id=NEW.audit_event_id
   AND r.case_id=NEW.case_id AND r.department_id=NEW.department_id AND r.actor_user_id=NEW.recorded_by_user_id
   AND r.xmin=pg_current_xact_id()::text::xid
 ) THEN RAISE EXCEPTION 'typed closure correction requires atomic settlement receipt' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER typed_settlement_correction_parent_final AFTER INSERT ON case_closure_versions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_typed_settlement_correction_parent_final();

-- Reuse FD47's child event coverage, now dispatching CORRECT into this complete
-- command set. Old active payments are an authoritative ordered prefix; newly
-- linked records form the exact ordered suffix declared by the real adapter.
CREATE FUNCTION validate_settlement_update_payment_set(target_version uuid,target_case uuid,target_department uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v case_closure_versions%ROWTYPE; r case_closure_settlement_update_receipts%ROWTYPE;
 n bigint; linked bigint; previous_ids jsonb; previous_amounts jsonb; new_ids jsonb; new_amounts jsonb;
 all_ids jsonb; all_amounts jsonb; declared_amount jsonb;
BEGIN
 SELECT * INTO v FROM case_closure_versions WHERE id=target_version AND case_id=target_case AND department_id=target_department
  AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO r FROM case_closure_settlement_update_receipts WHERE closure_version_id=target_version
  AND case_id=target_case AND department_id=target_department AND xmin=pg_current_xact_id()::text::xid;
 IF v.id IS NULL OR r.id IS NULL OR v.kind IS DISTINCT FROM 'CORRECT'
  OR v.recorded_by_user_id IS DISTINCT FROM r.actor_user_id OR v.audit_event_id IS DISTINCT FROM r.closure_audit_event_id THEN
  RAISE EXCEPTION 'settlement payment set requires current transaction correction and parent receipt' USING ERRCODE='23514';
 END IF;
 SELECT count(*) INTO n FROM case_closure_payment_versions WHERE closure_version_id=v.id;
 SELECT count(*) INTO linked FROM case_closure_settlement_update_payments WHERE receipt_id=r.id;
 IF n>100 OR n<>linked OR EXISTS (
  SELECT 1 FROM case_closure_settlement_update_payments l LEFT JOIN case_closure_payment_versions p ON p.id=l.payment_version_id
  WHERE l.receipt_id=r.id AND (p.id IS NULL OR p.closure_version_id IS DISTINCT FROM v.id
   OR p.case_id IS DISTINCT FROM r.case_id OR p.department_id IS DISTINCT FROM r.department_id
   OR p.recorded_by_user_id IS DISTINCT FROM r.actor_user_id OR p.audit_event_id IS DISTINCT FROM l.audit_event_id
   OR p.xmin IS DISTINCT FROM pg_current_xact_id()::text::xid OR l.xmin IS DISTINCT FROM pg_current_xact_id()::text::xid)) THEN
  RAISE EXCEPTION 'settlement payment link set is incomplete or foreign' USING ERRCODE='23514';
 END IF;
 IF n=0 THEN RETURN; END IF;
 IF EXISTS (SELECT 1 FROM case_closure_settlement_update_payments WHERE receipt_id=r.id
  GROUP BY receipt_id HAVING min(position)<>0 OR max(position)<>count(*)-1) THEN
  RAISE EXCEPTION 'settlement payment positions are not consecutive' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(jsonb_agg(p.id ORDER BY p.payment_id),'[]'::jsonb),coalesce(jsonb_agg(p.amount::text ORDER BY p.payment_id),'[]'::jsonb)
 INTO previous_ids,previous_amounts FROM case_closure_payment_versions p
 WHERE p.case_id=r.case_id AND p.department_id=r.department_id AND p.closure_version_id<>v.id AND p.state='ACTIVE'
  AND NOT EXISTS(SELECT 1 FROM case_closure_payment_versions successor WHERE successor.prior_version_id=p.id);
 SELECT jsonb_agg(p.id ORDER BY l.position),jsonb_agg(a.details->'amount' ORDER BY l.position)
 INTO new_ids,new_amounts FROM case_closure_settlement_update_payments l
 JOIN case_closure_payment_versions p ON p.id=l.payment_version_id JOIN audit_events a ON a.id=p.audit_event_id
 WHERE l.receipt_id=r.id;
 all_ids:=previous_ids||new_ids; all_amounts:=previous_amounts||new_amounts;
 SELECT c.result_snapshot#>'{review,closureAmount}' INTO declared_amount
 FROM case_closure_settlement_update_payments l JOIN case_closure_payment_receipts c ON c.payment_version_id=l.payment_version_id
 WHERE l.receipt_id=r.id AND l.position=0;
 IF (v.close_amount_state='PENDING' AND declared_amount IS DISTINCT FROM 'null'::jsonb)
  OR (v.close_amount_state='KNOWN' AND CASE WHEN jsonb_typeof(declared_amount)='string'
    AND declared_amount#>>'{}' ~ '^\d{1,14}(\.\d{1,2})?$' THEN (declared_amount#>>'{}')::numeric ELSE NULL END IS DISTINCT FROM v.close_amt) THEN
  RAISE EXCEPTION 'settlement payment review closure amount is inconsistent' USING ERRCODE='23514';
 END IF;
 IF EXISTS (
  SELECT 1 FROM case_closure_settlement_update_payments l JOIN case_closure_payment_versions p ON p.id=l.payment_version_id
  LEFT JOIN audit_events a ON a.id=p.audit_event_id AND a.xmin=pg_current_xact_id()::text::xid
  LEFT JOIN case_closure_payment_receipts c ON c.payment_version_id=p.id AND c.xmin=pg_current_xact_id()::text::xid
  WHERE l.receipt_id=r.id AND (a.id IS NULL OR c.id IS NULL
   OR c.actor_user_id IS DISTINCT FROM r.actor_user_id OR c.audit_event_id IS DISTINCT FROM p.audit_event_id
   OR c.case_id IS DISTINCT FROM r.case_id OR c.department_id IS DISTINCT FROM r.department_id
   OR c.request_fingerprint IS DISTINCT FROM r.request_fingerprint
   OR a.details->>'fingerprint' IS DISTINCT FROM r.request_fingerprint
   OR a.details->'result' IS DISTINCT FROM c.result_snapshot
   OR c.idempotency_key IS DISTINCT FROM encode(sha256(convert_to('["closure-settlement-payment",'||to_json(r.idempotency_key)::text||','||l.position::text||']','UTF8')),'hex')
   OR c.result_snapshot IS DISTINCT FROM jsonb_build_object('versionId',p.id,'stage','WAITING_ARCHIVE','reviewRequired',true,
    'review',jsonb_build_object('caseId',r.case_id,'stage','WAITING_ARCHIVE','closureVersionId',v.id,'closureAmount',declared_amount,
     'effectivePaymentVersionIds',all_ids,'effectiveAmounts',all_amounts,'financialReadiness','UNKNOWN')))
 ) THEN RAISE EXCEPTION 'settlement payment receipt differs from exact replayable command set' USING ERRCODE='23514'; END IF;
END; $$;
-- Seal the exact terms audit retained by an immutable combined-command receipt.
-- Historical corrections stay protected after head/stage/terms changes.
CREATE FUNCTION seal_settlement_update_terms_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM case_closure_settlement_update_receipts r
  JOIN case_closure_versions v ON v.id=r.closure_version_id
   AND v.case_id=r.case_id AND v.department_id=r.department_id
   AND v.audit_event_id=r.closure_audit_event_id
  JOIN case_settlement_assessment_versions av ON av.id=r.assessment_version_id
   AND av.case_id=r.case_id AND av.department_id=r.department_id AND av.closure_version_id=v.id
  WHERE r.assessment_included
   AND r.result_snapshot#>>'{settlementTermsChange,auditEventId}'=OLD.id::text
 ) THEN RAISE EXCEPTION 'settlement update terms audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER settlement_update_terms_audit_seal BEFORE UPDATE OR DELETE ON audit_events
 FOR EACH ROW EXECUTE FUNCTION seal_settlement_update_terms_audit();

-- A checked parent can be drained IMMEDIATE before transaction end. Once its
-- receipt exists, prevent a later same-command terms rewrite from invalidating
-- the checked inputs. Future transactions can still make a new terms version.
CREATE FUNCTION seal_current_command_settlement_terms() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_case uuid; old_department uuid; new_case uuid; new_department uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_case:=OLD.case_id; old_department:=OLD.department_id; END IF;
 IF TG_OP<>'DELETE' THEN new_case:=NEW.case_id; new_department:=NEW.department_id; END IF;
 IF EXISTS (SELECT 1 FROM case_closure_settlement_update_receipts r
  WHERE ((r.case_id=old_case AND r.department_id=old_department) OR (r.case_id=new_case AND r.department_id=new_department))
   AND r.xmin=pg_current_xact_id()::text::xid AND r.assessment_included)
 OR EXISTS (SELECT 1 FROM case_closure_amount_update_receipts r
  WHERE ((r.case_id=old_case AND r.department_id=old_department) OR (r.case_id=new_case AND r.department_id=new_department))
   AND r.xmin=pg_current_xact_id()::text::xid) THEN
  RAISE EXCEPTION 'checked settlement command terms cannot change in the same transaction' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER current_command_settlement_terms_seal BEFORE INSERT OR UPDATE OR DELETE ON case_settlement_terms
 FOR EACH ROW EXECUTE FUNCTION seal_current_command_settlement_terms();

CREATE OR REPLACE FUNCTION guard_early_typed_closure_register_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.payment_type IN ('ONE_TIME','INSTALLMENTS')
   AND ((NEW.close_amount_state='KNOWN' AND NEW.close_amt>=0)
     OR (NEW.close_amount_state='PENDING' AND NEW.close_amt IS NULL))
   AND NEW.kind='REGISTER' AND NEW.prior_version_id IS NULL
   AND NEW.finish_id IS NULL AND NEW.external_entry_id IS NULL
   AND EXISTS (SELECT 1 FROM case_early_closures e
    WHERE e.id=NEW.early_closure_id AND e.case_id=NEW.case_id AND e.department_id=NEW.department_id
     AND e.recorded_by_user_id=NEW.recorded_by_user_id AND e.to_version=NEW.from_version
     AND NEW.to_version=NEW.from_version+1 AND e.xmin=pg_current_xact_id()::text::xid)
  THEN RETURN NEW; END IF;
  IF NEW.kind='CORRECT' AND NEW.payment_type IN ('ONE_TIME','INSTALLMENTS')
   AND NEW.to_version=NEW.from_version+1
   AND ((NEW.close_amount_state='KNOWN' AND NEW.close_amt>=0) OR (NEW.close_amount_state='PENDING' AND NEW.close_amt IS NULL))
   AND EXISTS (SELECT 1 FROM cases c JOIN case_closures h ON h.case_id=c.id AND h.department_id=c.department_id
    JOIN case_closure_versions prior ON prior.id=h.current_version_id AND prior.closure_id=h.id
     AND prior.case_id=h.case_id AND prior.department_id=h.department_id
    WHERE c.id=NEW.case_id AND c.department_id=NEW.department_id AND c.stage='WAITING_ARCHIVE'
     AND c.version=NEW.from_version AND prior.to_version=c.version AND h.id=NEW.closure_id AND prior.id=NEW.prior_version_id
     AND NEW.early_closure_id IS NOT DISTINCT FROM prior.early_closure_id
     AND NEW.finish_id IS NOT DISTINCT FROM prior.finish_id AND NEW.external_entry_id IS NOT DISTINCT FROM prior.external_entry_id)
  THEN RETURN NEW; END IF;
 END IF;
 IF NEW.payment_type IS NOT NULL THEN
  RAISE EXCEPTION 'typed closure requires an atomic early register command' USING ERRCODE='23514';
 END IF;
 -- Retain the pre-existing untyped historical branches. The permanent typed
 -- count guard still prevents erasing a previously selected payment type.
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION guard_early_initial_payment_record_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p case_closure_payment_versions%ROWTYPE; v case_closure_versions%ROWTYPE;
 e case_early_closures%ROWTYPE; er case_early_closure_receipts%ROWTYPE; a audit_events%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'initial payment history is immutable' USING ERRCODE='23514';
 END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'initial payment requires serializable transaction' USING ERRCODE='23514';
 END IF;
 -- Separate branches: receipt-only fields must never be accessed on a version.
 IF TG_RELID='case_closure_payment_versions'::regclass THEN
  p:=NEW;
 ELSIF TG_RELID='case_closure_payment_receipts'::regclass THEN
  SELECT * INTO p FROM case_closure_payment_versions
   WHERE id=NEW.payment_version_id AND xmin=pg_current_xact_id()::text::xid;
 ELSE
  RAISE EXCEPTION 'unsupported initial payment gate target' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v FROM case_closure_versions
  WHERE id=p.closure_version_id AND case_id=p.case_id AND department_id=p.department_id
   AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO e FROM case_early_closures
  WHERE id=v.early_closure_id AND case_id=p.case_id AND department_id=p.department_id
   AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO er FROM case_early_closure_receipts
  WHERE early_closure_id=e.id AND case_id=p.case_id AND department_id=p.department_id
   AND actor_user_id=p.recorded_by_user_id AND xmin=pg_current_xact_id()::text::xid;
 SELECT * INTO a FROM audit_events
  WHERE id=p.audit_event_id AND xmin=pg_current_xact_id()::text::xid;
 IF p.id IS NULL OR p.revision IS DISTINCT FROM 1 OR p.prior_version_id IS NOT NULL
  OR p.payment_id IS DISTINCT FROM p.id OR p.state IS DISTINCT FROM 'ACTIVE' OR p.reason IS NOT NULL
  OR v.id IS NULL OR v.kind NOT IN ('REGISTER','CORRECT')
  OR (v.kind='REGISTER' AND v.prior_version_id IS NOT NULL) OR (v.kind='CORRECT' AND v.prior_version_id IS NULL)
  OR (v.kind='REGISTER' AND (v.finish_id IS NOT NULL OR v.external_entry_id IS NOT NULL))
  OR v.payment_type IS NULL OR v.payment_type NOT IN ('ONE_TIME','INSTALLMENTS')
  OR ((v.close_amount_state='KNOWN' AND (v.close_amt>0 OR (v.kind='CORRECT' AND v.close_amt=0)))
    OR (v.close_amount_state='PENDING' AND v.close_amt IS NULL)) IS NOT TRUE
  OR a.id IS NULL OR (v.kind='REGISTER' AND (e.id IS NULL OR er.id IS NULL))
  OR p.recorded_by_user_id IS DISTINCT FROM v.recorded_by_user_id
  OR (v.kind='REGISTER' AND v.recorded_by_user_id IS DISTINCT FROM e.recorded_by_user_id)
  OR (v.kind='REGISTER' AND (v.from_version IS DISTINCT FROM e.to_version OR v.to_version IS DISTINCT FROM e.to_version+1))
  OR p.recorded_at IS DISTINCT FROM v.recorded_at OR (v.kind='REGISTER' AND v.recorded_at IS DISTINCT FROM e.recorded_at)
  OR p.paid_on>(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai')::date
  OR NOT EXISTS (SELECT 1 FROM cases c JOIN case_closures h
    ON h.case_id=c.id AND h.department_id=c.department_id
    WHERE c.id=p.case_id AND c.department_id=p.department_id AND c.stage='WAITING_ARCHIVE'
     AND c.version=v.to_version AND h.id=v.closure_id AND h.current_version_id=v.id
     AND h.early_closure_id IS NOT DISTINCT FROM v.early_closure_id
     AND h.finish_id IS NOT DISTINCT FROM v.finish_id AND h.external_entry_id IS NOT DISTINCT FROM v.external_entry_id
     AND h.xmin=pg_current_xact_id()::text::xid)
  -- The real early RECORD adapter declares no screenshot as explicit JSON null.
  -- The original document gate remains closed, and 3036 checks the empty set.
  OR a.details->'screenshotContentVersionId' IS DISTINCT FROM 'null'::jsonb
  OR jsonb_typeof(a.details->'caseId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'closureVersionId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'paymentVersionId') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'paidOn') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'payer') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'payee') IS DISTINCT FROM 'string'
  OR jsonb_typeof(a.details->'fingerprint') IS DISTINCT FROM 'string'
  OR a.details->>'caseId' IS DISTINCT FROM p.case_id::text
  OR a.details->>'closureVersionId' IS DISTINCT FROM v.id::text
  OR a.details->>'paymentVersionId' IS DISTINCT FROM p.id::text
  OR a.details->>'paidOn' IS DISTINCT FROM to_char(p.paid_on,'YYYY-MM-DD')
  OR (CASE WHEN jsonb_typeof(a.details->'amount')='string'
      AND a.details->>'amount' ~ '^\d{1,14}(\.\d{1,2})?$'
     THEN (a.details->>'amount')::numeric ELSE NULL END) IS DISTINCT FROM p.amount
  OR a.details->>'payer' IS DISTINCT FROM p.payer OR a.details->>'payee' IS DISTINCT FROM p.payee
  OR a.details->>'fingerprint' !~ '^[0-9a-f]{64}$'
  OR (v.kind='REGISTER' AND a.details->>'fingerprint' IS DISTINCT FROM er.request_fingerprint)
 THEN
  RAISE EXCEPTION 'payment requires exact screenshot-free atomic early source' USING ERRCODE='23514';
 END IF;
 -- 3003, 3007, 3024, 3034 and 3036 remain installed. They independently
 -- enforce actor/revision, current typed head, audit, receipt and evidence sets.
 IF TG_RELID='case_closure_payment_receipts'::regclass THEN
  IF NEW.case_id IS DISTINCT FROM p.case_id OR NEW.department_id IS DISTINCT FROM p.department_id
   OR NEW.actor_user_id IS DISTINCT FROM p.recorded_by_user_id
   OR NEW.audit_event_id IS DISTINCT FROM p.audit_event_id
   OR NEW.request_fingerprint IS DISTINCT FROM a.details->>'fingerprint' THEN
   RAISE EXCEPTION 'initial payment receipt requires exact early source fingerprint' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION check_early_initial_payment_source_final() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid; source_case uuid; source_department uuid; version_id uuid; version_kind text;
BEGIN
 IF TG_RELID='case_early_closures'::regclass THEN
  PERFORM validate_early_initial_payment_source(NEW.id,NEW.case_id,NEW.department_id);
  RETURN NEW;
 ELSIF TG_RELID='case_closure_payment_versions'::regclass THEN
  source_case:=NEW.case_id; source_department:=NEW.department_id;
  SELECT v.id,v.kind,v.early_closure_id INTO version_id,version_kind,source_id FROM case_closure_versions v
   WHERE v.id=NEW.closure_version_id AND v.case_id=source_case AND v.department_id=source_department AND v.xmin=pg_current_xact_id()::text::xid;
 ELSIF TG_RELID='case_closure_payment_receipts'::regclass THEN
  source_case:=NEW.case_id; source_department:=NEW.department_id;
  SELECT v.id,v.kind,v.early_closure_id INTO version_id,version_kind,source_id FROM case_closure_payment_versions p
   JOIN case_closure_versions v ON v.id=p.closure_version_id AND v.case_id=p.case_id AND v.department_id=p.department_id
   WHERE p.id=NEW.payment_version_id AND p.case_id=source_case AND p.department_id=source_department
    AND p.xmin=pg_current_xact_id()::text::xid AND v.xmin=pg_current_xact_id()::text::xid;
 ELSE RAISE EXCEPTION 'unsupported payment set trigger target' USING ERRCODE='23514'; END IF;
 IF version_kind='REGISTER' THEN
  PERFORM validate_early_initial_payment_source(source_id,source_case,source_department);
 ELSIF version_kind='CORRECT' THEN
  PERFORM validate_settlement_update_payment_set(version_id,source_case,source_department);
 ELSE RAISE EXCEPTION 'payment set has no admitted command context' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION check_closure_settlement_update_receipt_final() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; v record; a record; payment_ids jsonb; expected jsonb;
BEGIN
 IF TG_TABLE_NAME='case_closure_settlement_update_payments' THEN
  SELECT * INTO r FROM case_closure_settlement_update_receipts WHERE id=NEW.receipt_id;
 ELSE SELECT * INTO r FROM case_closure_settlement_update_receipts WHERE id=NEW.id; END IF;
 SELECT *,xmin AS creation_xmin INTO v FROM case_closure_versions WHERE id=r.closure_version_id;
 SELECT *,xmin AS creation_xmin INTO a FROM audit_events WHERE id=r.audit_event_id;
 IF r.id IS NULL OR v.id IS NULL OR v.kind<>'CORRECT' OR v.case_id<>r.case_id OR v.department_id<>r.department_id OR
  v.audit_event_id<>r.closure_audit_event_id OR v.recorded_by_user_id<>r.actor_user_id OR
  v.creation_xmin<>pg_current_xact_id()::text::xid OR r.created_at<v.recorded_at OR NOT EXISTS(
   SELECT 1 FROM cases c JOIN case_closures h ON h.case_id=c.id AND h.department_id=c.department_id
   WHERE c.id=r.case_id AND c.department_id=r.department_id AND c.stage='WAITING_ARCHIVE'
    AND c.version=v.to_version AND h.current_version_id=v.id) OR NOT EXISTS(
   SELECT 1 FROM case_closure_receipts cr WHERE cr.case_id=r.case_id AND cr.department_id=r.department_id
    AND cr.actor_user_id=r.actor_user_id AND cr.command='CORRECT' AND cr.idempotency_key=r.idempotency_key
    AND cr.request_fingerprint=r.request_fingerprint AND cr.result_snapshot->>'closureVersionId'=v.id::text
 ) THEN RAISE EXCEPTION 'settlement update lacks exact closure correction' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM case_closure_settlement_update_payments link JOIN case_closure_payment_versions p ON p.id=link.payment_version_id
  WHERE link.receipt_id=r.id AND (p.closure_version_id<>v.id OR p.case_id<>r.case_id OR p.department_id<>r.department_id
   OR p.revision<>1 OR p.state<>'ACTIVE' OR p.prior_version_id IS NOT NULL OR p.payment_id<>p.id
   OR p.recorded_by_user_id<>r.actor_user_id OR p.audit_event_id<>link.audit_event_id OR p.xmin<>pg_current_xact_id()::text::xid
   OR NOT EXISTS(SELECT 1 FROM case_closure_payment_receipts child WHERE child.payment_version_id=p.id
    AND child.case_id=r.case_id AND child.department_id=r.department_id AND child.actor_user_id=r.actor_user_id
    AND child.audit_event_id=p.audit_event_id AND child.request_fingerprint=r.request_fingerprint))) THEN
   RAISE EXCEPTION 'settlement update payment child mismatch' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM case_closure_payment_versions WHERE closure_version_id=v.id)<>(SELECT count(*) FROM case_closure_settlement_update_payments WHERE receipt_id=r.id) THEN
  RAISE EXCEPTION 'settlement update payment set incomplete' USING ERRCODE='23514'; END IF;
 IF r.refund_included AND NOT EXISTS(SELECT 1 FROM case_refund_inventory_versions child JOIN case_refund_inventory_receipts cr ON cr.inventory_version_id=child.id
  WHERE child.id=r.refund_version_id AND child.case_id=r.case_id AND child.department_id=r.department_id
   AND child.recorded_by_user_id=r.actor_user_id AND child.xmin=pg_current_xact_id()::text::xid
   AND cr.actor_user_id=r.actor_user_id AND cr.request_fingerprint=r.request_fingerprint) THEN
  RAISE EXCEPTION 'settlement update refund child mismatch' USING ERRCODE='23514'; END IF;
 IF r.assessment_included AND NOT EXISTS(SELECT 1 FROM case_settlement_assessment_versions child JOIN case_settlement_assessment_receipts cr ON cr.assessment_version_id=child.id
  WHERE child.id=r.assessment_version_id AND child.case_id=r.case_id AND child.department_id=r.department_id
   AND child.closure_version_id=v.id AND child.recorded_by_user_id=r.actor_user_id AND child.xmin=pg_current_xact_id()::text::xid
   AND cr.actor_user_id=r.actor_user_id AND cr.request_fingerprint=r.request_fingerprint) THEN
  RAISE EXCEPTION 'settlement update assessment child mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM case_closure_settlement_update_payments WHERE receipt_id=r.id
  GROUP BY receipt_id HAVING min(position)<>0 OR max(position)<>count(*)-1) THEN
  RAISE EXCEPTION 'settlement update payment order is not consecutive' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(payment_version_id ORDER BY position),'[]'::jsonb) INTO payment_ids FROM case_closure_settlement_update_payments WHERE receipt_id=r.id;
 expected:=jsonb_build_object('id',r.case_id,'stage','WAITING_ARCHIVE','version',v.to_version,'closureId',v.closure_id,'closureVersionId',v.id,
  'recordedAt',to_char(v.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'paymentVersionIds',payment_ids,'refundInventoryVersionId',r.refund_version_id,'settlementAssessmentVersionId',r.assessment_version_id,'settlementTermsChange',r.result_snapshot->'settlementTermsChange');
 IF r.result_snapshot IS DISTINCT FROM expected OR a.id IS NULL OR a.department_id<>r.department_id OR a.actor_kind<>'HUMAN'
  OR a.actor_user_id IS DISTINCT FROM r.actor_user_id OR a.internal_actor_user_id IS DISTINCT FROM r.actor_user_id
  OR a.customer_account_binding_id IS NOT NULL OR a.lawyer_account_binding_id IS NOT NULL OR a.notary_office_account_binding_id IS NOT NULL
  OR a.resource_type<>'CASE_CLOSURE_SETTLEMENT_UPDATE' OR a.resource_id<>r.id OR a.action<>'CASE_CLOSURE_SETTLEMENT_UPDATED'
  OR a.creation_xmin<>pg_current_xact_id()::text::xid OR a.details IS DISTINCT FROM jsonb_build_object('requestFingerprint',r.request_fingerprint,'result',expected)
 THEN RAISE EXCEPTION 'settlement update exact audit or response mismatch' USING ERRCODE='23514'; END IF;
 IF NOT (r.result_snapshot ? 'settlementTermsChange') THEN
  RAISE EXCEPTION 'missing amount contract' USING ERRCODE='23514'; END IF;
 IF r.result_snapshot->'settlementTermsChange' <> 'null'::jsonb THEN
  PERFORM assert_case_financial_actor_draft(r.actor_user_id,r.case_id,r.department_id,
   (r.result_snapshot#>>'{settlementTermsChange,auditEventId}')::uuid,r.case_id,
   'CASE','case.closure.settlement_amounts.updated',ARRAY['WAITING_ARCHIVE']);
  IF NOT r.assessment_included OR NOT EXISTS (
   SELECT 1 FROM audit_events ta
   JOIN case_settlement_assessment_versions av ON av.id=r.assessment_version_id
   JOIN case_settlement_terms t ON t.case_id=r.case_id AND t.department_id=r.department_id
   WHERE ta.id=(r.result_snapshot#>>'{settlementTermsChange,auditEventId}')::uuid
    AND ta.department_id=r.department_id AND ta.actor_kind='HUMAN'
    AND ta.actor_user_id=r.actor_user_id AND ta.internal_actor_user_id=r.actor_user_id
    AND ta.resource_type='CASE' AND ta.resource_id=r.case_id
    AND ta.action='case.closure.settlement_amounts.updated'
    AND ta.xmin=pg_current_xact_id()::text::xid AND t.xmin=pg_current_xact_id()::text::xid
    AND ta.details->>'requestFingerprint'=r.request_fingerprint
    AND ta.details->>'parentIdempotencyKey'=r.idempotency_key
    AND ta.details->'before'=r.result_snapshot#>'{settlementTermsChange,before}'
    AND ta.details->'after'=r.result_snapshot#>'{settlementTermsChange,after}'
    AND t.version=(ta.details#>>'{after,version}')::integer AND av.terms_version=t.version
    AND t.version=coalesce((ta.details#>>'{before,version}')::integer,0)+1
    AND t.customer_manual_amount IS NOT DISTINCT FROM (ta.details#>>'{after,customerManualAmount}')::numeric
    AND t.lawyer_manual_amount IS NOT DISTINCT FROM (ta.details#>>'{after,lawyerManualAmount}')::numeric
    AND av.calculation_inputs->'customerManualAmount'=ta.details#>'{after,customerManualAmount}'
    AND av.calculation_inputs->'lawyerManualAmount'=ta.details#>'{after,lawyerManualAmount}'
  ) THEN RAISE EXCEPTION 'amount change lacks atomic provenance' USING ERRCODE='23514'; END IF;
 END IF;
 PERFORM validate_settlement_update_payment_set(r.closure_version_id,r.case_id,r.department_id);
 RETURN NEW;
END; $$;

-- Independent document target gate. The existing source, authorization lock,
-- draft identity/reverse binding and immutable guards remain authoritative.
-- No payment screenshot category or payment-document gate is opened here.
CREATE OR REPLACE FUNCTION guard_settlement_upload_target_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'settlement upload target remains immutable' USING ERRCODE='23514';
 END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'settlement upload target requires serializable transaction' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

-- Gate selector only: this does not assert money or open any money writer.
-- Keep 3013 complete source sets, 3026 independent readiness recomputation and
-- 3031 exact same-transaction PASSED/EXEMPT archive requirement unchanged.
-- Zero retains the already-scoped early-source branch; positive current closure
-- may proceed to the permanent checks. Unknown/negative amounts stay closed.
CREATE OR REPLACE FUNCTION guard_zero_archive_snapshot_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s case_archive_evidence_snapshots%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'archive evidence snapshot persistence is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_RELID='case_archive_evidence_snapshots'::regclass THEN
  IF NEW.creation_xid IS DISTINCT FROM pg_current_xact_id()
   OR NOT EXISTS (
    SELECT 1 FROM case_closure_versions v JOIN case_closures h
     ON h.id=v.closure_id AND h.case_id=v.case_id AND h.department_id=v.department_id AND h.current_version_id=v.id
    WHERE v.id=NEW.closure_version_id AND v.case_id=NEW.case_id AND v.department_id=NEW.department_id
     AND v.close_amount_state='KNOWN' AND NEW.closure_amount IS NOT DISTINCT FROM v.close_amt
     AND (v.close_amt>0 OR (v.close_amt=0 AND EXISTS (
      SELECT 1 FROM case_early_closures e WHERE e.id=v.early_closure_id AND e.id=h.early_closure_id
       AND e.case_id=v.case_id AND e.department_id=v.department_id)))
   ) THEN
   RAISE EXCEPTION 'archive snapshot requires exact current known closure amount' USING ERRCODE='23514';
  END IF;
 ELSIF TG_RELID='case_archive_snapshot_payments'::regclass OR TG_RELID='case_archive_snapshot_allocations'::regclass THEN
  SELECT * INTO s FROM case_archive_evidence_snapshots
   WHERE id=NEW.snapshot_id AND xmin=pg_current_xact_id()::text::xid;
  IF s.id IS NULL OR s.creation_xid IS DISTINCT FROM pg_current_xact_id()
   OR s.closure_amount IS NULL OR s.closure_amount<0 THEN
   RAISE EXCEPTION 'archive snapshot child requires current transaction parent' USING ERRCODE='23514';
  END IF;
 ELSE
  RAISE EXCEPTION 'unsupported archive snapshot gate target' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;

COMMIT;
