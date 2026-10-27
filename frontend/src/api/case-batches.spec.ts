import { beforeEach, describe, expect, it, vi } from 'vitest';
const http = vi.hoisted(() => ({ requestJson: vi.fn() }));
vi.mock('./http', async (original) => ({
  ...(await original<typeof import('./http')>()),
  requestJson: http.requestJson,
}));
import { archiveCaseBatch } from './case-batches';
const first = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const input = {
  idempotencyKey: 'batch-1',
  archiveAt: '2026-10-26',
  reason: '停止诉讼',
  items: [
    { id: first, expectedVersion: 2 },
    { id: second, expectedVersion: 5 },
  ],
};
beforeEach(() => vi.resetAllMocks());
describe('case early archive batch API', () => {
  it('posts the exact request and decodes a per-case mixed result', async () => {
    http.requestJson.mockResolvedValue({
      items: [
        {
          id: first,
          status: 'SUCCEEDED',
          result: {
            id: first,
            earlyArchiveId: '33333333-3333-4333-8333-333333333333',
            fromStage: 'WAITING_ARCHIVE',
            stage: 'ARCHIVED',
            version: 3,
            recordedAt: '2026-10-26T00:00:00.000Z',
          },
        },
        { id: second, status: 'FAILED', code: 'VERSION_CONFLICT' },
      ],
    });
    await expect(archiveCaseBatch(input)).resolves.toMatchObject({
      items: [
        { id: first, status: 'SUCCEEDED' },
        { id: second, status: 'FAILED', code: 'VERSION_CONFLICT' },
      ],
    });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/cases/early-archive-batches',
      expect.objectContaining({
        method: 'POST',
        retryOnCsrfInvalid: false,
        body: input,
      }),
    );
  });
  it('rejects duplicate IDs and a mismatched result order before trusting it', async () => {
    await expect(
      archiveCaseBatch({ ...input, items: [input.items[0]!, input.items[0]!] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    http.requestJson.mockResolvedValue({
      items: input.items.map((item) => ({ id: item.id, status: 'UNKNOWN' })),
    });
    await expect(archiveCaseBatch(input)).resolves.toMatchObject({
      items: [{ status: 'UNKNOWN' }, { status: 'UNKNOWN' }],
    });
  });
});
