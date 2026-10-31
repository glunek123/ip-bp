import { checkArchiveFinancialStatuses } from './case-archive-financial-check';

describe('archive financial statuses', () => {
  it('does not consider settled client money as received by the company', () => {
    expect(
      checkArchiveFinancialStatuses({
        refunds: [{ party: 'COURT', status: 'RECEIVED', amount: '800.00' }],
        customer: 'SETTLED',
        lawyer: 'INVOICED',
      }),
    ).toEqual({ refund: 'PASSED', customer: 'BLOCKED', lawyer: 'PASSED' });
  });

  it('accepts cost conversion only for the defendant', () => {
    expect(
      checkArchiveFinancialStatuses({
        refunds: [
          { party: 'DEFENDANT', status: 'CONVERTED_TO_COST', amount: '800.00' },
        ],
        customer: 'RECEIVED',
        lawyer: 'INVOICED',
      }),
    ).toEqual({ refund: 'PASSED', customer: 'PASSED', lawyer: 'PASSED' });
    expect(
      checkArchiveFinancialStatuses({
        refunds: [
          { party: 'COURT', status: 'CONVERTED_TO_COST', amount: '800.00' },
        ],
        customer: 'RECEIVED',
        lawyer: 'INVOICED',
      }).refund,
    ).toBe('BLOCKED');
  });

  it('checks every refund, not only the first', () => {
    expect(
      checkArchiveFinancialStatuses({
        refunds: [
          { party: 'COURT', status: 'RECEIVED', amount: '800.00' },
          { party: 'DEFENDANT', status: 'PENDING', amount: '800.00' },
        ],
        customer: 'RECEIVED',
        lawyer: 'INVOICED',
      }).refund,
    ).toBe('BLOCKED');
  });

  it('keeps absent records unresolved rather than assuming zero or completion', () => {
    expect(
      checkArchiveFinancialStatuses({
        refunds: [],
        customer: null,
        lawyer: null,
      }),
    ).toEqual({ refund: 'UNKNOWN', customer: 'UNKNOWN', lawyer: 'UNKNOWN' });
    expect(
      checkArchiveFinancialStatuses({
        refunds: [{ party: 'COURT', status: null, amount: '800.00' }],
        customer: null,
        lawyer: null,
      }).refund,
    ).toBe('UNKNOWN');
  });

  it('accepts explicitly marked non-applicable categories without treating missing data as such', () => {
    expect(
      checkArchiveFinancialStatuses({
        refunds: [],
        refundNotApplicable: true,
        customer: null,
        lawyer: null,
        settlementNotApplicable: true,
      }),
    ).toEqual({ refund: 'PASSED', customer: 'PASSED', lawyer: 'PASSED' });
  });

  it('does not ignore existing pending records when marked non-applicable', () => {
    expect(
      checkArchiveFinancialStatuses({
        refunds: [{ party: 'COURT', status: 'PENDING', amount: '800.00' }],
        refundNotApplicable: true,
        customer: 'SETTLED',
        lawyer: null,
        settlementNotApplicable: true,
      }),
    ).toEqual({ refund: 'BLOCKED', customer: 'BLOCKED', lawyer: 'UNKNOWN' });
  });
});

it('zero refund passes without receipt, positive cents and unknown amount remain distinct', () => {
  const base = { customer: 'RECEIVED' as const, lawyer: 'INVOICED' as const };
  expect(
    checkArchiveFinancialStatuses({
      ...base,
      refunds: [{ party: 'COURT', status: 'PENDING', amount: '0.00' }],
    }).refund,
  ).toBe('PASSED');
  expect(
    checkArchiveFinancialStatuses({
      ...base,
      refunds: [{ party: 'COURT', status: 'RECEIVED', amount: null }],
    }).refund,
  ).toBe('UNKNOWN');
  expect(
    checkArchiveFinancialStatuses({
      ...base,
      refunds: [{ party: 'COURT', status: 'PENDING', amount: '0.01' }],
    }).refund,
  ).toBe('BLOCKED');
});
