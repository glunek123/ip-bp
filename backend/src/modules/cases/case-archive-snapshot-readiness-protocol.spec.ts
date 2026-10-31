import {
  calculateSettlement,
  SETTLEMENT_V1,
  SETTLEMENT_V2,
} from '../settlements';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(
  resolve(
    process.cwd(),
    'prisma/migrations/20261030200000_archive_snapshot_readiness_protocol_draft/migration.sql',
  ),
  'utf8',
);
describe('historical V1 archive readiness protocol SQL draft (not PostgreSQL execution)', () => {
  it('keeps existing source completeness and write gates intact', () => {
    expect(sql).toContain(
      'PERFORM validate_case_archive_evidence_snapshot(snapshot_id)',
    );
    expect(sql).not.toMatch(
      /DROP TRIGGER|DISABLE TRIGGER|INSERT INTO|UPDATE case_archive/iu,
    );
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  });
  it('binds parent states and amounts to authoritative complete child sets', () => {
    expect(sql).toContain(
      'JOIN case_closure_payment_versions p ON p.id=x.payment_version_id',
    );
    expect(sql).toContain(
      'JOIN case_settlement_actual_allocations v ON v.id=x.allocation_id',
    );
    expect(sql).not.toContain('sum(f.amount)');
    expect(sql).toContain(
      's.closure_amount,s.paid_amount,s.customer_required_amount',
    );
    expect(sql).toContain('IS DISTINCT FROM ROW(overall_state,payment_state');
    expect(sql).toContain('paid_amount numeric');
    expect(sql).toContain('customer_allocated_amount numeric');
  });
  it('requires explicit known zero before exempting every condition', () => {
    expect(sql).toContain(
      "c.close_amount_state='KNOWN' AND c.close_amt IS NOT NULL",
    );
    expect(sql).toContain('IF required_closure=0 THEN');
    expect(sql).toContain(
      "payment_state:='EXEMPT'; refund_state:='EXEMPT'; customer_state:='EXEMPT'; lawyer_state:='EXEMPT'; overall_state:='EXEMPT'",
    );
  });
  it('requires complete latest inventory and exact assessment inputs, versions and rule', () => {
    expect(sql).toContain("r.declaration='COMPLETE' AND refund_count>0");
    expect(sql).toContain("r.declaration='NOT_APPLICABLE' AND refund_count=0");
    expect(sql).toContain('a.terms_version IS NOT DISTINCT FROM t.version');
    expect(sql).toContain('a.calculation_inputs=expected_inputs');
    expect(sql).toContain('a.closure_version_id=c.id');
  });
  it('does not certify automatic formula outputs and never treats unknown as passed', () => {
    expect(sql).toContain("a.customer_source='MANUAL'");
    expect(sql).toContain("a.lawyer_source='MANUAL'");
    expect(sql).not.toContain("a.customer_source='AUTOMATIC'");
    expect(sql).toContain("overall_state text:='UNKNOWN'");
    expect(sql).toContain(
      "ELSIF payment_state='PASSED' AND refund_state='PASSED' AND customer_state='PASSED' AND lawyer_state='PASSED'",
    );
  });
});

it.each([
  ['0.00', '0.00'],
  ['0.49', '0.00'],
  ['0.50', '1.00'],
  ['123.49', '123.00'],
  ['123.50', '124.00'],
  ['123.51', '124.00'],
  ['9999999999999999.99', '10000000000000000.00'],
])(
  'preserves historical V1 manual rounding %s to %s; SQL remains unexecuted',
  (amount, expected) => {
    const input = {
      closureAmount: '100.00',
      closureAmountState: 'KNOWN' as const,
      fallbackClaimAmount: null,
      customerFormula: null,
      lawyerMode: null,
      lawyerBaseFee: null,
      lawyerSplitPercent: null,
      customerManualAmount: amount,
      lawyerManualAmount: amount,
    };
    const before = JSON.stringify(input);
    const result = calculateSettlement(input, SETTLEMENT_V1);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.customerSource).toBe('MANUAL');
    expect(result.lawyerSource).toBe('MANUAL');
    expect(result.customerAmount).toBe(expected);
    expect(result.lawyerAmount).toBe(expected);
  },
);
it.each([
  '0.00',
  '0.49',
  '0.50',
  '123.49',
  '123.50',
  '123.51',
  '9999999999999999.99',
])(
  'preserves V2 and default manual cents %s on both sides without changing inputs',
  (amount) => {
    const input = {
      closureAmount: '100.00',
      closureAmountState: 'KNOWN' as const,
      fallbackClaimAmount: null,
      customerFormula: null,
      lawyerMode: null,
      lawyerBaseFee: null,
      lawyerSplitPercent: null,
      customerManualAmount: amount,
      lawyerManualAmount: amount,
    };
    const before = JSON.stringify(input);
    for (const result of [
      calculateSettlement(input, SETTLEMENT_V2),
      calculateSettlement(input),
    ]) {
      expect(result).toMatchObject({
        customerAmount: amount,
        lawyerAmount: amount,
        customerSource: 'MANUAL',
        lawyerSource: 'MANUAL',
      });
      expect(JSON.stringify(input)).toBe(before);
    }
  },
);
it('uses guarded numeric whole-yuan rounding for both manual assessment sides', () => {
  expect(sql).toContain(
    'amount>=0 AND amount<10000000000000000 AND amount=round(amount,2)',
  );
  expect(sql).toContain('THEN round(amount,0) ELSE NULL');
  expect(sql).toContain(
    'a.customer_amount=archive_verified_manual_whole_yuan(t.customer_manual_amount)',
  );
  expect(sql).toContain(
    'a.lawyer_amount=archive_verified_manual_whole_yuan(t.lawyer_manual_amount)',
  );
});
it.each(['-0.01', '-0.50', '-123.50', '10000000000000000.00'])(
  'rejects unsupported calculator manual input %s',
  (amount) => {
    expect(() =>
      calculateSettlement({
        closureAmount: '100.00',
        closureAmountState: 'KNOWN',
        fallbackClaimAmount: null,
        customerFormula: null,
        lawyerMode: null,
        lawyerBaseFee: null,
        lawyerSplitPercent: null,
        customerManualAmount: amount,
      }),
    ).toThrow('INVALID_SETTLEMENT_MONEY');
  },
);
