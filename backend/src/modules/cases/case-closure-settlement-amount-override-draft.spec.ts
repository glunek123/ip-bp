import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030270000_closure_settlement_amount_override_draft/migration.sql',
  ),
  'utf8',
);

describe('closure settlement amount override forward draft (source only)', () => {
  it('preserves the draft write gates and historical records', () => {
    expect(sql).toContain(
      'CREATE OR REPLACE FUNCTION check_closure_settlement_update_receipt_final()',
    );
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|INSERT INTO|UPDATE case_settlement_terms/iu,
    );
    expect(sql).toContain('Existing write gates remain closed');
  });
  it('binds amount history audit, updated terms and assessment inputs to the same transaction and parent', () => {
    for (const predicate of [
      "'settlementTermsChange',r.result_snapshot->'settlementTermsChange'",
      "ta.action='case.closure.settlement_amounts.updated'",
      'ta.xmin=pg_current_xact_id()::text::xid',
      't.xmin=pg_current_xact_id()::text::xid',
      "ta.details->>'requestFingerprint'=r.request_fingerprint",
      "ta.details->>'parentIdempotencyKey'=r.idempotency_key",
      "ta.details->'before'=r.result_snapshot#>'{settlementTermsChange,before}'",
      "ta.details->'after'=r.result_snapshot#>'{settlementTermsChange,after}'",
      'av.terms_version=t.version',
      "av.calculation_inputs->'customerManualAmount'=ta.details#>'{after,customerManualAmount}'",
      "av.calculation_inputs->'lawyerManualAmount'=ta.details#>'{after,lawyerManualAmount}'",
    ])
      expect(sql).toContain(predicate);
  });
  it('uses the PostgreSQL xmin system column on the audit_events table alias', () => {
    expect(sql).toContain('FROM audit_events ta');
    expect(sql).toContain('ta.xmin=pg_current_xact_id()::text::xid');
    expect(sql).not.toMatch(/\bta\.creation_xmin\b/u);
  });
});
