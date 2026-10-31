import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030070000_case_closure_payment_receipt_draft/migration.sql',
  ),
  'utf8',
);
describe('payment command receipt draft', () => {
  it('parenthesizes the complete CASE expression inside the PLpgSQL IF condition', () => {
    expect(sql).toMatch(
      /OR a\."action"<>\(CASE WHEN p\."revision"=1 THEN 'CASE_CLOSURE_PAYMENT_RECORD'\s+WHEN p\."state"='VOID' THEN 'CASE_CLOSURE_PAYMENT_VOID' ELSE 'CASE_CLOSURE_PAYMENT_CORRECT' END\)\s+THEN RAISE EXCEPTION/u,
    );
    expect(sql).not.toContain('OR a."action"<>CASE');
  });
  it('deduplicates the complete actor command key and preserves a full SHA256 fingerprint', () => {
    expect(sql).toContain(
      'UNIQUE ("department_id","actor_user_id","idempotency_key")',
    );
    expect(sql).toContain("'^[0-9a-f]{64}$'");
    expect(sql).not.toContain('INSERT INTO');
  });
  it('binds the returned version, case, actor and audit exactly', () => {
    expect(sql).toContain(
      'FOREIGN KEY ("payment_version_id","case_id","department_id")',
    );
    expect(sql).toContain('p."recorded_by_user_id"<>NEW."actor_user_id"');
    expect(sql).toContain('p."audit_event_id"<>NEW."audit_event_id"');
    expect(sql).toContain(
      'a."internal_actor_user_id" IS DISTINCT FROM NEW."actor_user_id"',
    );
    expect(sql).toContain(
      '(NEW."result_snapshot"->>\'versionId\') IS DISTINCT FROM p."id"::text',
    );
    expect(sql).toContain("'{review,caseId}'");
    expect(sql).toContain("'{review,closureVersionId}'");
  });
  it('preserves permanent immutability separately from the closed draft gate', () => {
    expect(sql).toContain('payment command receipts are immutable');
    expect(sql).toContain('closure_payment_receipt_consistency');
    expect(sql).toContain('closure_payment_receipt_draft_gate');
    expect(sql).toContain(
      'EXECUTE FUNCTION "guard_case_closure_payment_draft"()',
    );
  });
});

it('binds the immutable audit to the complete fingerprint and verified result', () => {
  expect(sql).toContain(
    '(a."details"->>\'fingerprint\') IS DISTINCT FROM NEW."request_fingerprint"',
  );
  expect(sql).toContain(
    '(a."details"->\'result\') IS DISTINCT FROM NEW."result_snapshot"',
  );
});
