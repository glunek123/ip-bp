import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030100000_case_settlement_assessment_draft/migration.sql',
  ),
  'utf8',
);

describe('settlement assessment draft (static contract only)', () => {
  it('parenthesizes both CASE values without changing automatic/manual selection', () => {
    for (const side of ['customer', 'lawyer']) {
      expect(sql).toContain(
        `OR NEW."${side}_source"<>(CASE WHEN t."${side}_manual_amount" IS NULL THEN 'AUTOMATIC' ELSE 'MANUAL' END)`,
      );
      expect(sql).not.toContain(`OR NEW."${side}_source"<>CASE`);
    }
  });
  it('closes all writes and does not populate historical facts', () => {
    expect(sql).toContain(
      'BEFORE INSERT OR UPDATE OR DELETE ON "case_settlement_assessment_versions"',
    );
    expect(sql).toContain(
      'settlement assessment persistence is draft and not enabled',
    );
    expect(sql).not.toMatch(/\bINSERT INTO\b/iu);
    expect(sql).not.toMatch(/\bALTER TABLE\s+"cases"/iu);
  });

  it('copies every current calculation input with explicit nulls', () => {
    for (const field of [
      'closureAmount',
      'closureAmountState',
      'fallbackClaimAmount',
      'customerFormula',
      'lawyerMode',
      'lawyerBaseFee',
      'lawyerSplitPercent',
      'customerManualAmount',
      'lawyerManualAmount',
    ]) {
      expect(sql).toContain(`'${field}'`);
    }
    expect(sql).toContain('NEW."calculation_inputs" IS DISTINCT FROM expected');
    expect(sql).toContain('NEW."terms_version" IS DISTINCT FROM t."version"');
    expect(sql).toContain('"calculation_rule_version" varchar(80) NOT NULL');
  });

  it('keeps explicit declarations separate from amounts and history immutable', () => {
    expect(sql).toContain("'UNKNOWN','APPLICABLE','NOT_APPLICABLE'");
    expect(sql).toContain(
      'CHECK ("declaration"<>\'UNKNOWN\' OR ("customer_amount" IS NULL AND "lawyer_amount" IS NULL))',
    );
    expect(sql).toContain(
      'CHECK ("declaration"<>\'NOT_APPLICABLE\' OR ("customer_amount" IS NULL AND "lawyer_amount" IS NULL))',
    );
    expect(sql).toContain('settlement assessment history is immutable');
    expect(sql).toContain('UNIQUE ("case_id","revision")');
    expect(sql).toContain('previous."revision"+1<>NEW."revision"');
    expect(sql).toContain('a."details"->>\'declaration\'=NEW."declaration"');
  });
});
