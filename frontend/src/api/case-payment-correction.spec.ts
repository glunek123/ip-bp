import { beforeEach, expect, it, vi } from 'vitest';
import {
  correctCasePayment,
  getCasePaymentHistory,
} from './case-payment-correction';
const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  requestJson: http.post,
  getJson: http.get,
}));
const id = '10000000-0000-4000-8000-000000000001';
const input = {
  kind: 'VOID' as const,
  paymentId: id,
  expectedVersionId: id,
  idempotencyKey: 'key',
};
const result = () => ({
  versionId: id,
  stage: 'ARCHIVED',
  reviewRequired: true,
  review: {
    caseId: id,
    stage: 'ARCHIVED',
    closureVersionId: id,
    closureAmount: '10.00',
    effectiveAmounts: [],
    effectivePaymentVersionIds: [],
    financialReadiness: 'UNKNOWN',
    financialItems: {
      refund: { state: 'UNKNOWN', reason: 'REFUND_INVENTORY_MISSING' },
      customer: { state: 'UNKNOWN', reason: 'ASSESSMENT_MISSING' },
      lawyer: { state: 'UNKNOWN', reason: 'ASSESSMENT_MISSING' },
    },
  },
});
beforeEach(() => {
  http.post.mockReset();
  http.get.mockReset();
});
it('uses the real POST options contract and decodes the archive review indication', async () => {
  http.post.mockResolvedValue(result());
  await expect(correctCasePayment(id, input)).resolves.toEqual({
    versionId: id,
    stage: 'ARCHIVED',
    reviewRequired: true,
  });
  expect(http.post).toHaveBeenCalledWith(`/cases/${id}/payment-corrections`, {
    method: 'POST',
    body: input,
  });
});
it('rejects cross-case or internal-source-bearing results', async () => {
  const value = result();
  value.review.caseId = '20000000-0000-4000-8000-000000000002';
  http.post.mockResolvedValueOnce(value);
  await expect(correctCasePayment(id, input)).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
  http.post.mockResolvedValue({
    ...result(),
    review: {
      ...result().review,
      financialSources: { allocationIds: ['secret'] },
    },
  });
  await expect(correctCasePayment(id, input)).rejects.toMatchObject({
    code: 'INVALID_RESPONSE',
  });
});
it('reads void and superseded historical proof sets separately', async () => {
  http.get.mockResolvedValue({
    caseId: id,
    caseVersion: 7,
    stage: 'ARCHIVED',
    closureVersionId: id,
    paymentHistory: [
      {
        versionId: id,
        paymentId: id,
        priorVersionId: null,
        revision: 1,
        state: 'ACTIVE',
        paidOn: '2026-10-31',
        amount: '12.34',
        payer: '甲',
        payee: '乙',
        reason: null,
        recordedAt: '2026-10-31T00:00:00.000Z',
        originalDocuments: [{ materialId: id, contentVersionId: id }],
        supplementalDocuments: [],
      },
    ],
  });
  const value = await getCasePaymentHistory(id);
  expect(value.paymentHistory[0]?.originalDocuments).toEqual([
    { materialId: id, contentVersionId: id },
  ]);
  expect(value.paymentHistory[0]?.supplementalDocuments).toEqual([]);
});
