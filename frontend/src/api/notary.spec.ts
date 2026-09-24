import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';

const http = vi.hoisted(() => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  getJson: http.getJson,
  requestJson: http.requestJson,
}));

import {
  createNotaryMatter,
  createNotaryOffice,
  getNotaryMatter,
  listNotaryOffices,
} from './notary';

const matter = {
  id: 'matter-1',
  businessNo: 'NT-20260924-001',
  leadId: 'lead-1',
  leadStatus: 'TRANSFERRED_TO_NOTARY',
  leadVersion: 4,
  stage: 'PENDING_EVIDENCE',
  notaryOffice: { id: 'office-1', name: '广州市南方公证处' },
  selectedProductIds: ['product-1'],
  selectedContentVersionIds: ['content-1'],
  evidenceMode: 'ONLINE_PURCHASE',
  batchPurpose: '首批线上取证',
  createdAt: '2026-09-24T01:00:00.000Z',
};

beforeEach(() => vi.resetAllMocks());

describe('notary API', () => {
  it('lists only validated active notary offices with create capability', async () => {
    const result = {
      items: [{ id: 'office-1', name: '广州市南方公证处', status: 'ACTIVE' }],
      capabilities: { create: true },
    };
    http.getJson.mockResolvedValue(result);
    await expect(listNotaryOffices()).resolves.toEqual(result);
    expect(http.getJson).toHaveBeenCalledWith('/notary-offices', {});

    http.getJson.mockResolvedValueOnce({
      ...result,
      items: [{ id: 'office-1', name: '失效状态', status: 'INACTIVE' }],
    });
    await expect(listNotaryOffices()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('creates an office using the normalized name', async () => {
    const office = {
      id: 'office-1',
      name: '广州市南方公证处',
      status: 'ACTIVE',
    };
    http.requestJson.mockResolvedValue(office);
    await expect(createNotaryOffice(' 广州市南方公证处 ')).resolves.toEqual(
      office,
    );
    expect(http.requestJson).toHaveBeenCalledWith('/notary-offices', {
      method: 'POST',
      body: { name: '广州市南方公证处' },
    });
  });

  it('creates a matter with a stable idempotency header and validates its result', async () => {
    http.requestJson.mockResolvedValue({ ...matter, leadId: 'lead/1' });
    await expect(
      createNotaryMatter(
        'lead/1',
        {
          selectedProductIds: ['product-1'],
          selectedContentVersionIds: ['content-1'],
          notaryOfficeId: 'office-1',
          evidenceMode: 'ONLINE_PURCHASE',
          batchPurpose: '首批线上取证',
          expectedVersion: 3,
        },
        'retry-key',
      ),
    ).resolves.toEqual({ ...matter, leadId: 'lead/1' });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/leads/lead%2F1/notary-matters',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'retry-key' },
        body: {
          selectedProductIds: ['product-1'],
          selectedContentVersionIds: ['content-1'],
          notaryOfficeId: 'office-1',
          evidenceMode: 'ONLINE_PURCHASE',
          batchPurpose: '首批线上取证',
          expectedVersion: 3,
        },
      },
    );

    http.requestJson.mockResolvedValueOnce({ ...matter, leadVersion: 5 });
    await expect(
      createNotaryMatter(
        'lead-1',
        {
          selectedProductIds: ['product-1'],
          selectedContentVersionIds: [],
          notaryOfficeId: 'office-1',
          evidenceMode: 'ONLINE_PURCHASE',
          batchPurpose: '首批线上取证',
          expectedVersion: 3,
        },
        'retry-key',
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('loads a persisted matter with selected snapshots and the source lead link', async () => {
    http.getJson.mockResolvedValue({
      ...matter,
      sourceLead: { id: 'lead-1', businessNo: 'LD-20260921-001' },
      selectedProducts: [
        {
          id: 'product-1',
          position: 1,
          url: null,
          title: '商品甲',
          quantity: 1,
          unitPrice: '9.00',
          commentCount: 1,
          estimatedAmount: '9.00',
        },
      ],
      selectedMaterials: [
        {
          materialId: 'material-1',
          contentVersionId: 'content-1',
          originalFilename: '截图.png',
          mimeType: 'image/png',
        },
      ],
    });
    await expect(getNotaryMatter('matter/1')).resolves.toMatchObject({
      sourceLead: { id: 'lead-1', businessNo: 'LD-20260921-001' },
      selectedMaterials: [{ contentVersionId: 'content-1' }],
      selectedProducts: [{ id: 'product-1', title: '商品甲' }],
    });
    expect(http.getJson).toHaveBeenCalledWith('/notary-matters/matter%2F1', {});
  });
});
