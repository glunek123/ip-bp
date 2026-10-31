-- CLOSED DRAFT ONLY. No historical rows, payment revisions, original document
-- sets or existing upload/reference gates are changed. Material-reference
-- provenance and Prisma/API integration must be implemented before any opening.
BEGIN;
CREATE TABLE case_payment_proof_supplements (
 id uuid PRIMARY KEY, case_id uuid NOT NULL, department_id uuid NOT NULL,
 payment_id uuid NOT NULL, payment_version_id uuid NOT NULL,
 expected_closure_version_id uuid NOT NULL,
 actor_user_id uuid NOT NULL, authorization_revision integer NOT NULL CHECK(authorization_revision>=0),
 idempotency_key varchar(128) NOT NULL CHECK(length(idempotency_key)>0 AND idempotency_key !~ '^[[:space:]]|[[:space:]]$'),
 request_fingerprint char(64) NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
 content_version_ids uuid[] NOT NULL CHECK(array_ndims(content_version_ids)=1 AND cardinality(content_version_ids) BETWEEN 1 AND 10 AND array_position(content_version_ids,NULL) IS NULL),
 stage varchar(32) NOT NULL CHECK(stage IN ('WAITING_ARCHIVE','ARCHIVED')),
 audit_event_id uuid NOT NULL UNIQUE, result_snapshot jsonb NOT NULL CHECK(jsonb_typeof(result_snapshot)='object'),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT payment_proof_supplement_actor_key UNIQUE(department_id,actor_user_id,idempotency_key),
 UNIQUE(id,payment_version_id,case_id,department_id),
 FOREIGN KEY(case_id,department_id) REFERENCES cases(id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(payment_version_id,payment_id,case_id,department_id) REFERENCES case_closure_payment_versions(id,payment_id,case_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(expected_closure_version_id,case_id,department_id) REFERENCES case_closure_versions(id,case_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(actor_user_id,department_id) REFERENCES department_memberships(user_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(audit_event_id) REFERENCES audit_events(id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX ON case_payment_proof_supplements(case_id,department_id,payment_version_id);
CREATE TABLE case_payment_proof_supplement_documents (
 supplement_id uuid NOT NULL, payment_version_id uuid NOT NULL,
 case_id uuid NOT NULL, department_id uuid NOT NULL,
 material_id uuid NOT NULL, content_version_id uuid NOT NULL,
 PRIMARY KEY(supplement_id,content_version_id),
 UNIQUE(payment_version_id,content_version_id),
 FOREIGN KEY(supplement_id,payment_version_id,case_id,department_id) REFERENCES case_payment_proof_supplements(id,payment_version_id,case_id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(material_id,department_id) REFERENCES materials(id,department_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(material_id,content_version_id) REFERENCES content_versions(material_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- Independent always-closed gate. Future guards below do not enable writes.
CREATE FUNCTION guard_payment_proof_supplement_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'payment proof supplements remain draft and disabled' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER payment_proof_supplement_draft_gate BEFORE INSERT OR UPDATE OR DELETE ON case_payment_proof_supplements FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_supplement_draft();
CREATE TRIGGER payment_proof_supplement_document_draft_gate BEFORE INSERT OR UPDATE OR DELETE ON case_payment_proof_supplement_documents FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_supplement_draft();
CREATE FUNCTION reject_payment_proof_supplement_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'payment proof supplements and links are immutable' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER payment_proof_supplement_immutable BEFORE UPDATE OR DELETE ON case_payment_proof_supplements FOR EACH ROW EXECUTE FUNCTION reject_payment_proof_supplement_mutation();
CREATE TRIGGER payment_proof_supplement_document_immutable BEFORE UPDATE OR DELETE ON case_payment_proof_supplement_documents FOR EACH ROW EXECUTE FUNCTION reject_payment_proof_supplement_mutation();

CREATE FUNCTION check_payment_proof_supplement_final_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record; a record; p record; actual_ids uuid[]; expected jsonb;
BEGIN
 IF TG_TABLE_NAME='case_payment_proof_supplement_documents' THEN
  SELECT *,xmin AS creation_xmin INTO s FROM case_payment_proof_supplements WHERE id=NEW.supplement_id;
 ELSE SELECT *,xmin AS creation_xmin INTO s FROM case_payment_proof_supplements WHERE id=NEW.id; END IF;
 IF s.id IS NULL OR s.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid THEN
  RAISE EXCEPTION 'supplement and complete link set require the same transaction' USING ERRCODE='23514'; END IF;
 PERFORM assert_case_financial_actor_draft(s.actor_user_id,s.case_id,s.department_id,s.audit_event_id,
  s.id,'CASE_PAYMENT_PROOF_SUPPLEMENT','CASE_PAYMENT_PROOF_SUPPLEMENTED',ARRAY['WAITING_ARCHIVE','ARCHIVED']);
 SELECT * INTO p FROM case_closure_payment_versions WHERE id=s.payment_version_id AND payment_id=s.payment_id
  AND case_id=s.case_id AND department_id=s.department_id FOR UPDATE;
 IF p.id IS NULL OR p.state<>'ACTIVE' OR EXISTS(SELECT 1 FROM case_closure_payment_versions n WHERE n.prior_version_id=p.id)
  OR case_payment_proof_upload_eligible(s.actor_user_id,s.case_id,s.department_id) IS NOT TRUE
  OR NOT EXISTS(SELECT 1 FROM cases c JOIN case_closures h ON h.case_id=c.id AND h.department_id=c.department_id
   WHERE c.id=s.case_id AND c.department_id=s.department_id AND c.stage::text=s.stage
    AND h.current_version_id=s.expected_closure_version_id)
 THEN RAISE EXCEPTION 'supplement requires exact current case and active payment version' USING ERRCODE='23514'; END IF;
 -- Historical payment creation is intentionally not required in this transaction.
 -- Original payment.documents stays unchanged so original command replay survives.
 IF (SELECT count(DISTINCT id) FROM unnest(s.content_version_ids) AS ids(id))<>cardinality(s.content_version_ids) THEN
  RAISE EXCEPTION 'duplicate supplement content version' USING ERRCODE='23514'; END IF;
 SELECT array_agg(d.content_version_id ORDER BY d.content_version_id) INTO actual_ids
  FROM case_payment_proof_supplement_documents d WHERE d.supplement_id=s.id;
 IF actual_ids IS DISTINCT FROM (SELECT array_agg(id ORDER BY id) FROM unnest(s.content_version_ids) AS ids(id))
  OR EXISTS(SELECT 1 FROM case_payment_proof_supplement_documents d WHERE d.supplement_id=s.id
   AND (d.xmin<>pg_current_xact_id()::text::xid OR d.payment_version_id<>s.payment_version_id OR d.case_id<>s.case_id OR d.department_id<>s.department_id))
 THEN RAISE EXCEPTION 'supplement link set is incomplete or from another transaction' USING ERRCODE='23514'; END IF;
 PERFORM m.id FROM case_payment_proof_supplement_documents d
  JOIN materials m ON m.id=d.material_id AND m.department_id=d.department_id
  JOIN content_versions v ON v.id=d.content_version_id AND v.material_id=m.id
  WHERE d.supplement_id=s.id ORDER BY m.id,v.id FOR SHARE OF m,v NOWAIT;
 IF EXISTS(SELECT 1 FROM case_payment_proof_supplement_documents d WHERE d.supplement_id=s.id AND (
  EXISTS(SELECT 1 FROM case_closure_payment_documents original WHERE original.payment_version_id=s.payment_version_id AND original.content_version_id=d.content_version_id)
  OR NOT EXISTS(SELECT 1 FROM materials m JOIN content_versions v ON v.material_id=m.id
   WHERE m.id=d.material_id AND m.department_id=s.department_id AND m.owner_type='CASE' AND m.owner_id=s.case_id
    AND m.status='ACTIVE' AND m.deleted_at IS NULL AND m.category::text='CASE_CLOSURE_PAYMENT_PROOF'
    AND m.purpose='CASE_CLOSURE_PAYMENT_PROOF' AND m.current_version_id=v.id AND v.id=d.content_version_id
    AND v.status='AVAILABLE' AND v.mime_type IN ('image/jpeg','image/png') AND v.size_bytes BETWEEN 1 AND 20971520)))
 THEN RAISE EXCEPTION 'supplement screenshot belongs to another case, is unavailable or is already original evidence' USING ERRCODE='23514'; END IF;
 SELECT *,xmin AS creation_xmin INTO a FROM audit_events WHERE id=s.audit_event_id FOR SHARE;
 expected:=jsonb_build_object('id',s.id,'caseId',s.case_id,'paymentId',s.payment_id,'paymentVersionId',s.payment_version_id,
  'closureVersionId',s.expected_closure_version_id,'stage',s.stage,'contentVersionIds',to_jsonb(actual_ids),
  'recordedAt',to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
 IF a.id IS NULL OR a.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid
  OR s.result_snapshot IS DISTINCT FROM expected
  OR a.details IS DISTINCT FROM jsonb_build_object('authorizationRevision',s.authorization_revision,'idempotencyKey',s.idempotency_key,
   'requestFingerprint',s.request_fingerprint,'result',expected)
 THEN RAISE EXCEPTION 'supplement audit and immutable response do not match' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER payment_proof_supplement_complete AFTER INSERT ON case_payment_proof_supplements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_proof_supplement_final_draft();
CREATE CONSTRAINT TRIGGER payment_proof_supplement_document_complete AFTER INSERT ON case_payment_proof_supplement_documents DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_payment_proof_supplement_final_draft();
CREATE FUNCTION reject_payment_proof_supplement_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM case_payment_proof_supplements WHERE audit_event_id=OLD.id) THEN
  RAISE EXCEPTION 'payment proof supplement audit is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER payment_proof_supplement_audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_payment_proof_supplement_audit_mutation();
CREATE TRIGGER archive_snapshot_source_order BEFORE INSERT OR UPDATE OR DELETE ON case_payment_proof_supplements FOR EACH ROW EXECUTE FUNCTION guard_archive_snapshot_source_order();
CREATE TRIGGER archive_snapshot_source_order BEFORE INSERT OR UPDATE OR DELETE ON case_payment_proof_supplement_documents FOR EACH ROW EXECUTE FUNCTION guard_archive_snapshot_source_order();
COMMIT;
