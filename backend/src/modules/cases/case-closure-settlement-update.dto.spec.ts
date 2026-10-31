import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateClosureSettlementInput } from './case-closure-settlement-update.dto';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const base = {
  expectedVersion: 2,
  expectedClosureVersionId: id,
  idempotencyKey: 'update-1',
  closeAt: '2026-10-29',
  closeAmountState: 'KNOWN',
  closeAmt: '0',
  closeContentVersionIds: [],
  paymentType: 'ONE_TIME',
  paymentRecords: [],
};
const errors = (value: object) =>
  validateSync(plainToInstance(UpdateClosureSettlementInput, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
describe('closure settlement update contract only', () => {
  it('accepts independent KEEP/AUTOMATIC/MANUAL commands and exact manual cents including zero', () => {
    const settlement = {
      expectedAssessmentVersionId: null,
      expectedTermsVersion: null,
      declaration: 'APPLICABLE',
    };
    for (const customerAmount of [
      { mode: 'KEEP' },
      { mode: 'AUTOMATIC' },
      { mode: 'MANUAL', amount: '12.34' },
      { mode: 'MANUAL', amount: '0' },
    ])
      expect(
        errors({ ...base, settlement: { ...settlement, customerAmount } }),
      ).toEqual([]);
    for (const customerAmount of [
      null,
      { mode: 'MANUAL' },
      { mode: 'MANUAL', amount: '1.001' },
      { mode: 'MANUAL', amount: '-1' },
      { mode: 'MANUAL', amount: 1.23 },
      { mode: 'AUTOMATIC', amount: '1' },
      { mode: 'KEEP', amount: null },
      { mode: 'MANUAL', amount: '01' },
      { mode: 'MANUAL', amount: '10000000000000000' },
    ])
      expect(
        errors({ ...base, settlement: { ...settlement, customerAmount } })
          .length,
      ).toBeGreaterThan(0);
  });
  it('retains zero closure amount and permits omitted optional subcommands and reason', () => {
    expect(errors(base)).toEqual([]);
  });
  it('allows omitted/null reason but requires actual bounded text if provided', () => {
    expect(errors({ ...base, correctionReason: null })).toEqual([]);
    expect(errors({ ...base, correctionReason: '付款补录' })).toEqual([]);
    for (const correctionReason of ['', '   ', '\t\n', '字'.repeat(501)])
      expect(errors({ ...base, correctionReason }).length).toBeGreaterThan(0);
    expect(errors({ ...base, correctionReason: '字'.repeat(500) })).toEqual([]);
  });
  it('accepts exact attachments, a positive payment and explicit declarations', () => {
    expect(
      errors({
        ...base,
        closeContentVersionIds: [id],
        paymentRecords: [
          {
            paidOn: '2026-10-29',
            amount: '0.01',
            payer: '甲',
            payee: '乙',
            screenshotContentVersionId: id,
          },
        ],
        refund: {
          expectedVersionId: null,
          kind: 'DECLARE_NOT_APPLICABLE',
          items: [],
        },
        settlement: {
          declaration: 'NOT_APPLICABLE',
          expectedAssessmentVersionId: null,
          expectedTermsVersion: null,
        },
      }),
    ).toEqual([]);
  });
  it('rejects zero actual payment and invalid amount/state coupling', () => {
    expect(
      errors({
        ...base,
        paymentRecords: [
          {
            paidOn: '2026-10-29',
            amount: '0',
            payer: '甲',
            payee: '乙',
            screenshotContentVersionId: null,
          },
        ],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      errors({ ...base, closeAmountState: 'PENDING', closeAmt: '0' }).length,
    ).toBeGreaterThan(0);
  });
  it('rejects court cost conversion, duplicate inventory identity and unknown nested fields', () => {
    const item = {
      itemId: id,
      party: 'COURT',
      status: 'CONVERTED_TO_COST',
      description: '退费',
    };
    expect(
      errors({
        ...base,
        refund: { expectedVersionId: null, kind: 'RECORD', items: [item] },
      }).length,
    ).toBeGreaterThan(0);
    expect(
      errors({
        ...base,
        refund: {
          expectedVersionId: null,
          kind: 'RECORD',
          items: [
            { ...item, status: 'PENDING' },
            { ...item, itemId: id.toUpperCase(), status: 'PENDING' },
          ],
        },
      }).length,
    ).toBeGreaterThan(0);
    expect(
      errors({
        ...base,
        settlement: {
          declaration: 'UNKNOWN',
          expectedAssessmentVersionId: null,
          expectedTermsVersion: null,
          amount: '99',
        },
      }).length,
    ).toBeGreaterThan(0);
  });
  it('distinguishes omitted subcommands from invalid null and rejects confirming a nonexistent inventory', () => {
    expect(errors({ ...base, refund: null }).length).toBeGreaterThan(0);
    expect(errors({ ...base, settlement: null }).length).toBeGreaterThan(0);
    expect(
      errors({
        ...base,
        refund: { expectedVersionId: null, kind: 'CONFIRM_COMPLETE' },
      }).length,
    ).toBeGreaterThan(0);
  });
  it('accepts unknown closure amount and rejects missing top-level optimistic versions', () => {
    expect(
      errors({ ...base, closeAmountState: 'PENDING', closeAmt: null }),
    ).toEqual([]);
    for (const key of ['expectedVersion', 'expectedClosureVersionId'])
      expect(
        errors(
          Object.fromEntries(
            Object.entries(base).filter(([name]) => name !== key),
          ),
        ).length,
      ).toBeGreaterThan(0);
    expect(
      errors({ ...base, closeContentVersionIds: [id, id.toUpperCase()] })
        .length,
    ).toBeGreaterThan(0);
  });
  it('requires hidden assessment and terms preconditions with nullable initial values', () => {
    const settlement = {
      declaration: 'UNKNOWN',
      expectedAssessmentVersionId: id,
      expectedTermsVersion: 1,
    };
    expect(errors({ ...base, settlement })).toEqual([]);
    expect(
      errors({
        ...base,
        settlement: {
          ...settlement,
          expectedAssessmentVersionId: null,
          expectedTermsVersion: null,
        },
      }),
    ).toEqual([]);
    for (const key of ['expectedAssessmentVersionId', 'expectedTermsVersion'])
      expect(
        errors({
          ...base,
          settlement: Object.fromEntries(
            Object.entries(settlement).filter(([name]) => name !== key),
          ),
        }).length,
      ).toBeGreaterThan(0);
    for (const value of [0, -1, 1.5, '1', 2147483648])
      expect(
        errors({
          ...base,
          settlement: { ...settlement, expectedTermsVersion: value },
        }).length,
      ).toBeGreaterThan(0);
    expect(
      errors({
        ...base,
        settlement: { ...settlement, expectedAssessmentVersionId: 'bad-uuid' },
      }).length,
    ).toBeGreaterThan(0);
  });
  it('accepts confirmation only against a prior inventory and rejects supplied replacement items', () => {
    expect(
      errors({
        ...base,
        refund: { expectedVersionId: id, kind: 'CONFIRM_COMPLETE' },
      }),
    ).toEqual([]);
    expect(
      errors({
        ...base,
        refund: { expectedVersionId: id, kind: 'CONFIRM_COMPLETE', items: [] },
      }).length,
    ).toBeGreaterThan(0);
  });
});

it('allows explicit unknown and cent-precise nonnegative refund amounts without new declaration states', () => {
  for (const amount of [undefined, null, '0', '0.00', '12.34'])
    expect(
      errors({
        ...base,
        refund: {
          kind: 'RECORD',
          expectedVersionId: null,
          items: [
            {
              itemId: id,
              party: 'COURT',
              status: 'PENDING',
              description: '退费',
              ...(amount === undefined ? {} : { amount }),
            },
          ],
        },
      }),
    ).toEqual([]);
  for (const amount of ['', '-0.01', '1.001', '01', 1])
    expect(
      errors({
        ...base,
        refund: {
          kind: 'RECORD',
          expectedVersionId: null,
          items: [
            {
              itemId: id,
              party: 'COURT',
              status: 'PENDING',
              description: '退费',
              amount,
            },
          ],
        },
      }).length,
    ).toBeGreaterThan(0);
});

it('explicit zero does not authorize court cost conversion and incomplete inventories stay explicit commands', () => {
  expect(
    errors({
      ...base,
      refund: {
        kind: 'RECORD',
        expectedVersionId: null,
        items: [
          {
            itemId: id,
            party: 'COURT',
            status: 'CONVERTED_TO_COST',
            description: '法院退费',
            amount: '0',
          },
        ],
      },
    }).length,
  ).toBeGreaterThan(0);
});
