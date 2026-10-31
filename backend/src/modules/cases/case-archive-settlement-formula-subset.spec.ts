import {
  base,
  settlementSqlDifferentialVectors,
} from './case-archive-settlement-formula-subset.fixtures';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  calculateSettlement,
  SETTLEMENT_V1,
  SETTLEMENT_V2,
} from '../settlements';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030210000_verified_settlement_formula_subset_draft/migration.sql',
  ),
  'utf8',
);
describe('settlement SQL subset draft reference cases (no SQL execution)', () => {
  it.each(settlementSqlDifferentialVectors)('$name', (vector) => {
    expect(calculateSettlement(vector.input, SETTLEMENT_V1)).toMatchObject({
      customerAmount: vector.expectedCustomer,
      lawyerAmount: vector.expectedLawyer,
    });
  });
  it('includes Decimal precision at every operation, exact numeric arithmetic and immutable source binding', () => {
    expect(sql).toContain('RETURN round(n,35-exponent)');
    expect(sql).toContain(
      'archive_decimal36_nonnegative(archive_decimal36_nonnegative(basis*cp)*0.01)',
    );
    expect(sql).toContain('archive_decimal36_nonnegative(base+lawyer)');
    expect(sql).toContain(
      'verified_outputs:=archive_verified_settlement_outputs(expected_inputs)',
    );
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|double precision|::float/iu,
    );
  });
  it('retains percent precision and rejects unsupported formula matching instead of broadening the language', () => {
    expect(sql).toContain('formula COLLATE "C"');
    expect(sql).toContain('[0-9]{1,16}');
    expect(sql).toContain('IF matched IS NULL THEN RETURN NULL');
  });
  it.each(['101%', '99.12345678901234567%'])(
    'TS rejects invalid percentage reference %s',
    (formula) => {
      expect(() =>
        calculateSettlement({ ...base, customerFormula: formula }),
      ).toThrow();
    },
  );
});

const v2Sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030260000_settlement_manual_cents_v2_draft/migration.sql',
  ),
  'utf8',
);
describe('manual cents V2 forward draft (no SQL execution)', () => {
  it('keeps V1 outputs and changes only V2 manual overrides', () => {
    for (const vector of settlementSqlDifferentialVectors) {
      const v1 = calculateSettlement(vector.input, SETTLEMENT_V1);
      const v2 = calculateSettlement(vector.input, SETTLEMENT_V2);
      expect(v2.customerAutomaticAmount).toBe(v1.customerAutomaticAmount);
      expect(v2.lawyerAutomaticAmount).toBe(v1.lawyerAutomaticAmount);
      if (!vector.input.customerManualAmount)
        expect(v2.customerAmount).toBe(v1.customerAmount);
      if (!vector.input.lawyerManualAmount)
        expect(v2.lawyerAmount).toBe(v1.lawyerAmount);
    }
    expect(
      calculateSettlement(
        {
          ...base,
          customerManualAmount: '123.50',
          lawyerManualAmount: '100.20',
        },
        SETTLEMENT_V2,
      ),
    ).toMatchObject({ customerAmount: '123.50', lawyerAmount: '100.20' });
  });
  it('preserves old SQL function and dispatches snapshot validation by recorded version', () => {
    expect(v2Sql).toContain(
      'CREATE FUNCTION archive_verified_settlement_outputs_v2',
    );
    expect(v2Sql).toContain(
      "customer:=(inputs->>'customerManualAmount')::numeric",
    );
    expect(v2Sql).toContain("lawyer:=(inputs->>'lawyerManualAmount')::numeric");
    expect(v2Sql).toContain(
      "IF a.calculation_rule_version='settlement-calculation-v1-whole-yuan-half-up' THEN",
    );
    expect(v2Sql).toContain(
      'verified_outputs:=archive_verified_settlement_outputs(expected_inputs)',
    );
    expect(v2Sql).toContain(
      'verified_outputs:=archive_verified_settlement_outputs_v2(expected_inputs)',
    );
    expect(v2Sql).not.toMatch(
      /CREATE OR REPLACE FUNCTION archive_verified_settlement_outputs\(|UPDATE case_|DELETE FROM|DROP TRIGGER|DISABLE TRIGGER/iu,
    );
  });
});
