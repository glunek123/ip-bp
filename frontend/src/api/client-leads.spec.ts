import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ getJson: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  getJson: http.getJson,
}));

import { getClientLead, listClientLeads } from './client-leads';

const lead = {
  id: 'lead-1',
  businessNo: 'LD-20260922-001',
  status: 'WAITING_REVIEW',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: '2026-09-22T01:00:00.000Z',
  shopName: '测试店铺',
  shopExternalId: null,
  rightsHolderName: '权利主体甲',
  products: [
    {
      id: 'product-1',
      position: 1,
      url: null,
      title: '商品甲',
      quantity: 1,
      unitPrice: '10.00',
      commentCount: 0,
      estimatedAmount: '10.00',
    },
  ],
  leadScreenshotContentVersionIds: ['version-1'],
  pushedAt: '2026-09-22T02:00:00.000Z',
};

beforeEach(() => vi.resetAllMocks());

describe('client lead API', () => {
  it('reads only the redacted client projection', async () => {
    http.getJson.mockResolvedValue({
      items: [lead],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await expect(listClientLeads()).resolves.toMatchObject({ items: [lead] });
    expect(http.getJson).toHaveBeenCalledWith(
      '/client/leads?page=1&pageSize=20',
      {},
    );

    http.getJson.mockResolvedValue(lead);
    await expect(getClientLead('lead/1')).resolves.toEqual(lead);
    expect(http.getJson).toHaveBeenLastCalledWith('/client/leads/lead%2F1', {});
  });

  it('rejects internal fields, invalid push facts and malformed products', async () => {
    http.getJson.mockResolvedValue({ ...lead, pushedAt: null });
    await expect(getClientLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    http.getJson.mockResolvedValue({
      ...lead,
      products: [{ ...lead.products[0], position: 2 }],
    });
    await expect(getClientLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
