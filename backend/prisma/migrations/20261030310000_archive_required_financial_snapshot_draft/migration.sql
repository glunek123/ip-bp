-- Forward draft only. Existing snapshot write gates remain closed.
-- An INSERT-only deferred trigger does not scan or relabel historical archives.
-- Source preparation and snapshot parent/items must finish before constraints
-- are made IMMEDIATE. The shared validator resolves the latest 2000/2100/2600
-- protocol; do not copy a calculator or accept archive stage as financial proof.
BEGIN;
CREATE FUNCTION check_new_archive_required_financial_snapshot_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s case_archive_evidence_snapshots%ROWTYPE;
BEGIN
 IF NEW.kind IS DISTINCT FROM 'ARCHIVE' THEN RETURN NEW; END IF;
 IF current_setting('transaction_isolation')<>'serializable' THEN
  RAISE EXCEPTION 'new archive requires serializable financial verification' USING ERRCODE='23514';
 END IF;
 SELECT * INTO s FROM case_archive_evidence_snapshots
 WHERE archive_version_id=NEW.id AND case_id=NEW.case_id AND department_id=NEW.department_id
  AND closure_version_id=NEW.closure_version_id
  AND creation_xid=pg_current_xact_id() AND xmin=pg_current_xact_id()::text::xid
 FOR SHARE;
 IF s.id IS NULL THEN
  RAISE EXCEPTION 'new archive requires same-transaction exact financial snapshot' USING ERRCODE='23514';
 END IF;
 -- Revalidate the complete immutable child sets and authoritative current heads
 -- even when this trigger runs before the snapshot's queued deferred triggers.
 PERFORM validate_archive_snapshot_readiness(s.id);
 IF s.closure_amount=0 THEN
  IF ROW(s.readiness,s.payment_readiness,s.refund_readiness,s.customer_readiness,s.lawyer_readiness)
   IS DISTINCT FROM ROW('EXEMPT'::varchar,'EXEMPT'::varchar,'EXEMPT'::varchar,'EXEMPT'::varchar,'EXEMPT'::varchar) THEN
   RAISE EXCEPTION 'known zero archive requires exact exempt verification' USING ERRCODE='23514';
  END IF;
 ELSIF s.closure_amount IS NULL OR s.closure_amount<0 OR
  ROW(s.readiness,s.payment_readiness,s.refund_readiness,s.customer_readiness,s.lawyer_readiness)
   IS DISTINCT FROM ROW('PASSED'::varchar,'PASSED'::varchar,'PASSED'::varchar,'PASSED'::varchar,'PASSED'::varchar) THEN
  RAISE EXCEPTION 'new archive financial verification is unknown or incomplete' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER new_archive_required_financial_snapshot_draft
 AFTER INSERT ON case_archive_versions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION check_new_archive_required_financial_snapshot_draft();
COMMIT;
