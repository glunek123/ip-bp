import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getNotaryPortalMatter,
  listNotaryPortalMatters,
  recordNotaryPortalOpening,
} from './notary-portal';

afterEach(() => vi.unstubAllGlobals());
const matter = {
  id: 'matter-1',
  businessNo: 'NZ-1',
  stage: 'WAITING_UNBOX',
  version: 3,
  createdAt: '2026-09-28T00:00:00.000Z',
  evidence: null,
  opening: null,
  capabilities: { recordOpening: true },
};

describe('notary portal API', () => {
  it('decodes only the minimal notary matter list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: matter.id,
                businessNo: matter.businessNo,
                stage: matter.stage,
                version: matter.version,
                createdAt: matter.createdAt,
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    );
    await expect(listNotaryPortalMatters()).resolves.toMatchObject({
      total: 1,
      items: [{ id: 'matter-1' }],
    });
  });
  it('rejects a DTO containing customer or fee information', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ...matter, customer: { name: 'private' } }),
          ),
        ),
    );
    await expect(getNotaryPortalMatter('matter-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
  it('decodes a saved UNBOX_REVIEW detail with its frozen opening photos', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'matter-1',
            businessNo: 'NZ-1',
            stage: 'UNBOX_REVIEW',
            version: 4,
            createdAt: '2026-09-28T00:00:00.000Z',
            evidence: { evidenceAt: '2026-09-27', logistics: [] },
            opening: {
              senderName: null,
              senderPhone: null,
              senderAddress: null,
              recordedAt: '2026-09-28T00:00:00.000Z',
              photos: [
                {
                  materialId: 'material-1',
                  contentVersionId: 'content-1',
                  originalFilename: 'box.jpg',
                  mimeType: 'image/jpeg',
                },
              ],
            },
            capabilities: { recordOpening: false },
          }),
        ),
      ),
    );

    const detail = await getNotaryPortalMatter('matter-1');
    expect(detail.stage).toBe('UNBOX_REVIEW');
    if (detail.stage === 'UNBOX_REVIEW') {
      expect(detail.opening?.photos[0]?.originalFilename).toBe('box.jpg');
    } else {
      throw new Error('Expected a saved opening detail');
    }
  });
  it('posts the existing opening input through the notary portal endpoint', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'matter-1',
          stage: 'UNBOX_REVIEW',
          version: 4,
          opening: {
            senderName: null,
            senderPhone: null,
            senderAddress: null,
            recordedAt: '2026-09-28T00:00:00.000Z',
            recordedByUserId: 'notary-user',
            photos: [
              { materialId: 'material-1', contentVersionId: 'content-1' },
            ],
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    await recordNotaryPortalOpening(
      'matter-1',
      { expectedVersion: 3, contentVersionIds: ['content-1'] },
      'key-1',
    );
    expect(fetch.mock.calls[0]?.[0]).toContain(
      '/notary-portal/matters/matter-1/opening',
    );
  });
});
