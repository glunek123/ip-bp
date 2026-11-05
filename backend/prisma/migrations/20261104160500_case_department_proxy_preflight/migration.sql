-- Check the eight authorization functions before 1610 replaces them.
-- In an already-upgraded test database, verify the exact 1610 ledger entry
-- and its resulting definitions instead; this cannot retroactively guard 1610.
BEGIN;
SET LOCAL search_path=pg_catalog,public;
DO $preflight$
DECLARE spec record; actual record; successful_count integer; valid_success_count integer;
 unresolved_count integer; expected_sha256 text;
 already_applied boolean;
BEGIN
 SELECT count(*) FILTER (
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ),count(*) FILTER (
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
   AND checksum IN (
    '2abb55bcdc02fba345fb95d017b5295ac7ab17957866ffc8ca32180dafd42633',
    '9dd5cfe37a540738188683d1b4fe1290144b7c39a85e4a080703ed66fa93c830'
   )
 ),count(*) FILTER (
  WHERE finished_at IS NULL AND rolled_back_at IS NULL
 ) INTO successful_count,valid_success_count,unresolved_count
 FROM public._prisma_migrations
 WHERE migration_name='20261104161000_case_department_proxy';
 IF successful_count>1 OR valid_success_count<>successful_count
  OR unresolved_count<>0 THEN
  RAISE EXCEPTION 'unexpected department proxy migration ledger' USING ERRCODE='23514';
 END IF;
 already_applied:=successful_count=1;

 FOR spec IN SELECT * FROM (VALUES
  ('assert_case_financial_actor_draft','target_actor uuid, target_case uuid, target_department uuid, target_audit uuid, target_version uuid, target_resource text, target_action text, allowed_stages text[]','void','plpgsql','v','d5f368ecd4ecfbcb5b4d5042af81ba7d1ecf639ac910527a3778fbac128caadd','17c9caa58f7f8133041e904b1d22610ceb48a723bd6ebc63bc46b41bd477defe'),
  ('case_early_closure_action_authorized','target_actor uuid, target_case uuid, target_department uuid','boolean','sql','s','a34a7e2e651a35f183c78346ea01e2c110c4bafb1b83e9af115e47ea10ff96b7','0d1f08f5fa49f441de7c13906beac6e73815bf5e7d26f117253af8347bd094d2'),
  ('case_early_closure_initial_payment_reference_authorized','target_payment uuid, target_case uuid, target_department uuid, target_actor uuid','boolean','sql','s','06eebb3bedcc6835eb50041c0ed6bc5de9ab3c7f967fcbcbc3876e71b6333ebc','c0c98aae9ec67953272f7599d53206afe4b104d74a8cf9d3627dda2aa5e6113d'),
  ('case_early_closure_initial_version_authorized','v case_closure_versions, final_check boolean','boolean','plpgsql','s','c6b32e9da00fecb25f8be80df34db074192467d23a7b3768a9a9f9dc8206eaa7','7e1c55bca4911ee98cf43569f56b7fb258f9dbdf1f6b6e268fe36b106fa325f7'),
  ('case_early_closure_upload_authorized','target_actor uuid, target_case uuid, target_department uuid','boolean','sql','s','4248230d9a7f0b619bd92d859a3dea63a1b77e702d4cc211aadc6e1a0a309e20','cf49d478545eb7a4adb25bb290070a00154a2f882907d16e82a6e5e4b51bfc85'),
  ('case_payment_proof_upload_eligible','target_actor uuid, target_case uuid, target_department uuid','boolean','plpgsql','s','08ac2782a49ff382701d691eebbc8d7adb2fea4dd9b3cf3aea3fef3d2f5deb14','5b564569b6379a15de55393a572ae054bbd6ecb72832e1833967ad4f6dc23eec'),
  ('guard_early_closure_actor_draft','','trigger','plpgsql','v','73a6021654d8740efbe11bdb2ccd9b9f0075109f748b9c9778cf552f59a5a210','b5a3e4ff8838dc1a89a303dc4fe32b1c6df49c65d7ace2f26f3f8e9d020214b7'),
  ('settlement_update_document_upload_eligible','target_actor uuid, target_case uuid, target_department uuid, target_closure uuid, target_revision integer','boolean','plpgsql','s','10e803069a0b2f6d785f76e3b5183a09bfcbd239de0671cef2e2549885de8eba','38329faa10e33be486e64ec16a6eca18de84cb2791e5218aee0e37f88aa78aba')
 ) AS expected(name,args,result,language,volatility,before_sha256,after_sha256) LOOP
  expected_sha256:=spec.before_sha256;
  IF already_applied THEN expected_sha256:=spec.after_sha256; END IF;
  SELECT p.*,l.lanname INTO actual FROM pg_proc p
   JOIN pg_namespace n ON n.oid=p.pronamespace
   JOIN pg_language l ON l.oid=p.prolang
   WHERE n.nspname='public' AND p.proname=spec.name
    AND pg_get_function_identity_arguments(p.oid)=spec.args;
  IF actual.oid IS NULL
   OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=spec.name)<>1
   OR pg_get_function_result(actual.oid)<>spec.result
   OR actual.lanname<>spec.language OR actual.provolatile<>spec.volatility
   OR actual.prosecdef OR actual.proconfig IS NOT NULL
   OR encode(sha256(convert_to(replace(actual.prosrc,E'\r\n',E'\n'),'UTF8')),'hex')
    <> expected_sha256
  THEN RAISE EXCEPTION 'unexpected department proxy predecessor %',spec.name USING ERRCODE='23514';
  END IF;
 END LOOP;
END;
$preflight$;
COMMIT;
