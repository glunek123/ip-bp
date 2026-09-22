import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';

const http = vi.hoisted(() => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  getJson: http.getJson,
  requestJson: http.requestJson,
}));

import {
  createLead,
  getLead,
  getLeadEditContext,
  getLeadFormContext,
  listLeads,
  pushLead,
  updateLead,
} from './leads';

const option = (value: string, label = value) => ({ value, label });
const context = {
  customers: [
    {
      id: 'customer-1',
      name: '客户甲',
      rightsHolders: [{ id: 'holder-1', name: '主体甲' }],
    },
  ],
  dictionaries: {
    caseTypes: [option('CIVIL', '民事')],
    infringementTypes: [option('TRADEMARK', '商标权')],
    sources: [option('ONLINE', '线上'), option('OFFLINE', '线下')],
    platforms: {
      ONLINE: [option('TAOBAO', '淘宝')],
      OFFLINE: [option('MAP', '地图')],
    },
  },
};

const lead = {
  id: 'lead-1',
  businessNo: 'LD-20260921-001',
  departmentId: 'department-1',
  customerId: 'customer-1',
  rightsHolderId: 'holder-1',
  responsibleUserId: 'user-1',
  teamId: null,
  status: 'WAITING_PUSH',
  caseType: 'CIVIL',
  infringementTypes: ['TRADEMARK'],
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: '2026-09-21T04:00:00.000Z',
  shopName: '测试店铺',
  shopExternalId: null,
  needDisclose: false,
  remark: null,
  creationChannel: 'MANUAL',
  externalSourceRef: null,
  products: [
    {
      id: 'product-1',
      position: 1,
      url: null,
      title: '商品甲',
      quantity: 3,
      unitPrice: '1.55',
      commentCount: 9,
      estimatedAmount: '4.65',
    },
  ],
  leadScreenshotContentVersionIds: ['version-1'],
  version: 1,
  pushedAt: null,
  pushedByUserId: null,
  createdAt: '2026-09-21T04:00:00.000Z',
  updatedAt: '2026-09-21T04:00:00.000Z',
};

const createInput = {
  customerId: 'customer-1',
  rightsHolderId: 'holder-1',
  caseType: 'CIVIL' as const,
  infringementTypes: ['TRADEMARK'] as const,
  source: 'ONLINE' as const,
  platform: 'TAOBAO' as const,
  foundAt: '2026-09-21T04:00:00.000Z',
  shopName: '测试店铺',
  needDisclose: false,
  products: [
    { title: '商品甲', quantity: 3, unitPrice: '1.55', commentCount: 9 },
  ],
  leadScreenshotContentVersionIds: ['version-1'],
};

beforeEach(() => vi.resetAllMocks());

describe('Lead API', () => {
  it('strictly validates form context and every unknown response', async () => {
    http.getJson.mockResolvedValueOnce(context);
    await expect(getLeadFormContext()).resolves.toEqual(context);

    http.getJson.mockResolvedValueOnce({ ...context, customers: [{ id: 1 }] });
    await expect(getLeadFormContext()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    http.getJson.mockResolvedValueOnce({
      ...lead,
      products: [{ unitPrice: 1.55 }],
    });
    await expect(getLead('lead-1')).rejects.toBeInstanceOf(ApiError);
  });

  it('loads the target-scoped edit context from its dedicated route', async () => {
    http.getJson.mockResolvedValue(context);
    await expect(getLeadEditContext('lead/1')).resolves.toEqual(context);
    expect(http.getJson).toHaveBeenCalledWith(
      '/leads/lead%2F1/edit-context',
      {},
    );
  });

  it('requires all four status counters and preserves decimal strings', async () => {
    http.getJson.mockResolvedValue({
      items: [lead],
      total: 1,
      page: 2,
      pageSize: 20,
      counts: {
        WAITING_PUSH: 1,
        WAITING_REVIEW: 2,
        WAITING_EVIDENCE_DECISION: 3,
        ARCHIVED: 4,
      },
      capabilities: { create: true },
    });
    const result = await listLeads(2, 20);
    expect(http.getJson).toHaveBeenCalledWith('/leads?page=2&pageSize=20', {});
    expect(result.items[0]?.products[0]?.unitPrice).toBe('1.55');
    expect(Object.keys(result.counts)).toEqual([
      'WAITING_PUSH',
      'WAITING_REVIEW',
      'WAITING_EVIDENCE_DECISION',
      'ARCHIVED',
    ]);

    http.getJson.mockResolvedValueOnce({
      ...result,
      counts: { WAITING_PUSH: 1 },
    });
    await expect(listLeads()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('adds an optional status filter without dropping pagination', async () => {
    http.getJson.mockResolvedValue({
      items: [lead],
      total: 21,
      page: 2,
      pageSize: 20,
      counts: {
        WAITING_PUSH: 21,
        WAITING_REVIEW: 0,
        WAITING_EVIDENCE_DECISION: 0,
        ARCHIVED: 0,
      },
      capabilities: { create: true },
    });
    await listLeads(2, 20, {}, 'WAITING_PUSH');
    expect(http.getJson).toHaveBeenCalledWith(
      '/leads?page=2&pageSize=20&status=WAITING_PUSH',
      {},
    );
  });

  it('requires a server edit capability on details', async () => {
    http.getJson.mockResolvedValue({
      ...lead,
      capabilities: { edit: false, push: true },
    });
    await expect(getLead('lead-1')).resolves.toMatchObject({
      capabilities: { edit: false, push: true },
    });
    http.getJson.mockResolvedValueOnce(lead);
    await expect(getLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects impossible response facts instead of trusting typed-looking fields', async () => {
    http.getJson.mockResolvedValueOnce({
      ...lead,
      products: [{ ...lead.products[0], quantity: -1 }],
      capabilities: { edit: true, push: true },
    });
    await expect(getLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    http.getJson.mockResolvedValueOnce({
      ...lead,
      platform: 'MAP',
      capabilities: { edit: true, push: true },
    });
    await expect(getLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('sends only explicit create/edit fields and the caller idempotency key', async () => {
    http.requestJson.mockResolvedValueOnce(lead).mockResolvedValueOnce(lead);
    await createLead(createInput, 'create-key');
    expect(http.requestJson).toHaveBeenNthCalledWith(1, '/leads', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'create-key' },
      body: createInput,
    });

    const business = {
      caseType: createInput.caseType,
      infringementTypes: createInput.infringementTypes,
      source: createInput.source,
      platform: createInput.platform,
      foundAt: createInput.foundAt,
      shopName: createInput.shopName,
      needDisclose: createInput.needDisclose,
      products: createInput.products,
      leadScreenshotContentVersionIds:
        createInput.leadScreenshotContentVersionIds,
    };
    await updateLead('lead-1', { ...business, expectedVersion: 1 });
    expect(http.requestJson).toHaveBeenNthCalledWith(2, '/leads/lead-1', {
      method: 'PATCH',
      body: { ...business, expectedVersion: 1 },
    });
  });

  it('pushes with optimistic version and a caller idempotency key', async () => {
    http.requestJson.mockResolvedValue({
      id: lead.id,
      businessNo: lead.businessNo,
      status: 'WAITING_REVIEW',
      version: 2,
      pushedAt: '2026-09-22T02:00:00.000Z',
      pushedByUserId: 'user-1',
    });
    await expect(pushLead(lead.id, 1, 'push-key')).resolves.toMatchObject({
      status: 'WAITING_REVIEW',
      version: 2,
    });
    expect(http.requestJson).toHaveBeenCalledWith('/leads/lead-1/push', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'push-key' },
      body: { expectedVersion: 1 },
    });

    http.requestJson.mockResolvedValueOnce({
      id: lead.id,
      status: 'WAITING_REVIEW',
      version: 1,
    });
    await expect(pushLead(lead.id, 1, 'push-key')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
