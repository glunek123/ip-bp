import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030330000_case_payment_proof_supplement_draft/migration.sql',
  ),
  'utf8',
);
const executable = sql.replace(/--[^\r\n]*/gu, '');

describe('closed payment screenshot supplement SQL contract (not PostgreSQL execution)', () => {
  it('adds only separate event and link tables, preserving initial screenshots and payment receipts', () => {
    expect(sql).toContain('CREATE TABLE case_payment_proof_supplements');
    expect(sql).toContain(
      'CREATE TABLE case_payment_proof_supplement_documents',
    );
    expect(executable).not.toMatch(
      /\b(?:ALTER\s+TABLE|DROP\s+(?:TRIGGER|TABLE|CONSTRAINT)|DISABLE\s+TRIGGER|INSERT\s+INTO|UPDATE\s+case_closure|DELETE\s+FROM)/iu,
    );
    expect(executable).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/iu);
    expect(executable).not.toMatch(
      /ON\s+(?:material_references|upload_drafts|materials)\b/iu,
    );
  });

  it('keeps both event and link writes unconditionally blocked independently of future provenance checks', () => {
    expect(sql).toContain(
      "BEGIN RAISE EXCEPTION 'payment proof supplements remain draft and disabled' USING ERRCODE='23514'; END;",
    );
    for (const table of [
      'case_payment_proof_supplements',
      'case_payment_proof_supplement_documents',
    ]) {
      expect(sql).toContain(
        `BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION guard_payment_proof_supplement_draft()`,
      );
      expect(sql).toContain(
        `BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_payment_proof_supplement_mutation()`,
      );
    }
  });

  it('prevents attaching a different payment, case, department or material version through composite foreign keys', () => {
    expect(sql).toContain(
      'FOREIGN KEY(payment_version_id,payment_id,case_id,department_id) REFERENCES case_closure_payment_versions(id,payment_id,case_id,department_id)',
    );
    expect(sql).toContain(
      'FOREIGN KEY(supplement_id,payment_version_id,case_id,department_id) REFERENCES case_payment_proof_supplements(id,payment_version_id,case_id,department_id)',
    );
    expect(sql).toContain(
      'FOREIGN KEY(expected_closure_version_id,case_id,department_id) REFERENCES case_closure_versions(id,case_id,department_id)',
    );
    expect(sql).toContain(
      'FOREIGN KEY(material_id,department_id) REFERENCES materials(id,department_id)',
    );
    expect(sql).toContain(
      'FOREIGN KEY(material_id,content_version_id) REFERENCES content_versions(material_id,id)',
    );
    expect(sql).not.toMatch(/ON\s+DELETE\s+CASCADE|ON\s+UPDATE\s+CASCADE/iu);
  });

  it('provides a separate actor-scoped idempotency namespace and rejects duplicate evidence across supplement events', () => {
    expect(sql).toContain(
      'payment_proof_supplement_actor_key UNIQUE(department_id,actor_user_id,idempotency_key)',
    );
    expect(sql).toContain("request_fingerprint ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain('UNIQUE(payment_version_id,content_version_id)');
    expect(sql).toContain('cardinality(content_version_ids) BETWEEN 1 AND 10');
    expect(sql).toContain('array_position(content_version_ids,NULL) IS NULL');
    expect(sql).toContain(
      'count(DISTINCT id) FROM unnest(s.content_version_ids)',
    );
  });

  it('requires the currently authorized own-case financial actor, not the original payer recorder', () => {
    expect(sql).toContain(
      'PERFORM assert_case_financial_actor_draft(s.actor_user_id,s.case_id,s.department_id,s.audit_event_id,',
    );
    expect(sql).toContain(
      "s.id,'CASE_PAYMENT_PROOF_SUPPLEMENT','CASE_PAYMENT_PROOF_SUPPLEMENTED',ARRAY['WAITING_ARCHIVE','ARCHIVED']",
    );
    expect(sql).toContain("'authorizationRevision',s.authorization_revision");
    expect(executable).not.toContain('p.recorded_by_user_id=s.actor_user_id');
  });

  it('rejects stale closure targets, corrected or voided payments while allowing an existing active payment', () => {
    expect(sql).toContain("p.state<>'ACTIVE'");
    expect(sql).toContain('n.prior_version_id=p.id');
    expect(sql).toContain('h.current_version_id=s.expected_closure_version_id');
    expect(sql).toContain(
      'case_payment_proof_upload_eligible(s.actor_user_id,s.case_id,s.department_id) IS NOT TRUE',
    );
    expect(sql).toContain('c.stage::text=s.stage');
    expect(sql).toContain(
      'AND case_id=s.case_id AND department_id=s.department_id FOR UPDATE',
    );
    expect(executable).not.toMatch(/p\.xmin|p\.creation_xmin/iu);
  });

  it('requires complete same-transaction links and leaves the immutable original screenshot set unchanged', () => {
    expect(sql).toContain(
      's.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid',
    );
    expect(sql).toContain('d.xmin<>pg_current_xact_id()::text::xid');
    expect(sql).toContain('actual_ids IS DISTINCT FROM');
    expect(sql).toContain(
      'array_agg(id ORDER BY id) FROM unnest(s.content_version_ids)',
    );
    expect(sql).toContain(
      'original.payment_version_id=s.payment_version_id AND original.content_version_id=d.content_version_id',
    );
    for (const table of [
      'case_payment_proof_supplements',
      'case_payment_proof_supplement_documents',
    ])
      expect(sql).toContain(
        `AFTER INSERT ON ${table} DEFERRABLE INITIALLY DEFERRED`,
      );
  });

  it('locks and validates current same-case available screenshot versions without accepting PDFs or cross-case files', () => {
    expect(sql).toContain('ORDER BY m.id,v.id FOR SHARE OF m,v NOWAIT');
    expect(sql).toContain("m.owner_type='CASE' AND m.owner_id=s.case_id");
    expect(sql).toContain("m.category::text='CASE_CLOSURE_PAYMENT_PROOF'");
    expect(sql).toContain(
      "m.purpose='CASE_CLOSURE_PAYMENT_PROOF' AND m.current_version_id=v.id AND v.id=d.content_version_id",
    );
    expect(sql).toContain(
      "v.status='AVAILABLE' AND v.mime_type IN ('image/jpeg','image/png') AND v.size_bytes BETWEEN 1 AND 20971520",
    );
  });

  it('binds a canonical exact response and fresh audit, and prevents later audit edits or deletion', () => {
    expect(sql).toContain(
      'a.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid',
    );
    expect(sql).toContain('s.result_snapshot IS DISTINCT FROM expected');
    expect(sql).toContain(
      "a.details IS DISTINCT FROM jsonb_build_object('authorizationRevision',s.authorization_revision,'idempotencyKey',s.idempotency_key,",
    );
    expect(sql).toContain(
      "'requestFingerprint',s.request_fingerprint,'result',expected",
    );
    expect(sql).toContain("'paymentVersionId',s.payment_version_id");
    expect(sql).toContain("'contentVersionIds',to_jsonb(actual_ids)");
    expect(sql).toContain('WHERE audit_event_id=OLD.id');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON audit_events');
  });

  it('prevents later supplement source writes in a transaction after archive snapshot capture', () => {
    for (const table of [
      'case_payment_proof_supplements',
      'case_payment_proof_supplement_documents',
    ])
      expect(sql).toContain(
        `BEFORE INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION guard_archive_snapshot_source_order()`,
      );
  });
});
