import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';

const http = vi.hoisted(() => ({ requestJson: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  requestJson: http.requestJson,
}));

import { archiveNotaryReturnBatch } from './notary-return-archive-batch';
import type { ArchiveNotaryReturnBatchInput } from './notary-return-archive-batch';

const inputs: ArchiveNotaryReturnBatchInput[] = [
  {
    matterId: '22222222-2222-4222-8222-222222222222',
    returnChoice: 'KEEP',
    archiveReason: '保留样品',
    expectedVersion: 4,
  },
  {
    matterId: '11111111-1111-4111-8111-111111111111',
    returnChoice: 'REFUND_ONLY',
    refund: {
      state: 'KNOWN',
      amount: '12.50',
      partyKind: 'OTHER',
      partyName: '客户甲',
    },
    archiveReason: '协商退款',
    expectedVersion: 7,
  },
];

const summary = (input: ArchiveNotaryReturnBatchInput) => ({
  returnChoice: input.returnChoice,
  archiveReason: input.archiveReason,
  archivedAt: '2026-10-02T01:00:00.000Z',
  actorDisplayName: '运营甲',
  refund: input.refund
    ? input.refund.state === 'PENDING'
      ? { state: 'PENDING', amount: null, partyKind: null, partyName: null }
      : {
          state: 'KNOWN',
          amount: input.refund.amount,
          partyKind: input.refund.partyKind ?? null,
          partyName: input.refund.partyName ?? null,
        }
    : null,
  freight: input.freight
    ? input.freight.state === 'PENDING'
      ? { state: 'PENDING', amount: null, partyKind: null, partyName: null }
      : {
          state: 'KNOWN',
          amount: input.freight.amount,
          partyKind: input.freight.partyKind ?? null,
          partyName: input.freight.partyName ?? null,
        }
    : null,
});

const receipt = (values = inputs) => ({
  batchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  items: [...values]
    .sort((left, right) => left.matterId.localeCompare(right.matterId))
    .map((input) => ({
      id: input.matterId,
      stage: 'ARCHIVED',
      version: input.expectedVersion + 1,
      returnArchive: summary(input),
    })),
});

beforeEach(() => vi.resetAllMocks());

describe('archiveNotaryReturnBatch', () => {
  it('sends one exact command and validates sorted per-item facts', async () => {
    http.requestJson.mockResolvedValue(receipt());
    await expect(
      archiveNotaryReturnBatch(inputs, 'stable-key'),
    ).resolves.toEqual(receipt());
    expect(http.requestJson).toHaveBeenCalledWith(
      '/notary-matters/return-archive-batches',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'stable-key' },
        body: {
          items: inputs.map((input) => ({ ...input })),
        },
        retryOnCsrfInvalid: false,
      },
    );
  });

  it('rejects invalid input before sending a request', async () => {
    await expect(archiveNotaryReturnBatch([], 'key')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      archiveNotaryReturnBatch(
        Array.from({ length: 51 }, (_, index) => ({
          matterId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
          returnChoice: 'KEEP' as const,
          archiveReason: '说明',
          expectedVersion: 1,
        })),
        'key',
      ),
    ).rejects.toBeInstanceOf(ApiError);
    expect(http.requestJson).not.toHaveBeenCalled();
  });

  it('rejects malformed, incomplete, reordered, or mismatched receipts', async () => {
    const valid = receipt();
    const invalid = [
      { ...valid, extra: true },
      { ...valid, batchId: '' },
      { ...valid, items: valid.items.slice(0, 1) },
      { ...valid, items: [...valid.items].reverse() },
      {
        ...valid,
        items: valid.items.map((item) => ({
          ...item,
          version: item.version + 1,
        })),
      },
      {
        ...valid,
        items: valid.items.map((item) => ({
          ...item,
          returnArchive: { ...item.returnArchive, refund: null },
        })),
      },
    ];
    for (const value of invalid) {
      http.requestJson.mockResolvedValueOnce(value);
      await expect(
        archiveNotaryReturnBatch(inputs, 'key'),
      ).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
      });
    }
  });
});
