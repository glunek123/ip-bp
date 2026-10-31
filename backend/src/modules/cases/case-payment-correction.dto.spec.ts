import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CorrectCasePaymentInput } from './case-payment-correction.dto';
const base = {
  paymentId: '5b115994-82cd-48d0-832a-098c5c697fcb',
  expectedVersionId: '5b115994-82cd-48d0-832a-098c5c697fcb',
  idempotencyKey: 'payment-correct-1',
};
const check = (value: unknown) =>
  validateSync(plainToInstance(CorrectCasePaymentInput, value), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
it('accepts exact CORRECT cents and optional reason or exact VOID', () => {
  expect(
    check({
      ...base,
      kind: 'CORRECT',
      paidOn: '2026-10-31',
      amount: '12.34',
      payer: '付款人',
      payee: '收款人',
    }),
  ).toEqual([]);
  expect(check({ ...base, kind: 'VOID', reason: null })).toEqual([]);
});
it.each([
  { kind: 'VOID', amount: '1.00' },
  { kind: 'VOID', paidOn: null },
  { kind: 'VOID', authorized: true },
  {
    kind: 'CORRECT',
    paidOn: '2026-02-30',
    amount: '1.001',
    payer: ' ',
    payee: 'ok',
  },
  { kind: 'CORRECT', paidOn: '2026-10-31', amount: 1, payer: 'x', payee: 'y' },
  { kind: 'CORRECT' },
  { kind: 'VOID', reason: 42 },
])('rejects invalid/extra input %j', (fields) => {
  expect(check({ ...base, ...fields }).length).toBeGreaterThan(0);
});
