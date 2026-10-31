import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030120000_case_settlement_assessment_receipt_draft/migration.sql',
  ),
  'utf8',
);

describe('assessment receipt draft static contract', () => {
  it('keeps writes closed and does not manufacture historical receipts', () => {
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "case_settlement_assessment_receipts"',
    );
    expect(sql).toContain(
      'EXECUTE FUNCTION "guard_case_settlement_assessment_draft"()',
    );
    expect(sql).not.toMatch(/\bINSERT INTO\b/iu);
    expect(sql).toContain(
      'authorize the CURRENT internal actor/scope before lookup',
    );
  });
  it('isolates idempotency namespace and binds exact request and audit snapshot', () => {
    expect(sql).toContain(
      'UNIQUE ("department_id","actor_user_id","idempotency_key")',
    );
    expect(sql).toContain('"assessment_version_id" uuid NOT NULL UNIQUE');
    expect(sql).toContain("'^[0-9a-f]{64}$'");
    expect(sql).toContain(
      'a."details"->>\'requestFingerprint\' IS DISTINCT FROM NEW."request_fingerprint"',
    );
    expect(sql).toContain(
      '(a."details"-\'requestFingerprint\') IS DISTINCT FROM NEW."result_snapshot"',
    );
    expect(sql).toContain('v."recorded_by_user_id"<>NEW."actor_user_id"');
    expect(sql).toContain('a."resource_id"<>v."id"');
  });
  it('retains exact source links and immutable audit', () => {
    expect(sql).toContain(
      'FOREIGN KEY ("assessment_version_id","case_id","department_id")',
    );
    for (const field of [
      'closureVersionId',
      'termsVersion',
      'declaration',
      'calculationInputs',
      'customerAmount',
      'lawyerAmount',
      'priorVersionId',
      'revision',
    ]) {
      expect(sql).toContain(`'${field}' IS DISTINCT FROM`);
    }
    expect(sql).toContain('assessment command receipts are immutable');
    expect(sql).toContain('assessment source audit is immutable');
  });
  it('binds applicable calculation sources and the actual recorded instant', () => {
    expect(sql).toContain('IF v."declaration"=\'APPLICABLE\' AND (');
    expect(sql).toContain(
      "jsonb_typeof(NEW.\"result_snapshot\"->'calculationResult') IS DISTINCT FROM 'object'",
    );
    expect(sql).toContain(
      'NEW."result_snapshot"#>>\'{calculationResult,customerSource}\' IS DISTINCT FROM v."customer_source"',
    );
    expect(sql).toContain(
      'NEW."result_snapshot"#>>\'{calculationResult,lawyerSource}\' IS DISTINCT FROM v."lawyer_source"',
    );
    expect(sql).toContain(
      'NEW."result_snapshot"#>>\'{calculationResult,customerAmount}\' IS DISTINCT FROM v."customer_amount"::text',
    );
    expect(sql).toContain(
      'NEW."result_snapshot"#>>\'{calculationResult,lawyerAmount}\' IS DISTINCT FROM v."lawyer_amount"::text',
    );
    expect(sql).toContain('(NEW."result_snapshot"->>\'recordedAt\') IS NULL');
    expect(sql).toContain(
      '(NEW."result_snapshot"->>\'recordedAt\')::timestamptz IS DISTINCT FROM v."recorded_at"',
    );
  });
  it.each(['customer', 'lawyer'])(
    'statically requires both top-level and nested %s amount checks',
    (side) => {
      // A correct top-level amount with a mismatched/missing nested amount must
      // encounter an independent null-safe comparison. This is source-contract
      // evidence only; actual SQL counterexamples still require PostgreSQL.
      expect(sql).toContain(
        `NEW."result_snapshot"->>'${side}Amount' IS DISTINCT FROM v."${side}_amount"::text`,
      );
      expect(sql).toContain(
        `NEW."result_snapshot"#>>'{calculationResult,${side}Amount}' IS DISTINCT FROM v."${side}_amount"::text`,
      );
    },
  );
  it('allows missing or null calculation results only for unassessed declarations', () => {
    expect(sql).toContain("v.\"declaration\" IN ('UNKNOWN','NOT_APPLICABLE')");
    expect(sql).toContain(
      'NEW."result_snapshot"->\'calculationResult\' IS NOT NULL',
    );
    expect(sql).toContain(
      "NEW.\"result_snapshot\"->'calculationResult'<>'null'::jsonb",
    );
    expect(sql).toContain(
      'unassessed declaration cannot carry calculated results',
    );
  });
});
