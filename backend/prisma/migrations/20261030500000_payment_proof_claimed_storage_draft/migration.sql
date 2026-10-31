-- Closed draft: validates provenance independently; existing upload and payment gates stay closed.
-- Existing rows are not rewritten. Real PostgreSQL concurrency validation is required.
BEGIN;
CREATE FUNCTION guard_payment_proof_claimed_storage_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m materials%ROWTYPE; d upload_drafts%ROWTYPE;
BEGIN
 -- Lock even non-proof materials so a concurrent reclassification cannot race
 -- the decision below. Classification guard rejects every proof transition.
 SELECT * INTO m FROM materials WHERE id=NEW.material_id FOR SHARE;
 SELECT * INTO d FROM upload_drafts WHERE id=NEW.source_upload_draft_id FOR SHARE;
 IF m.category::text IS DISTINCT FROM 'CASE_CLOSURE_PAYMENT_PROOF'
    AND m.purpose IS DISTINCT FROM 'CASE_CLOSURE_PAYMENT_PROOF'
    AND d.category::text IS DISTINCT FROM 'CASE_CLOSURE_PAYMENT_PROOF'
    AND d.purpose IS DISTINCT FROM 'CASE_CLOSURE_PAYMENT_PROOF' THEN RETURN NEW; END IF;
 SELECT * INTO d FROM upload_drafts WHERE id=NEW.source_upload_draft_id FOR UPDATE;
 IF d.id IS NULL OR d.status::text IS DISTINCT FROM 'OPEN' OR d.expires_at<=CURRENT_TIMESTAMP
  OR d.pending_storage_key IS NULL OR NEW.storage_key IS DISTINCT FROM d.pending_storage_key
  OR d.owner_type::text IS DISTINCT FROM 'CASE' OR m.owner_type::text IS DISTINCT FROM 'CASE'
  OR d.owner_id IS DISTINCT FROM m.owner_id OR d.department_id IS DISTINCT FROM m.department_id
  OR d.category::text IS DISTINCT FROM 'CASE_CLOSURE_PAYMENT_PROOF'
  OR d.purpose IS DISTINCT FROM 'CASE_CLOSURE_PAYMENT_PROOF'
  OR m.category::text IS DISTINCT FROM 'CASE_CLOSURE_PAYMENT_PROOF'
  OR m.purpose IS DISTINCT FROM 'CASE_CLOSURE_PAYMENT_PROOF'
  OR m.status::text IS DISTINCT FROM 'ACTIVE' OR m.deleted_at IS NOT NULL
  OR NEW.uploaded_by IS DISTINCT FROM d.actor_user_id OR NEW.original_filename IS DISTINCT FROM d.original_filename
  OR NEW.status::text IS DISTINCT FROM 'AVAILABLE' OR NEW.mime_type NOT IN ('image/jpeg','image/png')
  OR NEW.mime_type IS DISTINCT FROM d.declared_mime_type OR NEW.size_bytes NOT BETWEEN 1 AND 20971520
 THEN RAISE EXCEPTION 'payment proof content does not match claimed upload' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payment_proof_claimed_storage_draft BEFORE INSERT ON content_versions
 FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_claimed_storage_draft();
CREATE FUNCTION guard_payment_proof_storage_provenance_immutable_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cleanup_material materials%ROWTYPE;
BEGIN
 IF (EXISTS (SELECT 1 FROM materials m WHERE m.id IN (OLD.material_id,NEW.material_id)
  AND (m.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR m.purpose='CASE_CLOSURE_PAYMENT_PROOF'))
  OR EXISTS (SELECT 1 FROM upload_drafts d WHERE d.id IN (OLD.source_upload_draft_id,NEW.source_upload_draft_id)
  AND (d.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR d.purpose='CASE_CLOSURE_PAYMENT_PROOF')))
  AND (NEW.material_id,NEW.source_upload_draft_id,NEW.storage_key,NEW.uploaded_by,
       NEW.original_filename,NEW.mime_type,NEW.size_bytes,NEW.sha256,NEW.derived_from_version_id)
   IS DISTINCT FROM (OLD.material_id,OLD.source_upload_draft_id,OLD.storage_key,OLD.uploaded_by,
       OLD.original_filename,OLD.mime_type,OLD.size_bytes,OLD.sha256,OLD.derived_from_version_id)
 THEN RAISE EXCEPTION 'payment proof storage provenance is immutable' USING ERRCODE='23514'; END IF;
 -- The worker already holds material -> content locks. Direct content updates
 -- acquire material NOWAIT: reverse contention fails closed; old RR snapshots
 -- conflict even when a restore changed material without changing content.
 IF OLD.status IS DISTINCT FROM NEW.status AND EXISTS (SELECT 1 FROM materials m WHERE m.id=OLD.material_id
  AND (m.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR m.purpose='CASE_CLOSURE_PAYMENT_PROOF')) THEN
  SELECT * INTO cleanup_material FROM materials WHERE id=OLD.material_id FOR NO KEY UPDATE NOWAIT;
  IF NOT ((OLD.status::text='AVAILABLE' AND NEW.status::text='DELETED') OR
          (OLD.status::text='DELETED' AND NEW.status::text='PURGED')) OR OLD.payment_proof_frozen OR NEW.payment_proof_frozen
   OR cleanup_material.status::text IS DISTINCT FROM 'DELETED'
   OR cleanup_material.deleted_at IS NULL
   OR cleanup_material.deleted_at + INTERVAL '90 days' > CURRENT_TIMESTAMP
   OR cleanup_material.payment_proof_frozen
   OR EXISTS (SELECT 1 FROM material_references r WHERE r.content_version_id=OLD.id)
   OR EXISTS (SELECT 1 FROM case_closure_payment_documents d WHERE d.content_version_id=OLD.id)
   OR EXISTS (SELECT 1 FROM case_payment_proof_supplement_documents d WHERE d.content_version_id=OLD.id)
  THEN RAISE EXCEPTION 'payment proof cleanup transition rejected' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payment_proof_storage_provenance_immutable_draft BEFORE UPDATE ON content_versions
 FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_storage_provenance_immutable_draft();
CREATE FUNCTION guard_payment_proof_reclassification_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR OLD.purpose='CASE_CLOSURE_PAYMENT_PROOF'
     OR NEW.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR NEW.purpose='CASE_CLOSURE_PAYMENT_PROOF')
  AND (NEW.category,NEW.purpose) IS DISTINCT FROM (OLD.category,OLD.purpose)
 THEN RAISE EXCEPTION 'payment proof material classification is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payment_proof_reclassification_draft BEFORE UPDATE ON materials
 FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_reclassification_draft();
CREATE FUNCTION guard_payment_proof_draft_reclassification_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR OLD.purpose='CASE_CLOSURE_PAYMENT_PROOF'
     OR NEW.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR NEW.purpose='CASE_CLOSURE_PAYMENT_PROOF')
  AND (NEW.category,NEW.purpose) IS DISTINCT FROM (OLD.category,OLD.purpose)
 THEN RAISE EXCEPTION 'payment proof upload classification is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payment_proof_draft_reclassification_draft BEFORE UPDATE ON upload_drafts
 FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_draft_reclassification_draft();
-- Route actual proof targets into the existing 3014/3035 strict branches.
-- Classification cannot race this read: 3050 forbids entering/leaving proof.
CREATE FUNCTION guard_payment_proof_reference_target_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_material materials%ROWTYPE; target_content content_versions%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF EXISTS (SELECT 1 FROM materials m WHERE (m.id=OLD.material_id
    OR m.id=(SELECT v.material_id FROM content_versions v WHERE v.id=OLD.content_version_id))
    AND (m.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR m.purpose='CASE_CLOSURE_PAYMENT_PROOF')) THEN
   RAISE EXCEPTION 'payment proof target reference is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 -- A FK may wait for an uncommitted target and accept it later. Do not let
 -- that wait skip proof classification at this trigger's earlier snapshot.
 SELECT * INTO target_material FROM materials WHERE id=NEW.material_id;
 SELECT * INTO target_content FROM content_versions WHERE id=NEW.content_version_id;
 IF target_material.id IS NULL OR target_content.id IS NULL
  OR target_content.material_id IS DISTINCT FROM target_material.id THEN
  RAISE EXCEPTION 'material reference requires visible matching targets' USING ERRCODE='23514';
 END IF;
 IF target_material.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR target_material.purpose='CASE_CLOSURE_PAYMENT_PROOF' THEN
  IF NEW.purpose IS DISTINCT FROM 'CASE_CLOSURE_PAYMENT_PROOF'
   OR NEW.resource_type NOT IN ('case-closure-payment-version','case-payment-proof-supplement') THEN
   RAISE EXCEPTION 'payment proof target requires exact payment reference contract' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payment_proof_reference_target_draft BEFORE INSERT OR UPDATE OR DELETE ON material_references
 FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_reference_target_draft();

COMMIT;
