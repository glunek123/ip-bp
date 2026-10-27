import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './http';

const http = vi.hoisted(() => ({ getJson: vi.fn(), requestJson: vi.fn() }));
vi.mock('./http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./http')>()),
  getJson: http.getJson,
  requestJson: http.requestJson,
}));

import {
  type LeadBusinessResult,
  type LeadCsvImportItem,
  type LeadCsvImportInput,
  createLead,
  getLead,
  getLeadEditContext,
  getLeadFormContext,
  importLeadCsvBatch,
  listLeads,
  listLeadFilterOptions,
  pushLead,
  pushLeadsBatch,
  applyLeadWithdrawal,
  decideLeadNoEvidence,
  updateLead,
  updateLeadProductScreenshots,
} from './leads';

const option = (value: string, label = value) => ({ value, label });
const context = {
  operators: [
    { id: 'user-1', displayName: '运营甲', username: 'operator.one' },
  ],
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
  displayNames: {
    customerName: '客户甲',
    rightsHolderName: '主体甲',
    responsibleUserName: '运营甲',
  },
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
      screenshotContentVersionIds: [],
    },
  ],
  leadScreenshotContentVersionIds: ['version-1'],
  version: 1,
  pushedAt: null,
  pushedByUserId: null,
  pushedByDisplayName: null,
  reviewDecision: null,
  evidenceDecision: null,
  pendingWithdrawalApplication: null,
  history: [],
  notaryMatters: [],
  capabilities: {
    edit: true,
    push: true,
    withdrawApply: false,
    evidenceDecide: false,
    transferToNotary: false,
    createEvidenceBatch: false,
  },
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

function csvImportInput(): LeadCsvImportInput {
  return {
    ...createInput,
    infringementTypes: [...createInput.infringementTypes],
    products: createInput.products.map((product) => ({ ...product })),
    leadScreenshotContentVersionIds: [],
  };
}

function csvImportItem(rowNumber: number): LeadCsvImportItem {
  return { rowNumber, input: csvImportInput() };
}

function csvLeadResult(
  id: string,
  input: LeadCsvImportInput,
): LeadBusinessResult & { evidenceDecision: null } {
  return {
    id,
    businessNo: `LD-CSV-${id}`,
    departmentId: 'department-1',
    customerId: input.customerId,
    rightsHolderId: input.rightsHolderId,
    responsibleUserId: 'user-1',
    teamId: null,
    status: 'WAITING_PUSH',
    caseType: input.caseType,
    infringementTypes: [...input.infringementTypes],
    source: input.source,
    platform: input.platform,
    foundAt: input.foundAt,
    shopName: input.shopName,
    shopExternalId: input.shopExternalId ?? null,
    needDisclose: input.needDisclose,
    remark: input.remark ?? null,
    creationChannel: 'CSV',
    externalSourceRef: null,
    products: input.products.map((product, index) => ({
      id: `${id}-product-${index + 1}`,
      position: index + 1,
      url: product.url ?? null,
      title: product.title ?? null,
      quantity: product.quantity,
      unitPrice: product.unitPrice,
      commentCount: product.commentCount,
      estimatedAmount: '4.65',
      screenshotContentVersionIds: [],
    })),
    leadScreenshotContentVersionIds: [],
    version: 1,
    pushedAt: null,
    pushedByUserId: null,
    pushedByDisplayName: null,
    reviewDecision: null,
    evidenceDecision: null,
    createdAt: '2026-09-21T04:00:00.000Z',
    updatedAt: '2026-09-21T04:00:00.000Z',
  };
}

beforeEach(() => vi.resetAllMocks());

describe('internal lead display names', () => {
  it('rejects a missing or overbroad name projection on a read', async () => {
    const legacy: Partial<typeof lead> = { ...lead };
    delete legacy.displayNames;
    http.getJson.mockResolvedValueOnce(legacy);
    await expect(getLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    http.getJson.mockResolvedValueOnce({
      ...lead,
      displayNames: { ...lead.displayNames, phone: 'private' },
    });
    await expect(getLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('keeps a legacy creation receipt valid without adding fake names', async () => {
    const legacy: Partial<typeof lead> = { ...lead };
    delete legacy.displayNames;
    http.requestJson.mockResolvedValue(legacy);
    const result = await createLead(
      {
        customerId: lead.customerId,
        rightsHolderId: lead.rightsHolderId,
        caseType: 'CIVIL',
        infringementTypes: ['TRADEMARK'],
        source: 'ONLINE',
        platform: 'TAOBAO',
        foundAt: lead.foundAt,
        shopName: lead.shopName,
        needDisclose: false,
        products: [
          { title: '商品', quantity: 3, unitPrice: '1.55', commentCount: 9 },
        ],
        leadScreenshotContentVersionIds: [],
      },
      'original-key',
    );
    expect(result).toEqual(legacy);
    expect(result).not.toHaveProperty('displayNames');
  });
  it('encodes scoped search choices and rejects malformed option responses', async () => {
    http.getJson.mockResolvedValueOnce({
      items: [{ id: 'customer-1', name: '客户甲' }],
    });
    await expect(
      listLeadFilterOptions(
        'customer',
        '甲 &',
        {},
        {
          view: 'LIBRARY',
          status: 'WAITING_PUSH',
        },
      ),
    ).resolves.toEqual({ items: [{ id: 'customer-1', name: '客户甲' }] });
    expect(http.getJson).toHaveBeenCalledWith(
      '/leads/filter-options?kind=customer&q=%E7%94%B2+%26&view=LIBRARY&status=WAITING_PUSH',
      {},
    );
    http.getJson.mockResolvedValueOnce({ items: [{ id: 1, name: 'bad' }] });
    await expect(
      listLeadFilterOptions('rightsHolder', ''),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('Lead API', () => {
  it('writes exact product screenshot versions with the current lead version', async () => {
    http.requestJson.mockResolvedValueOnce(lead);
    await expect(
      updateLeadProductScreenshots('lead-1', 'product-1', {
        expectedVersion: 3,
        screenshotContentVersionIds: ['version-a', 'version-b'],
      }),
    ).resolves.toMatchObject({ id: 'lead-1' });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/leads/lead-1/products/product-1/screenshots',
      {
        method: 'PUT',
        body: {
          expectedVersion: 3,
          screenshotContentVersionIds: ['version-a', 'version-b'],
        },
      },
    );
  });
  it('encodes a trimmed keyword with stage and pagination and validates length before HTTP', async () => {
    http.getJson.mockResolvedValue({
      items: [],
      total: 0,
      page: 2,
      pageSize: 20,
      counts: {
        WAITING_PUSH: 0,
        WAITING_REVIEW: 0,
        WAITING_EVIDENCE_DECISION: 0,
        TRANSFERRED_TO_NOTARY: 0,
        ARCHIVED: 0,
      },
      capabilities: { create: false },
    });
    await listLeads(2, 20, {}, 'WAITING_PUSH', 'LIBRARY', ' 商品 & 编号 ');
    const url = new URL(
      http.getJson.mock.calls[0]?.[0],
      'https://example.test',
    );
    expect(url.searchParams.get('q')).toBe('商品 & 编号');
    expect(url.searchParams.get('status')).toBe('WAITING_PUSH');
    expect(url.searchParams.get('page')).toBe('2');
    await listLeads(2, 20, {}, undefined, 'LIBRARY', ' ');
    expect(http.getJson.mock.calls[1]?.[0]).not.toContain('&q=');
    await expect(
      listLeads(1, 20, {}, undefined, 'LIBRARY', '字'.repeat(201)),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(http.getJson).toHaveBeenCalledTimes(2);
  });
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
        TRANSFERRED_TO_NOTARY: 0,
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
      'TRANSFERRED_TO_NOTARY',
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
        TRANSFERRED_TO_NOTARY: 0,
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

  it('requests the library projection without changing the default list', async () => {
    http.getJson.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 1,
      counts: {
        WAITING_PUSH: 0,
        WAITING_REVIEW: 0,
        WAITING_EVIDENCE_DECISION: 0,
        TRANSFERRED_TO_NOTARY: 0,
        ARCHIVED: 0,
      },
      capabilities: { create: false },
    });
    await listLeads(1, 1, {}, undefined, 'LIBRARY');
    expect(http.getJson).toHaveBeenCalledWith(
      '/leads?page=1&pageSize=1&view=LIBRARY',
      {},
    );
  });

  it('requires a server edit capability on details', async () => {
    http.getJson.mockResolvedValue({
      ...lead,
      capabilities: {
        ...lead.capabilities,
        edit: false,
        push: true,
        withdrawApply: false,
        evidenceDecide: false,
      },
    });
    await expect(getLead('lead-1')).resolves.toMatchObject({
      capabilities: { edit: false, push: true },
    });
    http.getJson.mockResolvedValueOnce({
      ...lead,
      capabilities: {
        edit: true,
        push: true,
        withdrawApply: false,
        evidenceDecide: false,
      },
    });
    await expect(getLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes lead notary summaries for every supported matter stage', async () => {
    const stages = [
      'PENDING_EVIDENCE',
      'WAITING_UNBOX',
      'UNBOX_REVIEW',
      'ISSUANCE_DECISION',
      'ARCHIVED',
    ] as const;
    const notaryMatters = stages.map((stage, index) => ({
      id: `notary-${index + 1}`,
      businessNo: `NT-20260928-${String(index + 1).padStart(3, '0')}`,
      stage,
      notaryOfficeName: '测试公证处',
      batchPurpose: '批次用途',
      createdAt: '2026-09-21T04:00:00.000Z',
    }));

    http.getJson.mockResolvedValueOnce({ ...lead, notaryMatters });
    await expect(getLead('lead-1')).resolves.toMatchObject({ notaryMatters });

    http.getJson.mockResolvedValueOnce({
      ...lead,
      notaryMatters: [{ ...notaryMatters[0], stage: 'UNKNOWN_STAGE' }],
    });
    await expect(getLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes withdrawal state and sends an idempotent application request', async () => {
    const detail = {
      ...lead,
      status: 'ARCHIVED',
      version: 4,
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        reason: '旧结论',
        reviewerDisplayName: '客户审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
        archiveType: 'NO_INFRINGEMENT',
        archivedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: {
        ...lead.capabilities,
        edit: false,
        push: false,
        withdrawApply: true,
        evidenceDecide: false,
      },
      pendingWithdrawalApplication: null,
      history: [],
    };
    http.getJson.mockResolvedValue(detail);
    await expect(getLead('lead-1')).resolves.toMatchObject({
      capabilities: { withdrawApply: true },
      history: [],
    });

    http.requestJson.mockResolvedValue({
      id: 'application-1',
      leadId: 'lead-1',
      status: 'ARCHIVED',
      version: 5,
      reason: '补充证据',
      applicantDisplayName: '运营甲',
      appliedAt: '2026-09-23T01:00:00.000Z',
    });
    await expect(
      applyLeadWithdrawal('lead-1', '补充证据', 4, 'withdraw-key'),
    ).resolves.toMatchObject({ version: 5, status: 'ARCHIVED' });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/leads/lead-1/withdrawal-applications',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'withdraw-key' },
        body: { reason: '补充证据', expectedVersion: 4 },
      },
    );
  });

  it('reads a formal client review from the immutable display-name snapshot', async () => {
    const reviewed = {
      ...lead,
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      pushedAt: '2026-09-22T02:00:00.000Z',
      pushedByUserId: 'operator-1',
      pushedByDisplayName: '运营甲',
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: {
        ...lead.capabilities,
        edit: false,
        push: false,
        withdrawApply: false,
        evidenceDecide: false,
      },
    };
    http.getJson.mockResolvedValue(reviewed);
    await expect(getLead('lead-1')).resolves.toMatchObject({
      reviewDecision: reviewed.reviewDecision,
    });
    http.getJson.mockResolvedValue({
      ...reviewed,
      reviewDecision: {
        ...reviewed.reviewDecision,
        reviewerUserId: 'internal',
      },
    });
    await expect(getLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes the exact no-infringement archive facts for operators', async () => {
    const archived = {
      ...lead,
      status: 'ARCHIVED',
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        reason: '经核对未使用我司标识',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
        archiveType: 'NO_INFRINGEMENT',
        archivedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: {
        ...lead.capabilities,
        edit: false,
        push: false,
        withdrawApply: false,
        evidenceDecide: false,
      },
    };
    http.getJson.mockResolvedValueOnce({
      ...archived,
      reviewDecision: { ...archived.reviewDecision, archivedAt: undefined },
    });
    await expect(getLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    http.getJson.mockResolvedValueOnce(archived);
    await expect(getLead('lead-1')).resolves.toMatchObject({
      reviewDecision: archived.reviewDecision,
    });
  });

  it('decodes evidence-decision history only when its immutable facts are complete', async () => {
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
    const detail = {
      ...lead,
      status: 'ARCHIVED',
      version: 4,
      evidenceDecision: {
        result: 'NO_EVIDENCE',
        reason: '现阶段不取证',
        decidedAt: evidenceHistory.occurredAt,
        decidedByDisplayName: '运营甲',
        archiveType: 'NO_EVIDENCE',
        archivedAt: evidenceHistory.archivedAt,
      },
      history: [evidenceHistory],
      capabilities: {
        ...lead.capabilities,
        edit: false,
        push: false,
        withdrawApply: false,
        evidenceDecide: false,
      },
    };
    http.getJson.mockResolvedValueOnce(detail);
    await expect(getLead('lead-1')).resolves.toMatchObject({
      history: [evidenceHistory],
    });
    for (const history of [
      { ...evidenceHistory, result: 'NO_INFRINGEMENT' },
      { ...evidenceHistory, reason: undefined },
      { ...evidenceHistory, decidedByDisplayName: undefined },
      { ...evidenceHistory, archiveType: 'OTHER' },
      { ...evidenceHistory, archivedAt: undefined },
    ]) {
      http.getJson.mockResolvedValueOnce({ ...detail, history: [history] });
      await expect(getLead('lead-1')).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    }
  });

  it('submits and validates an idempotent no-evidence archive decision', async () => {
    http.requestJson.mockResolvedValue({
      id: 'decision-1',
      leadId: 'lead/1',
      status: 'ARCHIVED',
      version: 4,
      result: 'NO_EVIDENCE',
      reason: '现阶段不取证',
      decidedByDisplayName: '运营甲',
      decidedAt: '2026-09-22T03:00:00.000Z',
      archiveType: 'NO_EVIDENCE',
      archivedAt: '2026-09-22T03:00:00.000Z',
    });
    await expect(
      decideLeadNoEvidence('lead/1', '  现阶段不取证  ', 3, 'evidence-key'),
    ).resolves.toMatchObject({ status: 'ARCHIVED', version: 4 });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/leads/lead%2F1/evidence-decisions',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'evidence-key' },
        body: {
          result: 'NO_EVIDENCE',
          reason: '现阶段不取证',
          expectedVersion: 3,
        },
      },
    );
    http.requestJson.mockResolvedValueOnce({
      id: 'decision-1',
      leadId: 'lead-1',
      status: 'ARCHIVED',
      version: 4,
      result: 'OTHER',
      reason: '现阶段不取证',
      decidedByDisplayName: '运营甲',
      decidedAt: '2026-09-22T03:00:00.000Z',
      archiveType: 'NO_EVIDENCE',
      archivedAt: '2026-09-22T03:00:00.000Z',
    });
    await expect(
      decideLeadNoEvidence('lead-1', '现阶段不取证', 3, 'evidence-key'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects impossible response facts instead of trusting typed-looking fields', async () => {
    http.getJson.mockResolvedValueOnce({
      ...lead,
      products: [{ ...lead.products[0], quantity: -1 }],
      capabilities: {
        edit: true,
        push: true,
        withdrawApply: false,
        evidenceDecide: false,
      },
    });
    await expect(getLead('lead-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });

    http.getJson.mockResolvedValueOnce({
      ...lead,
      platform: 'MAP',
      capabilities: {
        edit: true,
        push: true,
        withdrawApply: false,
        evidenceDecide: false,
      },
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
      pushedByDisplayName: '运营甲',
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

  it('freezes batch body, preserves order, and disables automatic CSRF retries', async () => {
    const items = [
      { leadId: '11111111-1111-4111-8111-111111111111', expectedVersion: 3 },
    ];
    http.requestJson.mockResolvedValueOnce({
      items: [
        {
          id: items[0]!.leadId,
          businessNo: 'LD-1',
          status: 'WAITING_REVIEW',
          version: 4,
          pushedAt: '2026-09-22T02:00:00.000Z',
          pushedByUserId: 'user-1',
          pushedByDisplayName: 'Operator',
        },
      ],
    });
    await expect(
      pushLeadsBatch(items, 'batch-key', {
        signal: new AbortController().signal,
        headers: {
          'idempotency-key': 'caller-key',
          'IDEMPOTENCY-KEY': 'another-caller-key',
        },
      }),
    ).resolves.toMatchObject({ items: [{ version: 4 }] });
    expect(http.requestJson).toHaveBeenCalledWith(
      '/leads/batch-push',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Idempotency-Key': 'batch-key' },
        retryOnCsrfInvalid: false,
        body: { items },
      }),
    );
  });

  it('imports CSV rows in explicit order with a frozen body and caller options', async () => {
    const items = [csvImportItem(8), csvImportItem(3)];
    const expectedItems = [csvImportItem(8), csvImportItem(3)];
    const headers = {
      'X-Trace': 'before',
      'idempotency-key': 'caller-key',
    };
    const signal = new AbortController().signal;
    http.requestJson.mockResolvedValueOnce({
      items: [
        { rowNumber: 8, lead: csvLeadResult('csv-a', expectedItems[0]!.input) },
        { rowNumber: 3, lead: csvLeadResult('csv-b', expectedItems[1]!.input) },
      ],
    });

    const result = importLeadCsvBatch(items, 'fixed-key', {
      signal,
      timeoutMs: 1234,
      headers,
    });
    items[0]!.input.shopName = '调用后变更';
    items[0]!.input.products[0]!.quantity = 88;
    headers['X-Trace'] = 'after';
    await expect(result).resolves.toMatchObject({
      items: [
        { rowNumber: 8, lead: { id: 'csv-a', creationChannel: 'CSV' } },
        { rowNumber: 3, lead: { id: 'csv-b', creationChannel: 'CSV' } },
      ],
    });

    expect(http.requestJson).toHaveBeenCalledWith(
      '/leads/csv-import',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Idempotency-Key': 'fixed-key',
          'x-trace': 'before',
        },
        signal,
        timeoutMs: 1234,
        retryOnCsrfInvalid: false,
        body: {
          items: expectedItems.map((item) => ({
            rowNumber: item.rowNumber,
            input: item.input,
          })),
        },
      }),
    );
    expect(headers).toEqual({
      'X-Trace': 'after',
      'idempotency-key': 'caller-key',
    });
  });

  it('accepts the complete backend CSV projection for the initial response and same-key replay', async () => {
    const items = [csvImportItem(2)];
    const backendResponse = {
      items: [
        {
          rowNumber: 2,
          lead: csvLeadResult('csv-replay', items[0]!.input),
        },
      ],
    };
    http.requestJson
      .mockResolvedValueOnce(backendResponse)
      .mockResolvedValueOnce(backendResponse);

    const initial = await importLeadCsvBatch(items, 'same-csv-key');
    const replay = await importLeadCsvBatch(items, 'same-csv-key');

    expect(initial).toEqual(backendResponse);
    expect(replay).toEqual(initial);
    const expectedRequest = expect.objectContaining({
      method: 'POST',
      headers: { 'Idempotency-Key': 'same-csv-key' },
      body: {
        items: [{ rowNumber: 2, input: items[0]!.input }],
      },
      retryOnCsrfInvalid: false,
    });
    expect(http.requestJson).toHaveBeenNthCalledWith(
      1,
      '/leads/csv-import',
      expectedRequest,
    );
    expect(http.requestJson).toHaveBeenNthCalledWith(
      2,
      '/leads/csv-import',
      expectedRequest,
    );
  });

  it('rejects invalid CSV row bounds, duplicate rows, oversized batches and forbidden fields before sending', async () => {
    const valid = csvImportItem(2);
    const invalidItems: unknown[] = [
      [],
      Array.from({ length: 21 }, (_, index) => csvImportItem(index + 2)),
      [csvImportItem(1)],
      [csvImportItem(2_097_154)],
      [csvImportItem(2), csvImportItem(2)],
      [
        {
          ...valid,
          input: { ...valid.input, reservedLeadId: 'reserved-id' },
        },
      ],
      [
        {
          ...valid,
          input: {
            ...valid.input,
            leadScreenshotContentVersionIds: ['version-1'],
          },
        },
      ],
      [{ ...valid, unexpected: true }],
      [{ ...valid, input: { ...valid.input, unexpected: true } }],
    ];

    for (const items of invalidItems) {
      await expect(
        importLeadCsvBatch(items as readonly LeadCsvImportItem[], 'batch-key'),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    await expect(importLeadCsvBatch([valid], '  ')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(http.requestJson).not.toHaveBeenCalled();
  });

  it('enforces the 90 KiB serialized JSON limit using UTF-8 bytes', async () => {
    const item = csvImportItem(2);
    item.input.remark = '';
    const emptyRemarkBytes = new TextEncoder().encode(
      JSON.stringify({
        items: [{ rowNumber: item.rowNumber, input: item.input }],
      }),
    ).length;
    const remainingBytes = 92_160 - emptyRemarkBytes;
    const chineseCharacters = Math.floor(remainingBytes / 3);
    const asciiCharacters = remainingBytes % 3;
    item.input.remark =
      '界'.repeat(chineseCharacters) + 'a'.repeat(asciiCharacters);
    const exactBody = {
      items: [{ rowNumber: item.rowNumber, input: item.input }],
    };
    expect(new TextEncoder().encode(JSON.stringify(exactBody)).length).toBe(
      92_160,
    );

    http.requestJson.mockResolvedValueOnce({
      items: [{ rowNumber: 2, lead: csvLeadResult('csv-exact', item.input) }],
    });
    await expect(
      importLeadCsvBatch([item], 'batch-key'),
    ).resolves.toMatchObject({
      items: [{ rowNumber: 2, lead: { id: 'csv-exact' } }],
    });

    const oversizedItem = csvImportItem(2);
    oversizedItem.input.remark = '界'.repeat(chineseCharacters + 1);
    await expect(
      importLeadCsvBatch([oversizedItem], 'batch-key'),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: expect.stringContaining('90KiB'),
    });
    expect(http.requestJson).toHaveBeenCalledTimes(1);
  });

  it('strictly validates CSV result shape, row order, source, initial state and unique IDs', async () => {
    const items = [csvImportItem(8), csvImportItem(3)];
    const validResponse = {
      items: items.map((item, index) => ({
        rowNumber: item.rowNumber,
        lead: csvLeadResult(`csv-${index}`, item.input),
      })),
    };
    http.requestJson.mockResolvedValueOnce(validResponse);
    await expect(importLeadCsvBatch(items, 'batch-key')).resolves.toEqual(
      validResponse,
    );

    const firstLead = csvLeadResult('csv-a', items[0]!.input);
    const secondLead = csvLeadResult('csv-b', items[1]!.input);
    const leadWithoutEvidenceDecision: Partial<typeof firstLead> = {
      ...firstLead,
    };
    delete leadWithoutEvidenceDecision.evidenceDecision;
    const invalidResponses: unknown[] = [
      { ...validResponse, unexpected: true },
      {
        items: [
          { rowNumber: 8, lead: firstLead, unexpected: true },
          { rowNumber: 3, lead: secondLead },
        ],
      },
      {
        items: [
          { rowNumber: 8, lead: { ...firstLead, unexpected: true } },
          { rowNumber: 3, lead: secondLead },
        ],
      },
      {
        items: [
          { rowNumber: 8, lead: leadWithoutEvidenceDecision },
          { rowNumber: 3, lead: secondLead },
        ],
      },
      {
        items: [
          {
            rowNumber: 8,
            lead: { ...firstLead, evidenceDecision: { result: 'NO_EVIDENCE' } },
          },
          { rowNumber: 3, lead: secondLead },
        ],
      },
      {
        items: [
          { rowNumber: 3, lead: firstLead },
          { rowNumber: 8, lead: secondLead },
        ],
      },
      {
        items: [
          { rowNumber: 8, lead: { ...firstLead, creationChannel: 'MANUAL' } },
          { rowNumber: 3, lead: secondLead },
        ],
      },
      {
        items: [
          { rowNumber: 8, lead: { ...firstLead, status: 'WAITING_REVIEW' } },
          { rowNumber: 3, lead: secondLead },
        ],
      },
      {
        items: [
          { rowNumber: 8, lead: { ...firstLead, version: 2 } },
          { rowNumber: 3, lead: secondLead },
        ],
      },
      {
        items: [
          { rowNumber: 8, lead: firstLead },
          { rowNumber: 3, lead: { ...secondLead, id: firstLead.id } },
        ],
      },
    ];

    for (const response of invalidResponses) {
      http.requestJson.mockResolvedValueOnce(response);
      await expect(
        importLeadCsvBatch(items, 'batch-key'),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('matches CSV product prices by cents while preserving request text', async () => {
    for (const [submittedPrice, returnedPrice] of [
      ['1', '1.00'],
      ['1.5', '1.50'],
      ['1.50', '1.50'],
    ] as const) {
      const item = csvImportItem(2);
      item.input.products[0]!.unitPrice = submittedPrice;
      const resultLead = csvLeadResult('csv-price', item.input);
      resultLead.products[0]!.unitPrice = returnedPrice;
      http.requestJson.mockResolvedValueOnce({
        items: [{ rowNumber: item.rowNumber, lead: resultLead }],
      });

      await expect(
        importLeadCsvBatch([item], 'price-key'),
      ).resolves.toMatchObject({
        items: [
          {
            rowNumber: 2,
            lead: { products: [{ unitPrice: returnedPrice }] },
          },
        ],
      });
      expect(http.requestJson).toHaveBeenLastCalledWith(
        '/leads/csv-import',
        expect.objectContaining({
          body: {
            items: [
              {
                rowNumber: 2,
                input: expect.objectContaining({
                  products: [
                    expect.objectContaining({ unitPrice: submittedPrice }),
                  ],
                }),
              },
            ],
          },
        }),
      );
    }

    const item = csvImportItem(2);
    item.input.products[0]!.unitPrice = '1.5';
    const resultLead = csvLeadResult('csv-price-mismatch', item.input);
    resultLead.products[0]!.unitPrice = '1.51';
    http.requestJson.mockResolvedValueOnce({
      items: [{ rowNumber: item.rowNumber, lead: resultLead }],
    });
    await expect(importLeadCsvBatch([item], 'price-key')).rejects.toMatchObject(
      {
        code: 'INVALID_RESPONSE',
      },
    );
    expect(http.requestJson).toHaveBeenLastCalledWith(
      '/leads/csv-import',
      expect.objectContaining({
        body: {
          items: [
            {
              rowNumber: 2,
              input: expect.objectContaining({
                products: [expect.objectContaining({ unitPrice: '1.5' })],
              }),
            },
          ],
        },
      }),
    );
  });

  it('matches CSV infringement types as an exact set while preserving request order', async () => {
    const item = csvImportItem(2);
    item.input.infringementTypes = ['TRADEMARK', 'SOFTWARE_COPYRIGHT'];
    const resultLead = csvLeadResult('csv-infringements', item.input);
    resultLead.infringementTypes = ['SOFTWARE_COPYRIGHT', 'TRADEMARK'];
    http.requestJson.mockResolvedValueOnce({
      items: [{ rowNumber: item.rowNumber, lead: resultLead }],
    });

    await expect(
      importLeadCsvBatch([item], 'infringement-key'),
    ).resolves.toMatchObject({
      items: [
        {
          rowNumber: 2,
          lead: { infringementTypes: ['SOFTWARE_COPYRIGHT', 'TRADEMARK'] },
        },
      ],
    });
    expect(http.requestJson).toHaveBeenLastCalledWith(
      '/leads/csv-import',
      expect.objectContaining({
        body: {
          items: [
            {
              rowNumber: 2,
              input: expect.objectContaining({
                infringementTypes: ['TRADEMARK', 'SOFTWARE_COPYRIGHT'],
              }),
            },
          ],
        },
      }),
    );

    for (const invalidTypes of [
      ['SOFTWARE_COPYRIGHT'],
      ['SOFTWARE_COPYRIGHT', 'SOFTWARE_COPYRIGHT'],
    ] as const) {
      const invalidLead = csvLeadResult('csv-invalid-types', item.input);
      invalidLead.infringementTypes = [...invalidTypes];
      http.requestJson.mockResolvedValueOnce({
        items: [{ rowNumber: item.rowNumber, lead: invalidLead }],
      });
      await expect(
        importLeadCsvBatch([item], 'infringement-key'),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('matches backend-normalized timestamps and text without rewriting the request', async () => {
    const item = csvImportItem(2);
    item.input.foundAt = '2026-09-21T12:00:00+08:00';
    item.input.shopName = '\u3000Ａ店\u3000';
    item.input.shopExternalId = '\u3000ID-Ａ\u3000';
    item.input.remark = '\u3000备注Ａ\u3000';
    item.input.products[0]!.url = '\u3000https://example.com/Ａ\u3000';
    item.input.products[0]!.title = '\u3000商品Ａ\u3000';
    const resultLead = csvLeadResult('csv-normalized', item.input);
    resultLead.foundAt = '2026-09-21T04:00:00.000Z';
    resultLead.shopName = 'A店';
    resultLead.shopExternalId = 'ID-A';
    resultLead.remark = '备注A';
    resultLead.products[0]!.url = 'https://example.com/A';
    resultLead.products[0]!.title = '商品A';
    http.requestJson.mockResolvedValueOnce({
      items: [{ rowNumber: item.rowNumber, lead: resultLead }],
    });

    await expect(
      importLeadCsvBatch([item], 'normalization-key'),
    ).resolves.toMatchObject({
      items: [
        {
          rowNumber: 2,
          lead: {
            foundAt: '2026-09-21T04:00:00.000Z',
            shopName: 'A店',
            shopExternalId: 'ID-A',
            remark: '备注A',
            products: [{ url: 'https://example.com/A', title: '商品A' }],
          },
        },
      ],
    });
    expect(http.requestJson).toHaveBeenLastCalledWith(
      '/leads/csv-import',
      expect.objectContaining({
        body: { items: [{ rowNumber: 2, input: item.input }] },
      }),
    );

    const mismatchLead = csvLeadResult(
      'csv-normalization-mismatch',
      item.input,
    );
    mismatchLead.foundAt = '2026-09-21T04:01:00.000Z';
    mismatchLead.shopName = 'A店';
    mismatchLead.shopExternalId = 'ID-A';
    mismatchLead.remark = '备注A';
    mismatchLead.products[0]!.url = 'https://example.com/A';
    mismatchLead.products[0]!.title = '商品A';
    http.requestJson.mockResolvedValueOnce({
      items: [{ rowNumber: item.rowNumber, lead: mismatchLead }],
    });
    await expect(
      importLeadCsvBatch([item], 'normalization-key'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('propagates aborted and unknown request outcomes without inventing a result', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    http.requestJson.mockRejectedValueOnce(abortError);
    await expect(
      importLeadCsvBatch([csvImportItem(2)], 'batch-key', {
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(abortError);

    http.requestJson.mockResolvedValueOnce({ items: [] });
    await expect(
      importLeadCsvBatch([csvImportItem(2)], 'batch-key'),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});
