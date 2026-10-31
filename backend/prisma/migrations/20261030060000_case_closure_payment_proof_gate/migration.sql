BEGIN;
CREATE FUNCTION guard_case_closure_payment_proof_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR NEW.purpose='CASE_CLOSURE_PAYMENT_PROOF' THEN
  RAISE EXCEPTION 'payment screenshot upload contract is draft and not enabled' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER case_closure_payment_proof_upload_draft_gate BEFORE INSERT OR UPDATE ON upload_drafts
 FOR EACH ROW EXECUTE FUNCTION guard_case_closure_payment_proof_draft();
CREATE TRIGGER case_closure_payment_proof_material_draft_gate BEFORE INSERT OR UPDATE ON materials
 FOR EACH ROW EXECUTE FUNCTION guard_case_closure_payment_proof_draft();
COMMIT;
