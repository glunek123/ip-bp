import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030360000_original_payment_document_seal_draft/migration.sql',
  ),
  'utf8',
);

describe('closed original payment document seal draft', () => {
  it('adds guards without changing gates, historical rows or supplement contracts', () => {
    expect(sql).not.toMatch(
      /DROP |ALTER |CREATE OR REPLACE|INSERT INTO|UPDATE .* SET|DELETE FROM/iu,
    );
    expect(sql).toContain(
      "IF NEW.resource_type<>'case-closure-payment-version' THEN RETURN NEW",
    );
    expect(sql.match(/CREATE CONSTRAINT TRIGGER /gu)).toHaveLength(4);
    expect(sql.match(/DEFERRABLE INITIALLY DEFERRED/gu)).toHaveLength(4);
  });
  it('seals insertion after a receipt and requires transaction-local payment audit and receipt', () => {
    for (const clause of [
      'FOR UPDATE;',
      'EXISTS (SELECT 1 FROM case_closure_payment_receipts r WHERE r.payment_version_id=p.id)',
      'p.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid',
      'a.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid',
      'r.creation_xmin IS DISTINCT FROM pg_current_xact_id()::text::xid',
      'r.actor_user_id IS DISTINCT FROM p.recorded_by_user_id',
      "a.details->'result' IS DISTINCT FROM r.result_snapshot",
    ])
      expect(sql).toContain(clause);
  });
  it('checks exact document/reference sets in both directions with frozen source provenance', () => {
    for (const clause of [
      'JOIN upload_drafts u ON u.id=v.source_upload_draft_id',
      "u.status='FINALIZED' AND u.actor_user_id=v.uploaded_by",
      "m.owner_type='CASE' AND m.owner_id=p.case_id",
      'm.current_version_id=v.id AND v.id=d.content_version_id',
      "ref.resource_type='case-closure-payment-version'",
      'ref.action_event_id=p.audit_event_id AND ref.asset_version_id IS NULL',
      'ref.xmin=pg_current_xact_id()::text::xid',
      'OR EXISTS (SELECT 1 FROM material_references ref',
      'OR NOT EXISTS (SELECT 1 FROM case_closure_payment_documents d',
      'ORDER BY m.id,v.id FOR SHARE OF m,v',
    ])
      expect(sql).toContain(clause);
  });

  it.each([
    ['missing RECORD declaration', 'IF declared_screenshot IS NULL'],
    [
      'null RECORD declaration with an undeclared document',
      "declared_screenshot='null'::jsonb AND cardinality(document_ids)<>0",
    ],
    [
      'non-string RECORD declaration',
      "jsonb_typeof(declared_screenshot) IS DISTINCT FROM 'string'",
    ],
    [
      'one declared screenshot with zero or multiple documents',
      'OR cardinality(document_ids)<>1',
    ],
    [
      'one declared screenshot with another content version',
      'declared_screenshot IS DISTINCT FROM to_jsonb(document_ids[1]::text)',
    ],
    [
      'CORRECT/VOID with an original screenshot or fabricated declaration',
      "IF a.details ? 'screenshotContentVersionId' OR cardinality(document_ids)<>0 THEN",
    ],
  ])('contains a fail-closed SQL condition for %s', (_scenario, condition) => {
    expect(sql).toContain(condition);
    expect(sql).toContain('IF p.revision=1 THEN');
    expect(sql).toContain(
      'original payment screenshot set differs from record audit declaration',
    );
    expect(sql).toContain(
      'payment correction and void cannot carry original screenshots',
    );
  });

  it('matches the real RECORD and CORRECT/VOID audit contracts', () => {
    const source = (name: string) =>
      readFileSync(resolve(process.cwd(), 'src/modules/cases', name), 'utf8');
    for (const name of [
      'case-early-closure-transaction-draft.service.ts',
      'case-closure-settlement-update-transaction-draft.service.ts',
    ]) {
      expect(source(name)).toContain(
        'screenshotContentVersionId: p.screenshotContentVersionId',
      );
    }
    const correction = source('case-closure-payment-prisma-draft.ts');
    expect(correction).not.toContain('screenshotContentVersionId');
    expect(correction).toContain('priorVersionId: a.priorVersionId');
  });
});
