import {
  CaseClosurePaymentCorrectionDraftService,
  type ClosurePaymentCorrectionTransaction,
  type ClosurePaymentFact,
  type PaymentReviewInput,
  validatePaymentFinancialItems,
} from './case-closure-payment-correction-draft.service';
const actor = {
  userId: 'operator',
  departmentId: 'department',
  authorizationRevision: 1,
};
const command = {
  caseId: 'case',
  paymentId: 'payment',
  expectedVersionId: 'v1',
  idempotencyKey: 'key',
  kind: 'VOID' as const,
};
function setup(
  stage: 'ARCHIVED' | 'WAITING_ARCHIVE' = 'ARCHIVED',
  closureAmount: string | null = '100.00',
  financialReadiness: PaymentReviewInput['financialReadiness'] = 'PASSED',
  financialItems?: PaymentReviewInput['financialItems'],
) {
  const versions: ClosurePaymentFact[] = [
    {
      id: 'v1',
      paymentId: 'payment',
      revision: 1,
      state: 'ACTIVE',
      paidOn: '2026-10-01',
      amount: '100.00',
      payer: '被告',
      payee: '客户',
    },
  ];
  const effective = () => {
    const latest = versions[versions.length - 1];
    return latest.state === 'ACTIVE' ? [latest] : [];
  };
  const review = (): PaymentReviewInput => ({
    caseId: 'case',
    stage,
    closureVersionId: 'closure',
    closureAmount,
    effectivePaymentVersionIds: effective().map((v) => v.id),
    effectiveAmounts: effective().map((v) => v.amount),
    financialReadiness,
    ...(financialItems ? { financialItems } : {}),
  });
  const tx: ClosurePaymentCorrectionTransaction = {
    authorizeInternalOperatorAndLockCase: jest.fn(async () => undefined),
    receipt: jest.fn(async () => null),
    latest: jest.fn(async () => versions[versions.length - 1]),
    append: jest.fn(async (fact) => {
      versions.push(fact);
    }),
    currentReview: jest.fn(async () => review()),
    audit: jest.fn(async () => undefined),
    saveReceipt: jest.fn(async () => undefined),
  };
  const service = new CaseClosurePaymentCorrectionDraftService({
    serializable: async (work) => work(tx),
  });
  return { service, tx, versions };
}
describe('unregistered payment correction coordinator', () => {
  it('voids by appending and preserves archived stage while requesting review', async () => {
    const { service, tx } = setup();
    const result = await service.execute(actor, command);
    expect(result).toMatchObject({ stage: 'ARCHIVED', reviewRequired: true });
    expect(tx.append).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: 2,
        priorVersionId: 'v1',
        state: 'VOID',
        reason: null,
      }),
    );
    expect(tx.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CASE_CLOSURE_PAYMENT_VOID', actor }),
    );
  });
  it('rechecks authorization before replay and avoids duplicate facts', async () => {
    const { service, tx } = setup();
    const first = await service.execute(actor, command);
    const save = jest.mocked(tx.saveReceipt).mock.calls[0];
    jest
      .mocked(tx.receipt)
      .mockResolvedValue({ fingerprint: save[2], result: first });
    expect(await service.execute(actor, command)).toEqual(first);
    expect(tx.authorizeInternalOperatorAndLockCase).toHaveBeenCalledTimes(2);
    expect(tx.append).toHaveBeenCalledTimes(1);
    await expect(
      service.execute(actor, { ...command, reason: 'changed' }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('rejects stale expected versions and external actors', async () => {
    const { service, tx } = setup();
    await expect(
      service.execute(actor, { ...command, expectedVersionId: 'old' }),
    ).rejects.toThrow('PAYMENT_CHANGED');
    expect(tx.append).not.toHaveBeenCalled();
    expect(() =>
      service.execute({ ...actor, lawyerAccountId: 'external' }, command),
    ).toThrow('ACTION_FORBIDDEN');
  });
  it('allows optional correction reason and does not mark waiting cases as post-archive review', async () => {
    const { service, tx } = setup('WAITING_ARCHIVE');
    const result = await service.execute(actor, {
      ...command,
      kind: 'CORRECT',
      paidOn: '2026-10-02',
      amount: '50.00',
      payer: '被告',
      payee: '客户',
    });
    expect(result.reviewRequired).toBe(false);
    expect(tx.append).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '50.00',
        state: 'ACTIVE',
        reason: null,
      }),
    );
  });
});

it('preserves each financial reason in the new response, audit and receipt', async () => {
  const financialItems: NonNullable<PaymentReviewInput['financialItems']> = {
    refund: { state: 'BLOCKED', reason: 'REFUND_ITEMS_NOT_RECEIVED_OR_COSTED' },
    customer: { state: 'PASSED', reason: 'CUSTOMER_RECEIPTS_REACHED' },
    lawyer: { state: 'UNKNOWN', reason: 'ASSESSMENT_SOURCE_STALE' },
  };
  const { service, tx } = setup(
    'ARCHIVED',
    '100.00',
    'BLOCKED',
    financialItems,
  );
  const result = await service.execute(actor, command);
  expect(result.review.financialItems).toEqual(financialItems);
  expect(tx.audit).toHaveBeenCalledWith(expect.objectContaining({ result }));
  expect(tx.saveReceipt).toHaveBeenCalledWith(
    actor,
    'key',
    expect.any(String),
    result,
  );
});

it('accepts historical absent details without fabricating results and rejects malformed new details', async () => {
  const { service, tx } = setup();
  const result = await service.execute(actor, command);
  const fingerprint = jest.mocked(tx.saveReceipt).mock.calls[0][2];
  jest.mocked(tx.receipt).mockResolvedValue({ fingerprint, result });
  const replay = await service.execute(actor, command);
  expect(replay).toEqual(result);
  expect(replay.review).not.toHaveProperty('financialItems');
  expect(() => validatePaymentFinancialItems(undefined)).not.toThrow();
  expect(() =>
    validatePaymentFinancialItems({
      refund: { state: 'PASSED', reason: 'OK' },
    }),
  ).toThrow('INVALID_PAYMENT_FINANCIAL_ITEMS');
  expect(() => validatePaymentFinancialItems(null)).toThrow(
    'INVALID_PAYMENT_FINANCIAL_ITEMS',
  );
});

const correction = {
  ...command,
  kind: 'CORRECT' as const,
  paidOn: '2026-10-02',
  amount: '50.00',
  payer: '被告',
  payee: '客户',
};
it('counts only corrected 50 while retaining the historical 100', async () => {
  const { service, versions } = setup();
  const result = await service.execute(actor, correction);
  expect(versions.map((v) => v.amount)).toEqual(['100.00', '50.00']);
  expect(result.review.effectiveAmounts).toEqual(['50.00']);
  expect(result.review.effectivePaymentVersionIds).toEqual([result.versionId]);
  expect(result.reviewRequired).toBe(true);
});
it('does not count an old active version after its void successor', async () => {
  const { service, versions } = setup();
  const result = await service.execute(actor, command);
  expect(versions.map((v) => v.state)).toEqual(['ACTIVE', 'VOID']);
  expect(result.review.effectiveAmounts).toEqual([]);
  expect(result.reviewRequired).toBe(true);
});
it.each([
  ['100.00', '100.00', 'PASSED', false],
  ['100.00', '50.00', 'PASSED', true],
  [null, '100.00', 'PASSED', true],
  ['0.00', '50.00', 'BLOCKED', true],
  ['0.00', '50.00', 'UNKNOWN', true],
  ['100.00', '100.00', 'BLOCKED', true],
  ['100.00', '100.00', 'UNKNOWN', true],
] as const)(
  'reviews closure %s corrected payment %s financial %s as %s',
  async (required, amount, finance, expected) => {
    const { service } = setup('ARCHIVED', required, finance);
    const result = await service.execute(actor, { ...correction, amount });
    expect(result.review.effectiveAmounts).toEqual([amount]);
    expect(result.reviewRequired).toBe(expected);
    expect(result.stage).toBe('ARCHIVED');
  },
);
it('rejects a revoked operator before replaying a successful receipt', async () => {
  const { service, tx } = setup();
  const first = await service.execute(actor, command);
  const saved = jest.mocked(tx.saveReceipt).mock.calls[0];
  jest
    .mocked(tx.receipt)
    .mockResolvedValue({ fingerprint: saved[2], result: first });
  jest
    .mocked(tx.authorizeInternalOperatorAndLockCase)
    .mockRejectedValue(new Error('ACTION_FORBIDDEN'));
  await expect(service.execute(actor, command)).rejects.toThrow(
    'ACTION_FORBIDDEN',
  );
  expect(tx.receipt).toHaveBeenCalledTimes(1);
  expect(tx.append).toHaveBeenCalledTimes(1);
});

it('audits the full fingerprint and result before append and rejects projection drift', async () => {
  const { service, tx } = setup();
  const result = await service.execute(actor, correction);
  const audit = jest.mocked(tx.audit).mock.calls[0][0];
  const saved = jest.mocked(tx.saveReceipt).mock.calls[0];
  expect(audit.fingerprint).toBe(saved[2]);
  expect(audit.result).toEqual(result);
});

it('archived zero correction retains archived state and warns on missing refund; snapshot is not rewritten', async () => {
  const { service, tx } = setup('ARCHIVED', '0.00', 'UNKNOWN');
  const result = await service.execute(actor, command);
  expect(result.stage).toBe('ARCHIVED');
  expect(result.reviewRequired).toBe(true);
  expect(tx.saveReceipt).toHaveBeenCalledWith(
    actor,
    'key',
    expect.any(String),
    result,
  );
});
