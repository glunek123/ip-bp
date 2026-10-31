import { ApiError, getJson, requestJson, type RequestOptions } from './http';
export type PaymentReplacement = {
  paidOn: string;
  amount: string;
  payer: string;
  payee: string;
};
export type CorrectCasePaymentInput = {
  paymentId: string;
  expectedVersionId: string;
  idempotencyKey: string;
  reason?: string | null;
} & ({ kind: 'VOID' } | ({ kind: 'CORRECT' } & PaymentReplacement));
export type PaymentCorrectionResult = {
  versionId: string;
  stage: 'WAITING_ARCHIVE' | 'ARCHIVED';
  reviewRequired: boolean;
};
const invalid = (): never => {
  throw new ApiError('服务返回了无效的付款记录', 200, 'INVALID_RESPONSE');
};
const uuid = (v: unknown): string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(v)
    ? v
    : invalid();
const text = (v: unknown): string => (typeof v === 'string' ? v : invalid());
const money = (v: unknown) =>
  /^\d+\.\d{2}$/u.test(text(v)) ? text(v) : invalid();
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    return invalid();
  return value as Record<string, unknown>;
}
export async function correctCasePayment(
  caseId: string,
  input: CorrectCasePaymentInput,
  options?: RequestOptions,
): Promise<PaymentCorrectionResult> {
  uuid(caseId);
  uuid(input.paymentId);
  uuid(input.expectedVersionId);
  const keys = [
    'kind',
    'paymentId',
    'expectedVersionId',
    'idempotencyKey',
    ...(Object.hasOwn(input, 'reason') ? ['reason'] : []),
    ...(input.kind === 'CORRECT' ? ['paidOn', 'amount', 'payer', 'payee'] : []),
  ];
  object(input, keys);
  if (
    !['CORRECT', 'VOID'].includes(input.kind) ||
    !/^\S(?:[\s\S]{0,126}\S)?$/u.test(input.idempotencyKey) ||
    (input.reason !== undefined &&
      input.reason !== null &&
      (typeof input.reason !== 'string' || input.reason.length > 500))
  )
    throw new ApiError('付款请求无效', 400, 'VALIDATION_ERROR');
  const value = object(
    await requestJson(
      `/cases/${encodeURIComponent(caseId)}/payment-corrections`,
      { ...options, method: 'POST', body: input },
    ),
    ['versionId', 'stage', 'reviewRequired', 'review'],
  );
  if (
    (value.stage !== 'WAITING_ARCHIVE' && value.stage !== 'ARCHIVED') ||
    typeof value.reviewRequired !== 'boolean'
  )
    return invalid();
  if (
    typeof value.review !== 'object' ||
    value.review === null ||
    Array.isArray(value.review)
  )
    return invalid();
  const review = value.review as Record<string, unknown>;
  object(review, [
    'caseId',
    'stage',
    'closureVersionId',
    'closureAmount',
    'effectivePaymentVersionIds',
    'effectiveAmounts',
    'financialReadiness',
    ...(Object.hasOwn(review, 'financialItems') ? ['financialItems'] : []),
  ]);
  if (
    uuid(review.caseId).toLowerCase() !== caseId.toLowerCase() ||
    review.stage !== value.stage ||
    Object.hasOwn(review, 'financialSources')
  )
    return invalid();
  uuid(review.closureVersionId);
  if (review.closureAmount !== null) money(review.closureAmount);
  if (
    !['PASSED', 'BLOCKED', 'UNKNOWN'].includes(text(review.financialReadiness))
  )
    return invalid();
  if (Object.hasOwn(review, 'financialItems')) {
    const items = object(review.financialItems, [
      'refund',
      'customer',
      'lawyer',
    ]);
    for (const item of Object.values(items)) {
      const p = object(item, ['state', 'reason']);
      if (
        !['PASSED', 'BLOCKED', 'UNKNOWN', 'EXEMPT'].includes(text(p.state)) ||
        !/^[A-Z][A-Z0-9_]{0,99}$/u.test(text(p.reason))
      )
        return invalid();
    }
  }
  if (
    !Array.isArray(review.effectivePaymentVersionIds) ||
    !Array.isArray(review.effectiveAmounts) ||
    review.effectiveAmounts.length !== review.effectivePaymentVersionIds.length
  )
    return invalid();
  review.effectivePaymentVersionIds.forEach(uuid);
  review.effectiveAmounts.forEach(money);
  return {
    versionId: uuid(value.versionId),
    stage: value.stage,
    reviewRequired: value.reviewRequired,
  };
}
const documents = (v: unknown) =>
  Array.isArray(v)
    ? v.map((d) => {
        const row = object(d, ['materialId', 'contentVersionId']);
        return {
          materialId: uuid(row.materialId),
          contentVersionId: uuid(row.contentVersionId),
        };
      })
    : invalid();
export async function getCasePaymentHistory(
  caseId: string,
  options?: RequestOptions,
) {
  const value = object(
    await getJson(`/cases/${caseId}/payment-history`, options),
    ['caseId', 'caseVersion', 'stage', 'closureVersionId', 'paymentHistory'],
  );
  if (
    uuid(value.caseId).toLowerCase() !== caseId.toLowerCase() ||
    typeof value.caseVersion !== 'number' ||
    !Number.isSafeInteger(value.caseVersion) ||
    value.caseVersion < 1 ||
    !Array.isArray(value.paymentHistory)
  )
    return invalid();
  const paymentHistory = value.paymentHistory.map((item) => {
    const p = object(item, [
      'versionId',
      'paymentId',
      'priorVersionId',
      'revision',
      'state',
      'paidOn',
      'amount',
      'payer',
      'payee',
      'reason',
      'recordedAt',
      'originalDocuments',
      'supplementalDocuments',
    ]);
    if (
      typeof p.revision !== 'number' ||
      !Number.isSafeInteger(p.revision) ||
      p.revision < 1 ||
      (p.state !== 'ACTIVE' && p.state !== 'VOID')
    )
      return invalid();
    const paidOn = text(p.paidOn);
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(paidOn) ||
      Number.isNaN(Date.parse(paidOn)) ||
      new Date(paidOn).toISOString().slice(0, 10) !== paidOn
    )
      return invalid();
    const recordedAt = text(p.recordedAt);
    if (Number.isNaN(Date.parse(recordedAt))) return invalid();
    return {
      versionId: uuid(p.versionId),
      paymentId: uuid(p.paymentId),
      priorVersionId: p.priorVersionId === null ? null : uuid(p.priorVersionId),
      revision: p.revision,
      state: p.state,
      paidOn,
      amount: money(p.amount),
      payer: text(p.payer),
      payee: text(p.payee),
      reason: p.reason === null ? null : text(p.reason),
      recordedAt,
      originalDocuments: documents(p.originalDocuments),
      supplementalDocuments: documents(p.supplementalDocuments),
    };
  });
  return {
    caseId: uuid(value.caseId),
    caseVersion: value.caseVersion,
    stage: text(value.stage),
    closureVersionId:
      value.closureVersionId === null ? null : uuid(value.closureVersionId),
    paymentHistory,
  };
}
export type CasePaymentHistory = Awaited<
  ReturnType<typeof getCasePaymentHistory>
>;
