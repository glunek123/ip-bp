import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';

const http = vi.hoisted(() => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  getJson: http.getJson,
  requestJson: http.requestJson,
}));

import {
  getClientNotaryMatter,
  listClientNotaryMatters,
  reviewClientNotaryOpening,
} from './client-notary';

const decision = {
  result: 'NO_INFRINGEMENT',
  reason: '经核对未发现侵权',
  actorKind: 'CLIENT',
  actorDisplayName: '客户审核员',
  decidedAt: '2026-09-25T03:00:00.000Z',
  archivedAt: '2026-09-25T03:00:00.000Z',
};
const detail = {
  id: 'matter-1',
  businessNo: 'NT-001',
  stage: 'ARCHIVED',
  version: 3,
  createdAt: '2026-09-24T01:00:00.000Z',
  sourceLead: { id: 'lead-1', businessNo: 'LD-001' },
  selectedProducts: [
    {
      id: 'product-1',
      position: 1,
      title: '商品甲',
      url: null,
      quantity: 1,
      unitPrice: '9.00',
      commentCount: 0,
      estimatedAmount: '9.00',
    },
  ],
  opening: {
    recordedAt: '2026-09-24T02:00:00.000Z',
    photos: [
      {
        materialId: 'photo-1',
        contentVersionId: 'photo-v1',
        originalFilename: '开箱.jpg',
        mimeType: 'image/jpeg',
      },
    ],
  },
  reviewDecision: decision,
  issuanceDecision: null,
  capabilities: { reviewOpening: false },
};

beforeEach(() => vi.resetAllMocks());

describe('client notary API', () => {
  it('requests pending work by default and allows source lead batch discovery', async () => {
    const result = {
      items: [
        {
          id: 'matter-1',
          businessNo: 'NT-001',
          stage: 'UNBOX_REVIEW',
          version: 2,
          createdAt: '2026-09-24T01:00:00.000Z',
          sourceLeadBusinessNo: 'LD-001',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    };
    http.getJson.mockResolvedValue(result);
    await expect(listClientNotaryMatters()).resolves.toEqual(result);
    expect(http.getJson).toHaveBeenCalledWith(
      '/client/notary-matters?page=1&pageSize=20',
      {},
    );
    http.getJson.mockResolvedValueOnce({
      ...result,
      items: [{ ...result.items[0], stage: 'WAITING_UNBOX' }],
    });
    await expect(
      listClientNotaryMatters(1, 20, {}, 'lead-1'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(http.getJson).toHaveBeenLastCalledWith(
      '/client/notary-matters?page=1&pageSize=20&sourceLeadId=lead-1',
      {},
    );
  });

  it('decodes only the minimal client detail and validates decision consistency', async () => {
    http.getJson.mockResolvedValue(detail);
    await expect(getClientNotaryMatter('matter-1')).resolves.toMatchObject({
      reviewDecision: decision,
      opening: { photos: [{ materialId: 'photo-1' }] },
    });
    http.getJson.mockResolvedValueOnce({ ...detail, internalLogistics: [] });
    await expect(getClientNotaryMatter('matter-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    http.getJson.mockResolvedValueOnce({
      ...detail,
      reviewDecision: { ...decision, result: 'INFRINGEMENT' },
    });
    await expect(getClientNotaryMatter('matter-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes client safe issuance summary and certificate/return stages strictly', async () => {
    const issued = {
      ...detail,
      stage: 'WAITING_CERTIFICATE',
      version: 4,
      reviewDecision: {
        ...decision,
        result: 'INFRINGEMENT',
        reason: null,
        archivedAt: null,
      },
      issuanceDecision: {
        decision: 'ISSUE',
        decidedAt: '2026-09-25T04:00:00.000Z',
      },
    };
    http.getJson.mockResolvedValue(issued);
    await expect(getClientNotaryMatter('matter-1')).resolves.toMatchObject({
      issuanceDecision: { decision: 'ISSUE' },
    });
    http.getJson.mockResolvedValueOnce({
      ...issued,
      issuanceDecision: {
        ...issued.issuanceDecision,
        actorDisplayName: '泄漏字段',
      },
    });
    await expect(getClientNotaryMatter('matter-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    http.getJson.mockResolvedValueOnce({
      ...issued,
      stage: 'WAITING_RETURN',
      issuanceDecision: {
        decision: 'NO_ISSUE',
        decidedAt: '2026-09-25T04:00:00.000Z',
      },
    });
    await expect(getClientNotaryMatter('matter-1')).resolves.toMatchObject({
      stage: 'WAITING_RETURN',
    });
  });

  it('requires a reason for no infringement and sends the shared review contract', async () => {
    await expect(
      reviewClientNotaryOpening(
        'matter-1',
        { result: 'NO_INFRINGEMENT', reason: ' ', expectedVersion: 2 },
        'key-1',
      ),
    ).rejects.toBeInstanceOf(ApiError);
    const response = {
      id: 'matter-1',
      stage: 'ARCHIVED',
      version: 3,
      reviewDecision: decision,
    };
    http.requestJson.mockResolvedValue(response);
    await expect(
      reviewClientNotaryOpening(
        'matter-1',
        {
          result: 'NO_INFRINGEMENT',
          reason: ' 经核对未发现侵权 ',
          expectedVersion: 2,
        },
        'key-1',
      ),
    ).resolves.toEqual(response);
    expect(http.requestJson).toHaveBeenCalledWith(
      '/client/notary-matters/matter-1/opening-review',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'key-1' },
        body: {
          result: 'NO_INFRINGEMENT',
          reason: '经核对未发现侵权',
          expectedVersion: 2,
        },
      },
    );
    http.requestJson.mockResolvedValueOnce({
      ...response,
      reviewDecision: { ...decision, actorKind: 'INTERNAL' },
    });
    await expect(
      reviewClientNotaryOpening(
        'matter-1',
        {
          result: 'NO_INFRINGEMENT',
          reason: '经核对未发现侵权',
          expectedVersion: 2,
        },
        'key-2',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
