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
  reviewClientLeadNoInfringement,
  confirmClientLeadWithdrawal,
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
  evidenceDecision: null,
  pendingWithdrawalApplication: null,
  history: [],
  capabilities: { review: true, confirmWithdrawal: false },
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
  capabilities: { review: false, confirmWithdrawal: false },
};
const archivedLead = {
  ...lead,
  status: 'ARCHIVED',
  version: 3,
  reviewDecision: {
    result: 'NO_INFRINGEMENT',
    reason: '  经核对未使用我司标识  ',
    reviewerDisplayName: '企业审核员',
    decidedAt: '2026-09-22T03:00:00.000Z',
    archiveType: 'NO_INFRINGEMENT',
    archivedAt: '2026-09-22T03:00:00.000Z',
  },
  pendingWithdrawalApplication: null,
  history: [],
  capabilities: { review: false, confirmWithdrawal: false },
};
const noEvidenceLead = {
  ...lead,
  status: 'ARCHIVED',
  version: 4,
  reviewDecision: reviewedLead.reviewDecision,
  evidenceDecision: {
    result: 'NO_EVIDENCE',
    reason: '现阶段不取证',
    decidedAt: '2026-09-22T04:00:00.000Z',
    decidedByDisplayName: '运营甲',
    archiveType: 'NO_EVIDENCE',
    archivedAt: '2026-09-22T04:00:00.000Z',
  },
  capabilities: { review: false, confirmWithdrawal: false },
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

  it('decodes pending withdrawal and submits confirmation with version and key', async () => {
    const pending = {
      ...archivedLead,
      pendingWithdrawalApplication: {
        id: 'application-1',
        reason: '补充证据',
        applicantDisplayName: '运营甲',
        appliedAt: '2026-09-22T04:00:00.000Z',
      },
      history: [
        {
          kind: 'WITHDRAWAL_APPLICATION',
          id: 'application-1',
          fromVersion: 3,
          toVersion: 4,
          occurredAt: '2026-09-22T04:00:00.000Z',
          reason: '补充证据',
          applicantDisplayName: '运营甲',
        },
      ],
      version: 4,
      capabilities: { review: false, confirmWithdrawal: true },
    };
    http.getJson.mockResolvedValue(pending);
    await expect(getClientLead('lead-1')).resolves.toMatchObject({
      pendingWithdrawalApplication: { applicantDisplayName: '运营甲' },
      capabilities: { confirmWithdrawal: true },
    });
    http.getJson.mockResolvedValue({
      items: [pending],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await expect(listClientLeads('PENDING')).resolves.toMatchObject({
      items: [pending],
    });
    await expect(listClientLeads('PROCESSED')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    http.requestJson.mockResolvedValue({
      id: 'confirmation-1',
      applicationId: 'application-1',
      leadId: 'lead-1',
      status: 'WAITING_REVIEW',
      version: 5,
      confirmedByDisplayName: '客户甲',
      confirmedAt: '2026-09-22T05:00:00.000Z',
    });
    await expect(
      confirmClientLeadWithdrawal('lead-1', 'application-1', 4, 'confirm-key'),
    ).resolves.toMatchObject({ status: 'WAITING_REVIEW', version: 5 });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/client/leads/lead-1/withdrawal-confirmations',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'confirm-key' },
        body: { applicationId: 'application-1', expectedVersion: 4 },
      },
    );
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

  it('decodes archived no-infringement projections and rejects malformed archive facts', async () => {
    http.getJson.mockResolvedValue({
      items: [archivedLead],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await expect(listClientLeads('PROCESSED')).resolves.toMatchObject({
      items: [archivedLead],
    });
    http.getJson.mockResolvedValue(archivedLead);
    await expect(getClientLead('lead-1')).resolves.toMatchObject(archivedLead);
    for (const reviewDecision of [
      { ...archivedLead.reviewDecision, reason: '  ' },
      {
        result: 'NO_INFRINGEMENT',
        reason: '原因',
        reviewerDisplayName: '甲',
        decidedAt: archivedLead.reviewDecision.decidedAt,
        archiveType: 'NO_INFRINGEMENT',
      },
      { ...archivedLead.reviewDecision, archiveType: 'OTHER' },
    ]) {
      http.getJson.mockResolvedValue({ ...archivedLead, reviewDecision });
      await expect(getClientLead('lead-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });

  it('decodes only the safe no-evidence decision projection for a processed client', async () => {
    http.getJson.mockResolvedValue(noEvidenceLead);
    await expect(getClientLead('lead-1')).resolves.toMatchObject({
      evidenceDecision: noEvidenceLead.evidenceDecision,
    });
    http.getJson.mockResolvedValue({
      ...noEvidenceLead,
      evidenceDecision: {
        ...noEvidenceLead.evidenceDecision,
        decidedByUserId: 'internal-user',
      },
    });
    await expect(getClientLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes safe evidence-decision history and rejects incomplete event facts', async () => {
    const evidenceHistory = {
      kind: 'EVIDENCE_DECISION',
      id: 'decision-1',
      fromVersion: 3,
      toVersion: 4,
      occurredAt: '2026-09-22T04:00:00.000Z',
      result: 'NO_EVIDENCE',
      reason: '现阶段不取证',
      decidedByDisplayName: '运营甲',
      archiveType: 'NO_EVIDENCE',
      archivedAt: '2026-09-22T04:00:00.000Z',
    };
    http.getJson.mockResolvedValueOnce({
      ...noEvidenceLead,
      history: [evidenceHistory],
    });
    await expect(getClientLead('lead-1')).resolves.toMatchObject({
      history: [evidenceHistory],
    });
    for (const history of [
      { ...evidenceHistory, result: 'NO_INFRINGEMENT' },
      { ...evidenceHistory, reason: undefined },
      { ...evidenceHistory, decidedByDisplayName: undefined },
      { ...evidenceHistory, archiveType: 'OTHER' },
      { ...evidenceHistory, archivedAt: undefined },
    ]) {
      http.getJson.mockResolvedValueOnce({
        ...noEvidenceLead,
        history: [history],
      });
      await expect(getClientLead('lead-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
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

  it('submits a trimmed no-infringement reason through the shared request layer', async () => {
    http.requestJson.mockResolvedValue({
      id: lead.id,
      businessNo: lead.businessNo,
      status: 'ARCHIVED',
      version: 3,
      reviewDecision: {
        ...archivedLead.reviewDecision,
        reason: '经核对未使用我司标识',
      },
    });
    await expect(
      reviewClientLeadNoInfringement(
        'lead/1',
        2,
        '  经核对未使用我司标识  ',
        'archive-key',
        { headers: { 'X-CSRF-Test': 'token' } },
      ),
    ).resolves.toMatchObject({
      status: 'ARCHIVED',
      reviewDecision: { result: 'NO_INFRINGEMENT' },
    });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/client/leads/lead%2F1/reviews',
      {
        method: 'POST',
        headers: { 'X-CSRF-Test': 'token', 'Idempotency-Key': 'archive-key' },
        body: {
          result: 'NO_INFRINGEMENT',
          reason: '经核对未使用我司标识',
          expectedVersion: 2,
        },
      },
    );
    http.requestJson.mockResolvedValueOnce({
      id: lead.id,
      businessNo: lead.businessNo,
      status: 'ARCHIVED',
      version: 3,
      reviewDecision: { ...archivedLead.reviewDecision, reason: ' ' },
    });
    await expect(
      reviewClientLeadNoInfringement('lead-1', 2, '原因', 'key'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
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
