import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  recordCaseEarlyClosure,
  updateCaseClosureSettlement,
  updateClosureAmounts,
  supplementCasePaymentProof,
  type RecordEarlyClosureInput,
  type UpdateClosureSettlementInput,
  type SupplementCasePaymentProofInput,
} from './case-closure-commands';

const caseId = '10000000-0000-4000-8000-000000000001';
const closureId = '20000000-0000-4000-8000-000000000002';
const versionId = '30000000-0000-4000-8000-000000000003';
const contentId = '40000000-0000-4000-8000-000000000004';
const recordedAt = '2026-10-29T10:00:00.000Z';
const early = (): RecordEarlyClosureInput => ({
  expectedVersion: 4,
  expectedStage: 'EXECUTING',
  idempotencyKey: 'caller-original-key',
  closeAt: '2026-10-29',
  closeAmountState: 'KNOWN',
  closeAmt: '100.01',
  closeContentVersionIds: [contentId],
  paymentType: 'INSTALLMENTS',
  paymentRecords: [
    {
      paidOn: '2026-10-28',
      amount: '0.01',
      payer: '甲',
      payee: '乙',
      screenshotContentVersionId: contentId,
    },
  ],
});
const update = (): UpdateClosureSettlementInput => {
  const { expectedStage: _stage, ...base } = early();
  void _stage;
  return {
    ...base,
    expectedClosureVersionId: versionId,
    correctionReason: null,
    refund: {
      kind: 'RECORD',
      expectedVersionId: null,
      items: [
        {
          itemId: contentId,
          party: 'DEFENDANT',
          status: 'CONVERTED_TO_COST',
          description: '退费转成本',
        },
      ],
    },
    settlement: {
      expectedAssessmentVersionId: null,
      expectedTermsVersion: 2,
      declaration: 'APPLICABLE',
      customerAmount: { mode: 'MANUAL', amount: '9007199254740993.01' },
      lawyerAmount: { mode: 'KEEP' },
    },
  };
};
const proof = (): SupplementCasePaymentProofInput => ({
  idempotencyKey: 'proof-original-key',
  expectedClosureVersionId: versionId,
  paymentId: closureId,
  expectedPaymentVersionId: contentId,
  contentVersionIds: [versionId],
});
const earlyResult = () => ({
  id: caseId,
  earlyClosureId: contentId,
  closureId,
  closureVersionId: versionId,
  stage: 'WAITING_ARCHIVE',
  version: 6,
  recordedAt,
});
const updateResult = () => ({
  id: caseId,
  closureId,
  closureVersionId: versionId,
  stage: 'WAITING_ARCHIVE',
  version: 5,
  recordedAt,
  paymentVersionIds: [contentId],
  refundInventoryVersionId: contentId,
  settlementAssessmentVersionId: contentId,
  settlementTermsChange: {
    auditEventId: versionId,
    before: {
      version: null,
      customerManualAmount: null,
      lawyerManualAmount: null,
    },
    after: {
      version: 1,
      customerManualAmount: '9007199254740993.01',
      lawyerManualAmount: null,
    },
  },
});
const proofResult = () => ({
  id: caseId,
  caseId,
  paymentId: closureId,
  paymentVersionId: contentId,
  closureVersionId: versionId,
  stage: 'ARCHIVED',
  contentVersionIds: [versionId],
  recordedAt,
});
function respond(body: unknown, status = 200) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());
describe('closure command API', () => {
  it('validates and sends the independent amount command and rejects an inconsistent receipt', async () => {
    const input = {
      idempotencyKey: 'amount-key',
      expectedClosureVersionId: versionId,
      expectedTermsVersion: 2,
      expectedAssessmentVersionId: contentId,
      customerAmount: { mode: 'MANUAL' as const, amount: '12.3' },
      lawyerAmount: { mode: 'KEEP' as const },
    };
    const result = {
      caseId,
      closureVersionId: versionId,
      assessmentVersionId: contentId,
      termsVersion: 3,
      change: {
        auditEventId: closureId,
        before: {
          version: 2,
          customerManualAmount: null,
          lawyerManualAmount: '4.00',
        },
        after: {
          version: 3,
          customerManualAmount: '12.30',
          lawyerManualAmount: '4.00',
        },
      },
    };
    const fetch = respond(result);
    expect(await updateClosureAmounts(caseId, input)).toEqual(result);
    expect(fetch.mock.calls[0][0]).toContain('/closure-settlement-amounts');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input);
    respond({
      ...result,
      change: {
        ...result.change,
        after: { ...result.change.after, customerManualAmount: '12.31' },
      },
    });
    await expect(updateClosureAmounts(caseId, input)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('posts early closure with unchanged caller key, versions and exact content references', async () => {
    const fetch = respond(earlyResult());
    const input = early();
    await expect(recordCaseEarlyClosure(caseId, input)).resolves.toEqual(
      earlyResult(),
    );
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(`/api/v1/cases/${caseId}/early-closure`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(input);
    expect(new Headers(options.headers).has('Idempotency-Key')).toBe(false);
  });
  it.each(['中文结案键', '结案\n原始键'])(
    'sends Unicode or multiline keys in JSON for all three commands',
    async (idempotencyKey) => {
      let fetch = respond(earlyResult());
      await recordCaseEarlyClosure(caseId, { ...early(), idempotencyKey });
      expect(JSON.parse(fetch.mock.calls[0][1].body).idempotencyKey).toBe(
        idempotencyKey,
      );
      expect(
        new Headers(fetch.mock.calls[0][1].headers).has('Idempotency-Key'),
      ).toBe(false);
      fetch = respond(updateResult());
      await updateCaseClosureSettlement(caseId, {
        ...update(),
        idempotencyKey,
      });
      expect(JSON.parse(fetch.mock.calls[0][1].body).idempotencyKey).toBe(
        idempotencyKey,
      );
      expect(
        new Headers(fetch.mock.calls[0][1].headers).has('Idempotency-Key'),
      ).toBe(false);
      fetch = respond(proofResult());
      await supplementCasePaymentProof(caseId, { ...proof(), idempotencyKey });
      expect(JSON.parse(fetch.mock.calls[0][1].body).idempotencyKey).toBe(
        idempotencyKey,
      );
      expect(
        new Headers(fetch.mock.calls[0][1].headers).has('Idempotency-Key'),
      ).toBe(false);
    },
  );
  it('posts settlement update and preserves decimal strings, null, and omitted subcommands', async () => {
    const fetch = respond(updateResult());
    const input = update();
    await expect(updateCaseClosureSettlement(caseId, input)).resolves.toEqual(
      updateResult(),
    );
    expect(fetch.mock.calls[0][0]).toBe(
      `/api/v1/cases/${caseId}/closure-settlement-updates`,
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input);
    const { refund: _refund, settlement: _settlement, ...without } = input;
    void _refund;
    void _settlement;
    respond({
      ...updateResult(),
      refundInventoryVersionId: null,
      settlementAssessmentVersionId: null,
      settlementTermsChange: null,
    });
    await updateCaseClosureSettlement(caseId, without);
    expect(without).not.toHaveProperty('refund');
  });
  it('posts proof supplement without revising expected heads or references', async () => {
    const fetch = respond(proofResult());
    const input = proof();
    await expect(supplementCasePaymentProof(caseId, input)).resolves.toEqual(
      proofResult(),
    );
    expect(fetch.mock.calls[0][0]).toBe(
      `/api/v1/cases/${caseId}/payment-proof-supplements`,
    );
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input);
  });
  it.each([
    { expectedVersion: 0 },
    { closeAmt: 1.01 },
    { closeAmt: '1.001' },
    { closeAmountState: 'PENDING' },
    { expectedStage: 'ARCHIVED' },
    {
      paymentRecords: [
        {
          ...early().paymentRecords[0],
          screenshotContentVersionId: new File(['x'], 'x.png'),
        },
      ],
    },
    { file: new File(['x'], 'x.png') },
    { idempotencyKey: ' new-key ' },
    { closeContentVersionIds: [contentId, contentId.toUpperCase()] },
  ])('rejects invalid early input before network', async (change) => {
    const fetch = respond(earlyResult());
    await expect(
      recordCaseEarlyClosure(caseId, {
        ...early(),
        ...change,
      } as RecordEarlyClosureInput),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects wrong refund command and manual override shape before network', async () => {
    const fetch = respond(updateResult());
    await expect(
      updateCaseClosureSettlement(caseId, {
        ...update(),
        refund: { kind: 'CONFIRM_COMPLETE', expectedVersionId: null },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      updateCaseClosureSettlement(caseId, {
        ...update(),
        settlement: {
          ...update().settlement!,
          customerAmount: { mode: 'KEEP', amount: '1.00' } as never,
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    { version: 4 },
    { version: 5 },
    { version: 7 },
    { id: contentId },
    { stage: 'ARCHIVED' },
    { sourceCaseId: caseId },
    { recordedAt: 'yesterday' },
  ])('rejects invalid early receipt', async (change) => {
    respond({ ...earlyResult(), ...change });
    await expect(recordCaseEarlyClosure(caseId, early())).rejects.toMatchObject(
      { code: 'INVALID_RESPONSE' },
    );
  });
  it('rejects invalid settlement terms versions and wrong money', async () => {
    const result = updateResult();
    result.settlementTermsChange.after.version = 3;
    respond(result);
    await expect(
      updateCaseClosureSettlement(caseId, update()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    result.settlementTermsChange.after.version = 1;
    result.settlementTermsChange.after.customerManualAmount = '1.001';
    respond(result);
    await expect(
      updateCaseClosureSettlement(caseId, update()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each([
    { paymentVersionId: versionId },
    { closureVersionId: contentId },
    { caseId: contentId },
    { contentVersionIds: [contentId] },
    { contentVersionIds: [] },
  ])('rejects mismatched supplement receipts', async (change) => {
    respond({ ...proofResult(), ...change });
    await expect(
      supplementCasePaymentProof(caseId, proof()),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('does not retry or invent a new key after conflict', async () => {
    const fetch = respond(
      { code: 'VERSION_CONFLICT', message: '刷新', requestId: 'r1' },
      409,
    );
    await expect(recordCaseEarlyClosure(caseId, early())).rejects.toMatchObject(
      { status: 409, code: 'VERSION_CONFLICT', requestId: 'r1' },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it('preserves zero, cents, explicit unknown and original amountless pending request bodies without inventing zero', async () => {
  for (const amount of [undefined, null, '0', '12.34']) {
    const input = update();
    input.refund = {
      kind: 'RECORD',
      expectedVersionId: null,
      items: [
        {
          itemId: contentId,
          party: 'COURT',
          status: 'PENDING',
          description: '退费',
          ...(amount === undefined ? {} : { amount }),
        },
      ],
    };
    const fetch = respond(updateResult());
    await updateCaseClosureSettlement(caseId, input);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual(input);
    expect(input.refund.items[0]!.amount).toBe(amount);
  }
});
it('rejects malformed refund amount before any request', async () => {
  for (const amount of ['', '-1', '1.001', '01', 1]) {
    const fetch = respond(updateResult());
    const input = {
      ...update(),
      refund: {
        kind: 'RECORD',
        expectedVersionId: null,
        items: [
          {
            itemId: contentId,
            party: 'COURT',
            status: 'PENDING',
            description: '退费',
            amount,
          },
        ],
      },
    };
    await expect(
      updateCaseClosureSettlement(
        caseId,
        input as unknown as UpdateClosureSettlementInput,
      ),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  }
});
