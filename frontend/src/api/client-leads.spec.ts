import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  getJson: http.getJson,
  requestJson: http.requestJson,
}));

import {
  getClientLead,
  listClientLeads,
  reviewClientLead,
} from './client-leads';

const lead = {
  id: 'lead-1',
  businessNo: 'LD-20260922-001',
  status: 'WAITING_REVIEW',
  version: 2,
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
  reviewDecision: null,
  capabilities: { review: true },
};

const reviewedLead = {
  ...lead,
  status: 'WAITING_EVIDENCE_DECISION',
  version: 3,
  reviewDecision: {
    result: 'INFRINGEMENT',
    reviewerDisplayName: '企业审核员',
    decidedAt: '2026-09-22T03:00:00.000Z',
  },
  capabilities: { review: false },
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
    await expect(listClientLeads('PENDING')).resolves.toMatchObject({
      items: [lead],
    });
    expect(http.getJson).toHaveBeenCalledWith(
      '/client/leads?view=PENDING&page=1&pageSize=20',
      {},
    );

    http.getJson.mockResolvedValue(lead);
    await expect(getClientLead('lead/1')).resolves.toEqual(lead);
    expect(http.getJson).toHaveBeenLastCalledWith('/client/leads/lead%2F1', {});
  });

  it('decodes processed decisions but rejects status, decision and capability mismatches', async () => {
    http.getJson.mockResolvedValue({
      items: [reviewedLead],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await expect(listClientLeads('PROCESSED')).resolves.toMatchObject({
      items: [reviewedLead],
    });
    expect(http.getJson).toHaveBeenCalledWith(
      '/client/leads?view=PROCESSED&page=1&pageSize=20',
      {},
    );

    http.getJson.mockResolvedValue({ ...reviewedLead, reviewDecision: null });
    await expect(getClientLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    http.getJson.mockResolvedValue({
      ...lead,
      reviewDecision: reviewedLead.reviewDecision,
    });
    await expect(getClientLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    http.getJson.mockResolvedValue({
      ...reviewedLead,
      capabilities: { review: true },
    });
    await expect(getClientLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    http.getJson.mockResolvedValue({
      ...lead,
      reviewDecision: {
        ...reviewedLead.reviewDecision,
        reviewerUserId: 'internal',
      },
    });
    await expect(getClientLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects records returned in the wrong requested queue', async () => {
    http.getJson.mockResolvedValue({
      items: [lead],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await expect(listClientLeads('PROCESSED')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    http.getJson.mockResolvedValue({
      items: [reviewedLead],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await expect(listClientLeads('PENDING')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('confirms infringement with one idempotency key and validates the result snapshot', async () => {
    http.requestJson.mockResolvedValue({
      id: lead.id,
      businessNo: lead.businessNo,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      reviewDecision: reviewedLead.reviewDecision,
    });
    await expect(
      reviewClientLead('lead/1', 2, 'review-key'),
    ).resolves.toMatchObject({
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
    });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/client/leads/lead%2F1/reviews',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'review-key' },
        body: { result: 'INFRINGEMENT', expectedVersion: 2 },
      },
    );
    http.requestJson.mockResolvedValue({
      id: lead.id,
      businessNo: lead.businessNo,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 2,
      reviewDecision: reviewedLead.reviewDecision,
    });
    await expect(
      reviewClientLead('lead-1', 2, 'review-key'),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects extra internal fields, invalid push facts and malformed products', async () => {
    http.getJson.mockResolvedValue({ ...lead, departmentId: 'internal' });
    await expect(getClientLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    http.getJson.mockResolvedValue({
      items: [lead],
      total: 1,
      page: 1,
      pageSize: 20,
      internalCount: 1,
    });
    await expect(listClientLeads()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

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

    http.getJson.mockResolvedValue({
      ...lead,
      products: [{ ...lead.products[0], internalCost: '1.00' }],
    });
    await expect(getClientLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});
