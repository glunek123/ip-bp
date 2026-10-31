import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('payment proof claimed storage draft', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20261030500000_payment_proof_claimed_storage_draft/migration.sql',
    ),
    'utf8',
  );
  it('requires the live claimed key and same-case source before content insertion', () => {
    for (const clause of [
      'FOR UPDATE',
      'NEW.storage_key IS DISTINCT FROM d.pending_storage_key',
      'd.owner_id IS DISTINCT FROM m.owner_id',
      'd.department_id IS DISTINCT FROM m.department_id',
      'NEW.uploaded_by IS DISTINCT FROM d.actor_user_id',
    ])
      expect(sql).toContain(clause);
  });
  it('leaves existing gates and historical rows untouched', () => {
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|UPDATE materials|UPDATE content_versions/iu,
    );
    expect(sql).toContain('BEFORE INSERT ON content_versions');
  });
  it('locks material classification and protects content provenance without blocking freeze touches', () => {
    expect(sql).toContain('WHERE id=NEW.material_id FOR SHARE');
    expect(sql).toContain(
      'payment_proof_reclassification_draft BEFORE UPDATE ON materials',
    );
    expect(sql).toContain(
      'payment_proof_draft_reclassification_draft BEFORE UPDATE ON upload_drafts',
    );
    expect(sql).toContain('WHERE id=NEW.source_upload_draft_id FOR SHARE');
    expect(sql).not.toContain(
      'EXISTS (SELECT 1 FROM content_versions WHERE material_id=OLD.id)',
    );
    for (const field of [
      'original_filename',
      'mime_type',
      'size_bytes',
      'sha256',
      'status',
      'derived_from_version_id',
    ])
      expect(sql).toContain(`NEW.${field}`);
    expect(sql).toContain(
      'OLD.payment_proof_frozen OR NEW.payment_proof_frozen',
    );
    expect(sql).not.toContain(
      'NEW.payment_proof_frozen IS DISTINCT FROM OLD.payment_proof_frozen',
    );
  });
  it('locks the actual material before accepting the narrow cleanup transitions', () => {
    const body =
      sql
        .split(
          'CREATE FUNCTION guard_payment_proof_storage_provenance_immutable_draft()',
        )[1]
        ?.split('CREATE TRIGGER')[0] ?? '';
    const lock = body.indexOf(
      'SELECT * INTO cleanup_material FROM materials WHERE id=OLD.material_id FOR NO KEY UPDATE NOWAIT',
    );
    const check = body.indexOf(
      "cleanup_material.status::text IS DISTINCT FROM 'DELETED'",
    );
    expect(lock).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(lock);
    for (const clause of [
      "OLD.status::text='AVAILABLE' AND NEW.status::text='DELETED'",
      "OLD.status::text='DELETED' AND NEW.status::text='PURGED'",
      "cleanup_material.deleted_at + INTERVAL '90 days' > CURRENT_TIMESTAMP",
      'cleanup_material.payment_proof_frozen',
      'FROM material_references r WHERE r.content_version_id=OLD.id',
      'FROM case_closure_payment_documents d WHERE d.content_version_id=OLD.id',
      'FROM case_payment_proof_supplement_documents d WHERE d.content_version_id=OLD.id',
    ])
      expect(body).toContain(clause);
  });
  it('classifies references by both actual targets and protects old proof targets from mutation', () => {
    const body =
      sql
        .split(
          'CREATE FUNCTION guard_payment_proof_reference_target_draft()',
        )[1]
        ?.split('CREATE TRIGGER')[0] ?? '';
    expect(body).toContain('m.id=OLD.material_id');
    expect(body).toContain('v.id=OLD.content_version_id');
    expect(body).toContain(
      'INTO target_material FROM materials WHERE id=NEW.material_id',
    );
    expect(body).toContain(
      'INTO target_content FROM content_versions WHERE id=NEW.content_version_id',
    );
    expect(body).toContain(
      'target_content.material_id IS DISTINCT FROM target_material.id',
    );
    expect(body).toContain(
      'target_material.id IS NULL OR target_content.id IS NULL',
    );
    expect(body).toContain(
      'material reference requires visible matching targets',
    );
    expect(body).toContain(
      "m.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR m.purpose='CASE_CLOSURE_PAYMENT_PROOF'",
    );
    expect(body).toContain(
      "target_material.category::text='CASE_CLOSURE_PAYMENT_PROOF' OR target_material.purpose='CASE_CLOSURE_PAYMENT_PROOF'",
    );
    expect(body).toContain(
      "NEW.purpose IS DISTINCT FROM 'CASE_CLOSURE_PAYMENT_PROOF'",
    );
    expect(body).toContain(
      "NEW.resource_type NOT IN ('case-closure-payment-version','case-payment-proof-supplement')",
    );
    expect(body.indexOf("IF TG_OP<>'INSERT' THEN")).toBeLessThan(
      body.indexOf("IF TG_OP='DELETE' THEN RETURN OLD"),
    );
    expect(body).toContain('payment proof target reference is immutable');
    expect(sql).toContain(
      'payment_proof_reference_target_draft BEFORE INSERT OR UPDATE OR DELETE ON material_references',
    );
  });
});
