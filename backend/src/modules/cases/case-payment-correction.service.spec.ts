import { CasePaymentCorrectionService } from './case-payment-correction.service';
import { CaseClosurePaymentPrismaDraft } from './case-closure-payment-prisma-draft';
import { HttpException } from '@nestjs/common';
const id = '5b115994-82cd-48d0-832a-098c5c697fcb';
const actor = { userId: id, departmentId: id, authorizationRevision: 1 };
const input = {
  kind: 'VOID' as const,
  paymentId: id,
  expectedVersionId: id,
  idempotencyKey: 'key',
};
it('rejects a future business date before any database call', async () => {
  const execute = jest.fn();
  const service = new CasePaymentCorrectionService({
    execute,
  } as unknown as CaseClosurePaymentPrismaDraft);
  await expect(
    service.correct(actor, id, {
      ...input,
      kind: 'CORRECT',
      paidOn: '9999-01-01',
      amount: '1.01',
      payer: '甲',
      payee: '乙',
    }),
  ).rejects.toMatchObject({ status: 400 });
  expect(execute).not.toHaveBeenCalled();
});
it('passes only a validated exact command to the real adapter', async () => {
  const execute = jest
    .fn()
    .mockResolvedValue({ stage: 'ARCHIVED', reviewRequired: true });
  const service = new CasePaymentCorrectionService({
    execute,
  } as unknown as CaseClosurePaymentPrismaDraft);
  await expect(service.correct(actor, id, input)).resolves.toEqual({
    stage: 'ARCHIVED',
    reviewRequired: true,
  });
  expect(execute).toHaveBeenCalledWith(actor, {
    ...input,
    caseId: id,
    reason: undefined,
  });
  await expect(
    service.correct(actor, id, { ...input, authorized: true } as typeof input),
  ).rejects.toMatchObject({ status: 400 });
  expect(execute).toHaveBeenCalledTimes(1);
});
it.each([
  ['ACTION_FORBIDDEN', 403],
  ['PAYMENT_CHANGED', 409],
  ['IDEMPOTENCY_CONFLICT', 409],
  ['INVALID_STAGE', 409],
  ['INVALID_PAYMENT_DATE', 400],
])('maps %s to actual HTTP %s', async (code, status) => {
  const execute = jest.fn().mockRejectedValue(new Error(code));
  try {
    await new CasePaymentCorrectionService({
      execute,
    } as unknown as CaseClosurePaymentPrismaDraft).correct(actor, id, input);
    throw Error('expected rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    expect((error as HttpException).getResponse()).toEqual({ code });
  }
});
it('preserves unexpected database errors rather than calling them business conflicts', async () => {
  const error = {
    code: 'P2010',
    meta: { driverAdapterError: { cause: { originalCode: '23514' } } },
  };
  const execute = jest.fn().mockRejectedValue(error);
  await expect(
    new CasePaymentCorrectionService({
      execute,
    } as unknown as CaseClosurePaymentPrismaDraft).correct(actor, id, input),
  ).rejects.toBe(error);
});
