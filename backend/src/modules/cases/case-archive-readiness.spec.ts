import { previewCaseArchiveReadiness } from './case-archive-readiness';

const complete = {
  refunds: [
    { party: 'DEFENDANT', status: 'CONVERTED_TO_COST', amount: '800.00' },
  ],
  customer: 'RECEIVED',
  lawyer: 'INVOICED',
} as const;

describe('archive readiness preview', () => {
  it('zero closure exempts payment/settlement only after explicit refund declaration', () => {
    expect(
      previewCaseArchiveReadiness({
        closureAmount: '0',
        validPayments: [],
        financial: {
          refunds: [],
          customer: null,
          lawyer: null,
          refundNotApplicable: true,
        },
      }),
    ).toMatchObject({
      canArchive: true,
      refund: 'PASSED',
      customer: 'EXEMPT',
      lawyer: 'EXEMPT',
    });
  });

  it('does not treat an unknown amount or incomplete installments as settled', () => {
    for (const [closureAmount, validPayments] of [
      [null, ['100']],
      ['100', ['30', '69.99']],
    ] as const) {
      expect(
        previewCaseArchiveReadiness({
          closureAmount,
          validPayments,
          financial: complete,
        }).canArchive,
      ).toBe(false);
    }
  });

  it('requires every applicable financial condition after payment is complete', () => {
    expect(
      previewCaseArchiveReadiness({
        closureAmount: '100',
        validPayments: ['30', '70'],
        financial: { ...complete, customer: 'SETTLED' },
      }),
    ).toMatchObject({ canArchive: false, customer: 'BLOCKED' });
    expect(
      previewCaseArchiveReadiness({
        closureAmount: '100',
        validPayments: ['30', '70'],
        financial: complete,
      }).canArchive,
    ).toBe(true);
  });
});

it('zero closure never exempts an unknown or still-pending positive refund', () => {
  for (const financial of [
    { refunds: [], customer: null, lawyer: null },
    {
      refunds: [
        { party: 'COURT' as const, status: 'PENDING' as const, amount: '0.01' },
      ],
      customer: null,
      lawyer: null,
    },
  ])
    expect(
      previewCaseArchiveReadiness({
        closureAmount: '0.00',
        validPayments: [],
        financial,
      }).canArchive,
    ).toBe(false);
});
