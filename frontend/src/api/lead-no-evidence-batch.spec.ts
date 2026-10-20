import { beforeEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ requestJson: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  requestJson: http.requestJson,
}));
import {
  decideLeadNoEvidenceBatch,
  type LeadNoEvidenceBatchInput,
} from './lead-no-evidence-batch';
const leadId = '33333333-3333-4333-8333-333333333333';
const input = (): LeadNoEvidenceBatchInput => ({
  items: [{ leadId, expectedVersion: 2, reason: ' 原始原因 ' }],
});
const result = () => ({
  items: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      leadId,
      status: 'ARCHIVED',
      version: 3,
      result: 'NO_EVIDENCE',
      reason: '原始原因',
      decidedByDisplayName: '运营甲',
      decidedAt: '2026-10-20T00:00:00.000Z',
      archiveType: 'NO_EVIDENCE',
      archivedAt: '2026-10-20T00:00:00.000Z',
    },
  ],
});
describe('lead no evidence batch API', () => {
  beforeEach(() => vi.resetAllMocks());
  it('sends one original ordered body and key with retries disabled', async () => {
    http.requestJson.mockResolvedValue(result());
    await expect(
      decideLeadNoEvidenceBatch(input(), {
        headers: { 'Idempotency-Key': 'original-key' },
        retryOnCsrfInvalid: true,
      }),
    ).resolves.toEqual(result());
    expect(http.requestJson).toHaveBeenCalledExactlyOnceWith(
      '/leads/batch-no-evidence',
      expect.objectContaining({
        method: 'POST',
        body: input(),
        headers: { 'Idempotency-Key': 'original-key' },
        retryOnCsrfInvalid: false,
      }),
    );
  });
  it('captures input before an asynchronous response', async () => {
    let resolve!: (value: unknown) => void;
    http.requestJson.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const body = input();
    const pending = decideLeadNoEvidenceBatch(body, {
      headers: { 'Idempotency-Key': 'key' },
    });
    body.items[0]!.reason = 'changed';
    body.items[0]!.expectedVersion = 50;
    resolve(result());
    await expect(pending).resolves.toEqual(result());
    expect(http.requestJson.mock.calls[0]![1].body).toEqual(input());
  });
  it('requires full ordered results and rejects case-insensitive duplicate IDs', async () => {
    const first = 'abcdefab-1234-4234-8234-123456789abc';
    const second = '55555555-5555-4555-8555-555555555555';
    const body = {
      items: [
        { leadId: first, expectedVersion: 2, reason: 'first' },
        { leadId: second, expectedVersion: 4, reason: 'second' },
      ],
    };
    const outputs = [
      { ...result().items[0], leadId: first, reason: 'first' },
      {
        ...result().items[0],
        id: '66666666-6666-4666-8666-666666666666',
        leadId: second,
        reason: 'second',
        version: 5,
      },
    ];
    http.requestJson.mockResolvedValueOnce({ items: outputs });
    await expect(
      decideLeadNoEvidenceBatch(body, {
        headers: { 'Idempotency-Key': 'key' },
      }),
    ).resolves.toEqual({ items: outputs });
    http.requestJson.mockResolvedValueOnce({ items: [...outputs].reverse() });
    await expect(
      decideLeadNoEvidenceBatch(body, {
        headers: { 'Idempotency-Key': 'key' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(
      decideLeadNoEvidenceBatch(
        {
          items: [
            body.items[0]!,
            { ...body.items[0]!, leadId: first.toUpperCase() },
          ],
        },
        { headers: { 'Idempotency-Key': 'key' } },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it.each([
    { items: [] },
    { items: Array.from({ length: 21 }, () => input().items[0]) },
    {
      items: [
        input().items[0],
        { ...input().items[0], leadId: leadId.toUpperCase() },
      ],
    },
    { items: [{ ...input().items[0], reason: ' ' }] },
    { items: [{ ...input().items[0], expectedVersion: 2_147_483_647 }] },
    { ...input(), actorId: 'forged' },
    { items: [{ ...input().items[0], status: 'ARCHIVED' }] },
  ])('rejects invalid input %j before HTTP', async (body) => {
    await expect(
      decideLeadNoEvidenceBatch(body as LeadNoEvidenceBatchInput, {
        headers: { 'Idempotency-Key': 'key' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(http.requestJson).not.toHaveBeenCalled();
  });
  it('uses Unicode code points and validates the required key', async () => {
    const body = input();
    body.items[0]!.reason = '😀'.repeat(5000);
    http.requestJson.mockResolvedValue({
      items: [{ ...result().items[0], reason: body.items[0]!.reason }],
    });
    await expect(
      decideLeadNoEvidenceBatch(body, {
        headers: { 'Idempotency-Key': 'key' },
      }),
    ).resolves.toBeDefined();
    body.items[0]!.reason += 'a';
    await expect(
      decideLeadNoEvidenceBatch(body, {
        headers: { 'Idempotency-Key': 'key' },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(decideLeadNoEvidenceBatch(input())).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
  it.each([
    { items: [] },
    { ...result(), extra: true },
    { items: [{ ...result().items[0], version: 4 }] },
    { items: [{ ...result().items[0], reason: 'different' }] },
    { items: [{ ...result().items[0], leadId: 'other' }] },
    { items: [{ ...result().items[0], actorId: 'hidden' }] },
  ])('rejects partial or mismatched response %j', async (body) => {
    http.requestJson.mockResolvedValue(body);
    await expect(
      decideLeadNoEvidenceBatch(input(), {
        headers: { 'Idempotency-Key': 'key' },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
