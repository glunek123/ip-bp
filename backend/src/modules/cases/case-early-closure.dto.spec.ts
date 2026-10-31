import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  isEarlyClosureSourceStage,
  RecordEarlyClosureInput,
} from './case-early-closure.dto';

const documentId = '11111111-1111-4111-8111-111111111111';
const screenshotId = '22222222-2222-4222-8222-222222222222';
const base = {
  expectedVersion: 1,
  expectedStage: 'PENDING_MATCH',
  idempotencyKey: 'close-1',
  closeAt: '2026-10-29',
  closeAmountState: 'KNOWN',
  closeAmt: '100.00',
  closeContentVersionIds: [documentId],
  paymentType: 'INSTALLMENTS',
  paymentRecords: [],
};
const errors = (value: object) =>
  validateSync(plainToInstance(RecordEarlyClosureInput, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });

describe('early closure protocol', () => {
  it('accepts a pending-match closure with no payment', () => {
    expect(errors(base)).toEqual([]);
    expect(isEarlyClosureSourceStage('PENDING_MATCH')).toBe(true);
    expect(isEarlyClosureSourceStage('WAITING_ARCHIVE')).toBe(false);
    expect(isEarlyClosureSourceStage('ARCHIVED')).toBe(false);
  });

  it('requires amount state, date, document list and payment type', () => {
    for (const key of [
      'closeAmountState',
      'closeAmt',
      'closeAt',
      'closeContentVersionIds',
      'paymentType',
    ]) {
      expect(
        errors(
          Object.fromEntries(
            Object.entries(base).filter(([name]) => name !== key),
          ),
        ).length,
      ).toBeGreaterThan(0);
    }
    expect(errors({ ...base, closeContentVersionIds: [] })).toEqual([]);
    expect(errors({ ...base, closeAmt: 'unknown' }).length).toBeGreaterThan(0);
    expect(
      errors({ ...base, closeAmountState: 'PENDING', closeAmt: null }),
    ).toEqual([]);
    expect(
      errors({ ...base, closeAmountState: 'PENDING', closeAmt: '0.00' }).length,
    ).toBeGreaterThan(0);
    expect(
      errors({ ...base, closeAmountState: 'KNOWN', closeAmt: null }).length,
    ).toBeGreaterThan(0);
  });

  it.each(['0', '0.0', '0.00', '00000000000000.00'])(
    'rejects zero actual payment %s while allowing zero closure amount',
    (amount) => {
      expect(errors({ ...base, closeAmt: '0.00' })).toEqual([]);
      expect(
        errors({
          ...base,
          paymentRecords: [
            {
              paidOn: '2026-10-29',
              amount,
              payer: '甲',
              payee: '乙',
              screenshotContentVersionId: null,
            },
          ],
        }).length,
      ).toBeGreaterThan(0);
    },
  );
  it.each(['0.01', '99999999999999.99'])(
    'accepts positive actual payment %s',
    (amount) => {
      expect(
        errors({
          ...base,
          paymentRecords: [
            {
              paidOn: '2026-10-29',
              amount,
              payer: '甲',
              payee: '乙',
              screenshotContentVersionId: null,
            },
          ],
        }),
      ).toEqual([]);
    },
  );

  it('accepts a missing screenshot and validates a supplied version', () => {
    const payment = {
      paidOn: '2026-10-29',
      amount: '50.00',
      payer: '付款人',
      payee: '收款人',
      screenshotContentVersionId: screenshotId,
    };
    expect(errors({ ...base, paymentRecords: [payment] })).toEqual([]);
    expect(
      errors({
        ...base,
        paymentRecords: [{ ...payment, screenshotContentVersionId: null }],
      }),
    ).toEqual([]);
    expect(
      errors({
        ...base,
        paymentRecords: [
          { ...payment, screenshotContentVersionId: documentId.slice(0, -1) },
        ],
      }).length,
    ).toBeGreaterThan(0);
    expect(
      errors({ ...base, paymentRecords: [{ ...payment, amount: '-1' }] })
        .length,
    ).toBeGreaterThan(0);
  });

  it('allows at most one payment for one-time payment and rejects invalid dates', () => {
    const payment = {
      paidOn: '2026-10-29',
      amount: '50.00',
      payer: '付款人',
      payee: '收款人',
      screenshotContentVersionId: null,
    };
    expect(
      errors({ ...base, paymentType: 'ONE_TIME', paymentRecords: [payment] }),
    ).toEqual([]);
    expect(
      errors({
        ...base,
        paymentType: 'ONE_TIME',
        paymentRecords: [payment, payment],
      }).length,
    ).toBeGreaterThan(0);
    expect(errors({ ...base, closeAt: '2026-02-30' }).length).toBeGreaterThan(
      0,
    );
  });
});
