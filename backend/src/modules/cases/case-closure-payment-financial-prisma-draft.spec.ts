import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Prisma } from '../../generated/prisma/client';
import { SETTLEMENT_V1, SETTLEMENT_V2 } from '../settlements';
import {
  allocatedSettlementState,
  reviewPaymentSettlementAssessment,
  reviewPaymentSettlementAssessmentItems,
  reviewPaymentRefundItems,
  readPaymentFinancialReview,
  lockPaymentCaseScope,
} from './case-closure-payment-financial-prisma-draft';
const source = readFileSync(
  resolve(
    process.cwd(),
    'src/modules/cases/case-closure-payment-financial-prisma-draft.ts',
  ),
  'utf8',
);
const inputs = {
  closureAmount: '100.00',
  closureAmountState: 'KNOWN' as const,
  fallbackClaimAmount: null,
  customerFormula: null,
  lawyerMode: null,
  lawyerBaseFee: null,
  lawyerSplitPercent: null,
  customerManualAmount: '100.00',
  lawyerManualAmount: '100.00',
};
const assessment = {
  id: 'assessment',
  declaration: 'APPLICABLE' as const,
  closure_version_id: 'closure',
  terms_version: 1,
  calculation_rule_version: 'settlement-calculation-v1-whole-yuan-half-up',
  calculation_inputs: inputs,
  customer_amount: '100.00',
  lawyer_amount: '100.00',
  customer_source: 'MANUAL',
  lawyer_source: 'MANUAL',
};
const base = {
  assessment,
  closureVersionId: 'closure',
  termsVersion: 1,
  currentInputs: inputs,
};

describe('verified consolidation scope for payment aggregate review', () => {
  const actor = {
    userId: 'owner',
    departmentId: 'dept',
    authorizationRevision: 1,
  };
  function fixture() {
    const state = {
      sourceDepartment: 'dept',
      mainOwner: 'owner',
      head: 'group',
      sourceExists: true,
      isMain: true,
      drift: false,
    };
    let discoveries = 0;
    const db = {
      $queryRaw: jest.fn(async (sql: TemplateStringsArray) => {
        const query = sql.join('');
        if (query.includes('SELECT consolidation_id,is_main')) {
          discoveries++;
          return [{ consolidation_id: 'group', is_main: state.isMain }];
        }
        if (query.includes('FROM case_consolidations'))
          return !state.isMain
            ? []
            : [{ id: state.drift && discoveries > 1 ? 'other' : state.head }];
        if (query.includes('FROM case_consolidation_members'))
          return [
            { case_id: 'main', department_id: 'dept', is_main: true },
            {
              case_id: 'source',
              department_id: state.sourceDepartment,
              is_main: false,
            },
          ];
        if (query.includes('FROM cases'))
          return [
            { id: 'main', responsible_user_id: state.mainOwner },
            ...(state.sourceExists && state.isMain
              ? [{ id: 'source', responsible_user_id: 'different-owner' }]
              : []),
          ];
        throw new Error('UNEXPECTED_SQL');
      }),
    };
    return {
      state,
      db,
      run: () =>
        lockPaymentCaseScope(
          db as unknown as Prisma.TransactionClient,
          actor,
          'main',
        ),
    };
  }
  it('counts the complete same-department group even when the source has a different owner, locking before rediscovery', async () => {
    const f = fixture();
    await expect(f.run()).resolves.toEqual(['main', 'source']);
    const queries = f.db.$queryRaw.mock.calls.map(([sql]) => sql.join(''));
    expect(queries[3]).toContain('ORDER BY id FOR UPDATE');
    expect(queries[4]).toContain('SELECT consolidation_id,is_main');
  });
  it('preserves source-case correction as an independent scope, without aggregating the group', async () => {
    const f = fixture();
    f.state.isMain = false;
    await expect(f.run()).resolves.toEqual(['main']);
  });
  it.each(['department', 'owner', 'missing', 'head', 'drift'])(
    'rejects invalid %s before returning an aggregate scope',
    async (kind) => {
      const f = fixture();
      if (kind === 'department') f.state.sourceDepartment = 'foreign';
      if (kind === 'owner') f.state.mainOwner = 'other';
      if (kind === 'missing') f.state.sourceExists = false;
      if (kind === 'head') f.state.head = 'other';
      if (kind === 'drift') f.state.drift = true;
      await expect(f.run()).rejects.toThrow();
    },
  );
});
describe('financial source draft computation and static query boundaries', () => {
  it.each([
    [SETTLEMENT_V1, '12.00'],
    [SETTLEMENT_V2, '12.34'],
  ] as const)(
    'verifies manual cents using the stored %s rule without rewriting history',
    (rule, amount) => {
      const manualInputs = {
        ...inputs,
        customerManualAmount: '12.34',
        lawyerManualAmount: '12.34',
      };
      const snapshot = {
        ...assessment,
        calculation_rule_version: rule,
        calculation_inputs: manualInputs,
        customer_amount: amount,
        lawyer_amount: amount,
      };
      const before = JSON.stringify(snapshot);
      const request = {
        ...base,
        currentInputs: manualInputs,
        assessment: snapshot,
        allocations: [
          { id: 'a', side: 'CUSTOMER' as const, amount },
          { id: 'b', side: 'LAWYER' as const, amount },
        ],
      };
      expect(reviewPaymentSettlementAssessment(request)).toBe('PASSED');
      expect(JSON.stringify(snapshot)).toBe(before);
      expect(
        reviewPaymentSettlementAssessment({
          ...request,
          assessment: {
            ...snapshot,
            customer_amount: amount === '12.00' ? '12.34' : '12.00',
          },
        }),
      ).toBe('UNKNOWN');
    },
  );
  it.each([SETTLEMENT_V1, SETTLEMENT_V2])(
    'retains whole-yuan automatic calculation for %s',
    (rule) => {
      const automaticInputs = {
        ...inputs,
        closureAmount: '123.40',
        customerFormula: '结案金额 × 10%',
        lawyerMode: 'FULL_RISK' as const,
        lawyerBaseFee: '0.00',
        lawyerSplitPercent: '10',
        customerManualAmount: null,
        lawyerManualAmount: null,
      };
      expect(
        reviewPaymentSettlementAssessment({
          ...base,
          currentInputs: automaticInputs,
          assessment: {
            ...assessment,
            calculation_rule_version: rule,
            calculation_inputs: automaticInputs,
            customer_amount: '12.00',
            lawyer_amount: '12.00',
            customer_source: 'AUTOMATIC',
            lawyer_source: 'AUTOMATIC',
          },
          allocations: [
            { id: 'a', side: 'CUSTOMER', amount: '12.00' },
            { id: 'b', side: 'LAWYER', amount: '12.00' },
          ],
        }),
      ).toBe('PASSED');
    },
  );
  it.each(['', 'unknown'])(
    'fails closed on missing or unknown rule %s even for non-applicability',
    (rule) => {
      expect(
        reviewPaymentSettlementAssessmentItems({
          ...base,
          assessment: {
            ...assessment,
            calculation_rule_version: rule,
            declaration: 'NOT_APPLICABLE',
            customer_amount: null,
            lawyer_amount: null,
          },
          allocations: [],
        }).customer,
      ).toEqual({ state: 'UNKNOWN', reason: 'ASSESSMENT_RULE_UNSUPPORTED' });
    },
  );
  it('fails closed when a malformed snapshot omits its rule field', () => {
    const malformed = { ...assessment };
    Reflect.deleteProperty(malformed, 'calculation_rule_version');
    expect(
      reviewPaymentSettlementAssessmentItems({
        ...base,
        assessment: malformed,
        allocations: [],
      }).customer,
    ).toEqual({ state: 'UNKNOWN', reason: 'ASSESSMENT_RULE_UNSUPPORTED' });
  });
  it('deduplicates allocation IDs while counting independent allocations', () => {
    const customer = { id: 'a', side: 'CUSTOMER' as const, amount: '50.00' };
    expect(
      reviewPaymentSettlementAssessment({
        ...base,
        allocations: [
          customer,
          customer,
          { id: 'b', side: 'LAWYER', amount: '100.00' },
        ],
      }),
    ).toBe('BLOCKED');
    expect(
      reviewPaymentSettlementAssessment({
        ...base,
        allocations: [
          customer,
          { ...customer, id: 'c' },
          { id: 'b', side: 'LAWYER', amount: '100.00' },
        ],
      }),
    ).toBe('PASSED');
  });
  it('returns unknown for stale or unverified assessments', () => {
    for (const changed of [
      { terms_version: 2 },
      { closure_version_id: 'old' },
      { customer_amount: '200.00' },
      { calculation_rule_version: 'unknown' },
    ])
      expect(
        reviewPaymentSettlementAssessment({
          ...base,
          assessment: { ...assessment, ...changed },
          allocations: [],
        }),
      ).toBe('UNKNOWN');
    expect(
      reviewPaymentSettlementAssessment({
        ...base,
        assessment: null,
        allocations: [],
      }),
    ).toBe('UNKNOWN');
  });
  it('requires explicit non-applicability with matching current sources', () => {
    const excluded = {
      ...assessment,
      declaration: 'NOT_APPLICABLE' as const,
      customer_amount: null,
      lawyer_amount: null,
    };
    expect(
      reviewPaymentSettlementAssessment({
        ...base,
        assessment: excluded,
        allocations: [],
      }),
    ).toBe('PASSED');
    expect(
      reviewPaymentSettlementAssessment({
        ...base,
        assessment: { ...excluded, terms_version: 2 },
        allocations: [],
      }),
    ).toBe('UNKNOWN');
  });
  it('discovers before sorted locks, rechecks scope and hides unauthorized sources', () => {
    expect(source.indexOf('const ids = await discover()')).toBeLessThan(
      source.indexOf('ORDER BY id FOR UPDATE'),
    );
    expect(source).toContain('JSON.stringify(await discover())');
    expect(source).not.toContain(
      'locked.some(r => r.responsible_user_id !== actor.userId)',
    );
    expect(source).not.toContain('f.amount');
  });
  it('reads latest inventories and allocations in the supplied transaction', () => {
    expect(source).toContain('ORDER BY revision DESC LIMIT 1');
    expect(source).toContain('reviewRefundInventoryDraft');
    expect(source).toContain('a.case_id=ANY(${caseIds}::uuid[])');
    expect(source).not.toContain('$transaction');
  });
});

describe('individual financial decisions', () => {
  it.each(['CUSTOMER', 'LAWYER'] as const)(
    'reports an independent %s shortfall without hiding the passed side',
    (side) => {
      const result = reviewPaymentSettlementAssessmentItems({
        ...base,
        allocations: [
          {
            id: 'a',
            side: 'CUSTOMER',
            amount: side === 'CUSTOMER' ? '99.99' : '100.00',
          },
          {
            id: 'b',
            side: 'LAWYER',
            amount: side === 'LAWYER' ? '99.99' : '100.00',
          },
        ],
      });
      expect(result.customer.state).toBe(
        side === 'CUSTOMER' ? 'BLOCKED' : 'PASSED',
      );
      expect(result.lawyer.state).toBe(
        side === 'LAWYER' ? 'BLOCKED' : 'PASSED',
      );
      expect(
        (side === 'CUSTOMER' ? result.customer : result.lawyer).reason,
      ).toContain('INSUFFICIENT');
    },
  );
  it('reports refund blockers, missing completeness and explicit exclusion separately', () => {
    const refund = {
      id: 'r',
      caseId: 'case',
      departmentId: 'dept',
      revision: 1,
      declaration: 'COMPLETE' as const,
      items: [
        {
          itemId: 'i',
          party: 'DEFENDANT' as const,
          status: 'SETTLED' as const,
          amount: '800.00',
          description: 'refund',
        },
      ],
    };
    expect(reviewPaymentRefundItems(refund)).toMatchObject({
      state: 'BLOCKED',
      reason: 'REFUND_ITEMS_NOT_RECEIVED_OR_COSTED',
    });
    expect(reviewPaymentRefundItems(null)).toMatchObject({
      state: 'UNKNOWN',
      reason: 'REFUND_INVENTORY_MISSING',
    });
    expect(
      reviewPaymentRefundItems({
        ...refund,
        declaration: 'NOT_APPLICABLE',
        items: [],
      }),
    ).toMatchObject({
      state: 'PASSED',
      reason: 'REFUND_EXPLICITLY_NOT_APPLICABLE',
    });
  });
  it('explains stale sources and preserves explicit exclusion without calculating legacy terms', () => {
    expect(
      reviewPaymentSettlementAssessmentItems({
        ...base,
        assessment: { ...assessment, terms_version: 2 },
        allocations: [],
      }).customer,
    ).toMatchObject({ state: 'UNKNOWN', reason: 'ASSESSMENT_SOURCE_STALE' });
    const legacy = { ...inputs, customerFormula: 'old invalid formula' };
    const result = reviewPaymentSettlementAssessmentItems({
      ...base,
      currentInputs: legacy,
      assessment: {
        ...assessment,
        calculation_inputs: legacy,
        declaration: 'NOT_APPLICABLE',
        customer_amount: null,
        lawyer_amount: null,
      },
      allocations: [],
    });
    expect(result.customer).toMatchObject({
      state: 'PASSED',
      reason: 'SETTLEMENT_EXPLICITLY_NOT_APPLICABLE',
    });
  });
  it('accepts explicitly zero required amount while conflicting allocation identities remain unresolved', () => {
    expect(allocatedSettlementState('0.00', [])).toBe('REACHED');
    expect(
      reviewPaymentSettlementAssessmentItems({
        ...base,
        allocations: [
          { id: 'same', side: 'CUSTOMER', amount: '100.00' },
          { id: 'same', side: 'LAWYER', amount: '100.00' },
        ],
      }).customer,
    ).toMatchObject({ state: 'UNKNOWN', reason: 'ALLOCATION_ID_CONFLICT' });
  });
  it('returns no source identifiers or amounts when source scope is unauthorized', async () => {
    const tx = { $queryRaw: jest.fn() };
    const result = await readPaymentFinancialReview(
      tx as unknown as Prisma.TransactionClient,
      { userId: 'actor', departmentId: 'dept', authorizationRevision: 1 },
      'case',
      null,
    );
    expect(result).toEqual({
      state: 'UNKNOWN',
      refund: { state: 'UNKNOWN', reason: 'SOURCE_SCOPE_UNAUTHORIZED' },
      customer: { state: 'UNKNOWN', reason: 'SOURCE_SCOPE_UNAUTHORIZED' },
      lawyer: { state: 'UNKNOWN', reason: 'SOURCE_SCOPE_UNAUTHORIZED' },
    });
    expect(Object.hasOwn(result, 'sources')).toBe(false);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it.each([
    ['0.00', 'KNOWN', 'EXEMPT'],
    [null, 'PENDING', 'UNKNOWN'],
  ] as const)(
    'exempts only explicit zero: %s/%s',
    async (amount, state, expected) => {
      const tx = {
        $queryRaw: jest.fn(async (strings: TemplateStringsArray) =>
          strings.join('').includes('jsonb_build_object')
            ? [
                {
                  id: 'closure',
                  terms_version: null,
                  inputs: {
                    ...inputs,
                    closureAmount: amount,
                    closureAmountState: state,
                  },
                },
              ]
            : [],
        ),
      };
      const result = await readPaymentFinancialReview(
        tx as unknown as Prisma.TransactionClient,
        { userId: 'actor', departmentId: 'dept', authorizationRevision: 1 },
        'case',
        ['case'],
      );
      expect(result.customer.state).toBe(expected);
      expect(result.refund.state).toBe('UNKNOWN');
      expect(result.state).toBe('UNKNOWN');
      expect(result.lawyer.state).toBe(expected);
    },
  );
});

it('preserves numeric(30,2) allocation cents and permits sums larger than one fact', () => {
  const maximum = '9999999999999999999999999999.99';
  expect(allocatedSettlementState(maximum, [maximum])).toBe('REACHED');
  expect(
    allocatedSettlementState(maximum, ['9999999999999999999999999999.98']),
  ).toBe('INSUFFICIENT');
  expect(allocatedSettlementState(maximum, [maximum, maximum])).toBe('REACHED');
  expect(allocatedSettlementState('100.00', [maximum])).toBe('REACHED');
  expect(() =>
    allocatedSettlementState('1.00', ['10000000000000000000000000000.00']),
  ).toThrow('INVALID_ALLOCATION_AMOUNT');
});

it('verifies single-side and double-side explicit zero without adding actual allocations, but still requires positive cents', () => {
  const currentInputs = {
      ...inputs,
      customerManualAmount: '0.00',
      lawyerManualAmount: '12.34',
    },
    a = {
      ...assessment,
      calculation_rule_version: SETTLEMENT_V2,
      calculation_inputs: currentInputs,
      customer_amount: '0.00',
      lawyer_amount: '12.34',
    };
  const review = (amount: string) =>
    reviewPaymentSettlementAssessmentItems({
      ...base,
      currentInputs,
      assessment: a,
      allocations: [{ id: 'lawyer-real', side: 'LAWYER', amount }],
    });
  expect(review('12.33')).toMatchObject({
    customer: { state: 'PASSED', reason: 'CUSTOMER_REQUIRED_AMOUNT_ZERO' },
    lawyer: { state: 'BLOCKED' },
  });
  expect(review('12.34')).toMatchObject({
    customer: { state: 'PASSED' },
    lawyer: { state: 'PASSED' },
  });
  const both = { ...currentInputs, lawyerManualAmount: '0.00' };
  expect(
    reviewPaymentSettlementAssessmentItems({
      ...base,
      currentInputs: both,
      assessment: { ...a, calculation_inputs: both, lawyer_amount: '0.00' },
      allocations: [],
    }),
  ).toMatchObject({
    customer: { state: 'PASSED', reason: 'CUSTOMER_REQUIRED_AMOUNT_ZERO' },
    lawyer: { state: 'PASSED', reason: 'LAWYER_REQUIRED_AMOUNT_ZERO' },
  });
});
