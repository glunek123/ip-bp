-- UNEXECUTED CLOSED DRAFT. Does not replace or open any existing gate.
-- NOWAIT deliberately rejects lock upgrades and competing multi-file freezes.
-- This is a safety fence, not a guarantee that every concurrent request succeeds.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM case_closure_payment_documents)
  OR EXISTS (SELECT 1 FROM case_payment_proof_supplement_documents) THEN
  RAISE EXCEPTION 'payment proof fence requires an explicit historical evidence plan' USING ERRCODE='23514';
 END IF;
END; $$;
ALTER TABLE materials ADD COLUMN payment_proof_frozen boolean NOT NULL DEFAULT false;
ALTER TABLE content_versions ADD COLUMN payment_proof_frozen boolean NOT NULL DEFAULT false;

CREATE FUNCTION payment_proof_fence_has_local_document_draft(p_material uuid,p_content uuid)
RETURNS boolean LANGUAGE sql VOLATILE AS $$
 SELECT EXISTS (SELECT 1 FROM case_closure_payment_documents d
  WHERE d.material_id=p_material AND (p_content IS NULL OR d.content_version_id=p_content)
   AND d.xmin=pg_current_xact_id()::text::xid)
 OR EXISTS (SELECT 1 FROM case_payment_proof_supplement_documents d
  WHERE d.material_id=p_material AND (p_content IS NULL OR d.content_version_id=p_content)
   AND d.xmin=pg_current_xact_id()::text::xid);
$$;

CREATE FUNCTION guard_payment_proof_material_fence_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.payment_proof_frozen THEN RAISE EXCEPTION 'material cannot be born with a payment proof fence' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  IF OLD.payment_proof_frozen THEN RAISE EXCEPTION 'payment proof material is frozen' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.payment_proof_frozen AND NOT OLD.payment_proof_frozen AND
  (pg_trigger_depth()<2 OR NOT payment_proof_fence_has_local_document_draft(OLD.id,NULL)) THEN
  RAISE EXCEPTION 'material fence requires a transaction-local document trigger' USING ERRCODE='23514';
 END IF;
 IF OLD.payment_proof_frozen AND NOT NEW.payment_proof_frozen THEN
  RAISE EXCEPTION 'payment proof material fence cannot be removed' USING ERRCODE='23514';
 END IF;
 IF (OLD.payment_proof_frozen OR NEW.payment_proof_frozen) AND
  (NEW.id,NEW.department_id,NEW.owner_type,NEW.owner_id,NEW.category,NEW.purpose,NEW.status,NEW.deleted_at)
  IS DISTINCT FROM
  (OLD.id,OLD.department_id,OLD.owner_type,OLD.owner_id,OLD.category,OLD.purpose,OLD.status,OLD.deleted_at) THEN
  RAISE EXCEPTION 'payment proof material metadata is frozen' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payment_proof_material_fence_draft BEFORE INSERT OR UPDATE OR DELETE ON materials
 FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_material_fence_draft();

CREATE FUNCTION guard_payment_proof_content_fence_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.payment_proof_frozen THEN RAISE EXCEPTION 'content cannot be born with a payment proof fence' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  IF OLD.payment_proof_frozen THEN RAISE EXCEPTION 'payment proof content is frozen' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.payment_proof_frozen AND NOT OLD.payment_proof_frozen AND
  (pg_trigger_depth()<2 OR NOT payment_proof_fence_has_local_document_draft(OLD.material_id,OLD.id)) THEN
  RAISE EXCEPTION 'content fence requires a transaction-local document trigger' USING ERRCODE='23514';
 END IF;
 IF OLD.payment_proof_frozen AND NOT NEW.payment_proof_frozen THEN
  RAISE EXCEPTION 'payment proof content fence cannot be removed' USING ERRCODE='23514';
 END IF;
 -- Freeze the entire immutable version envelope, including provenance and status.
 -- Comparing OLD itself avoids dependence on visibility of a concurrent reference.
 IF (OLD.payment_proof_frozen OR NEW.payment_proof_frozen) AND
  (to_jsonb(NEW)-'payment_proof_frozen') IS DISTINCT FROM (to_jsonb(OLD)-'payment_proof_frozen') THEN
  RAISE EXCEPTION 'payment proof content metadata is frozen' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payment_proof_content_fence_draft BEFORE INSERT OR UPDATE OR DELETE ON content_versions
 FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_content_fence_draft();

CREATE FUNCTION freeze_payment_proof_document_metadata_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m materials%ROWTYPE; v content_versions%ROWTYPE;
BEGIN
 -- Separate statements establish m -> v order. Do not replace with a join lock.
 -- Existing callers may already hold SHARE; NOWAIT fails closed on contention.
 SELECT * INTO m FROM materials WHERE id=NEW.material_id FOR NO KEY UPDATE NOWAIT;
 IF m.id IS NULL OR m.department_id IS DISTINCT FROM NEW.department_id
  OR m.owner_type::text<>'CASE' OR m.owner_id IS DISTINCT FROM NEW.case_id
  OR m.category::text<>'CASE_CLOSURE_PAYMENT_PROOF' OR m.purpose<>'CASE_CLOSURE_PAYMENT_PROOF'
  OR m.status::text<>'ACTIVE' OR m.deleted_at IS NOT NULL THEN
  RAISE EXCEPTION 'payment proof material cannot be frozen' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v FROM content_versions WHERE id=NEW.content_version_id FOR NO KEY UPDATE NOWAIT;
 IF v.id IS NULL OR v.material_id IS DISTINCT FROM m.id OR m.current_version_id IS DISTINCT FROM v.id
  OR v.status::text<>'AVAILABLE' OR v.mime_type NOT IN ('image/jpeg','image/png')
  OR v.size_bytes NOT BETWEEN 1 AND 20971520 THEN
  RAISE EXCEPTION 'payment proof content cannot be frozen' USING ERRCODE='23514';
 END IF;
 -- Real writes, even if already frozen: old RR snapshots must conflict on m/v.
 -- Do not add WHERE payment_proof_frozen=false or replace these with SHARE locks.
 UPDATE materials SET payment_proof_frozen=true WHERE id=m.id;
 UPDATE content_versions SET payment_proof_frozen=true WHERE id=v.id;
 RETURN NEW;
END; $$;
-- AFTER makes the exact transaction-local document visible to the fence guards.
-- All existing BEFORE gates remain installed and can prevent reaching this point.
CREATE TRIGGER aaaa_payment_proof_metadata_fence_draft AFTER INSERT ON case_closure_payment_documents
 FOR EACH ROW EXECUTE FUNCTION freeze_payment_proof_document_metadata_draft();
CREATE TRIGGER aaaa_payment_proof_metadata_fence_draft AFTER INSERT ON case_payment_proof_supplement_documents
 FOR EACH ROW EXECUTE FUNCTION freeze_payment_proof_document_metadata_draft();
COMMIT;
