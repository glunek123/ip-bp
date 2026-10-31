import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030160000_closure_settlement_update_receipt_draft/migration.sql',
  ),
  'utf8',
);
describe('atomic settlement update receipt draft', () => {
  it('has a dedicated immutable namespace and actor-key uniqueness without historical writes', () => {
    expect(sql).toContain(
      'UNIQUE(department_id,actor_user_id,idempotency_key)',
    );
    expect(sql).toContain('closure_settlement_update_receipt_gate');
    expect(sql).toContain('closure_settlement_update_payment_immutable');
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|INSERT INTO|UPDATE cases/iu,
    );
  });
  it('binds exact correction and all participating child versions, fingerprints and audits', () => {
    for (const value of [
      "v.kind<>'CORRECT'",
      "cr.command='CORRECT'",
      'cr.request_fingerprint=r.request_fingerprint',
      'p.closure_version_id<>v.id',
      'child.closure_version_id=v.id',
      'child.xmin=pg_current_xact_id()::text::xid',
      'v.creation_xmin<>pg_current_xact_id()::text::xid',
      'result_snapshot IS DISTINCT FROM expected',
    ])
      expect(sql).toContain(value);
  });
  it.each([
    ['CORRECT', 'p.revision<>1'],
    ['VOID', "p.state<>'ACTIVE'"],
    ['prior-version adoption', 'p.prior_version_id IS NOT NULL'],
    ['another payment identity', 'p.payment_id<>p.id'],
  ])('rejects adopting %s as an additive payment', (_scenario, predicate) => {
    expect(sql).toContain(predicate);
    expect(sql).toContain('settlement update payment child mismatch');
  });
  it('represents omitted refund and assessment explicitly and requires an exact payment set', () => {
    expect(sql).toContain(
      'CHECK(refund_included=(refund_version_id IS NOT NULL))',
    );
    expect(sql).toContain(
      'CHECK(assessment_included=(assessment_version_id IS NOT NULL))',
    );
    expect(sql).toContain('settlement update payment set incomplete');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  });
});
