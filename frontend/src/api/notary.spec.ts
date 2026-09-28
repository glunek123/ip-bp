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
  listNotaryMatters,
  recordNotaryOpening,
  recordNotaryEvidence,
  reviewNotaryOpening,
  decideNotaryIssuance,
} from './notary';

const matter = {
  id: 'matter-1',
  businessNo: 'NT-20260924-001',
  leadId: 'lead-1',
  leadStatus: 'TRANSFERRED_TO_NOTARY',
  leadVersion: 4,
  stage: 'PENDING_EVIDENCE',
  version: 2,
  capabilities: {
    recordEvidence: true,
    recordOpening: false,
    reviewOpening: false,
    decideIssuance: false,
  },
  evidence: null,
  opening: null,
  reviewDecision: null,
  issuanceDecision: null,
  notaryOffice: { id: 'office-1', name: '广州市南方公证处' },
  selectedProductIds: ['product-1'],
  selectedContentVersionIds: ['content-1'],
  evidenceMode: 'ONLINE_PURCHASE',
  batchPurpose: '首批线上取证',
  createdAt: '2026-09-24T01:00:00.000Z',
};

beforeEach(() => vi.resetAllMocks());

describe('notary API', () => {
  it('validates a scoped matter list and its stage counts', async () => {
    const result = {
      items: [
        {
          id: 'matter-1',
          businessNo: 'NT-001',
          stage: 'PENDING_EVIDENCE',
          createdAt: '2026-09-24T01:00:00.000Z',
          sourceLead: { id: 'lead-1', businessNo: 'LD-001' },
          notaryOffice: { id: 'office-1', name: '测试公证处' },
        },
      ],
      total: 1,
      page: 2,
      pageSize: 20,
      counts: {
        PENDING_EVIDENCE: 2,
        WAITING_UNBOX: 1,
        UNBOX_REVIEW: 0,
        ISSUANCE_DECISION: 0,
        WAITING_CERTIFICATE: 0,
        WAITING_RETURN: 0,
        ARCHIVED: 0,
      },
    };
    http.getJson.mockResolvedValue(result);
    await expect(
      listNotaryMatters(2, 20, {}, 'PENDING_EVIDENCE'),
    ).resolves.toEqual(result);
    expect(http.getJson).toHaveBeenCalledWith(
      '/notary-matters?page=2&pageSize=20&stage=PENDING_EVIDENCE',
      {},
    );
    http.getJson.mockResolvedValueOnce({
      ...result,
      counts: { PENDING_EVIDENCE: 2 },
    });
    await expect(listNotaryMatters()).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('decodes persisted opening decisions and the new workflow stages strictly', async () => {
    const reviewed = {
      ...matter,
      stage: 'ISSUANCE_DECISION',
      version: 5,
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: true,
      },
      evidence: {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
        recordedAt: '2026-09-24T01:00:00.000Z',
        recordedByUserId: 'user-1',
        logistics: [
          {
            id: 'logistics-1',
            companyState: 'NONE',
            companyValue: null,
            trackingState: 'NONE',
            trackingValue: null,
          },
        ],
      },
      opening: {
        senderName: null,
        senderPhone: null,
        senderAddress: null,
        recordedAt: '2026-09-24T02:00:00.000Z',
        recordedByUserId: 'user-1',
        photos: [
          {
            materialId: 'photo-1',
            contentVersionId: 'photo-v1',
            originalFilename: '开箱.jpg',
            mimeType: 'image/jpeg',
          },
        ],
      },
      reviewDecision: {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'INTERNAL',
        actorDisplayName: '运营甲',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: null,
      },
      sourceLead: { id: 'lead-1', businessNo: 'LD-001' },
      selectedProducts: [
        {
          id: 'product-1',
          position: 1,
          url: null,
          title: '商品甲',
          quantity: 1,
          unitPrice: '9.00',
          commentCount: 0,
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
    };
    http.getJson.mockResolvedValue(reviewed);
    await expect(getNotaryMatter('matter-1')).resolves.toMatchObject({
      stage: 'ISSUANCE_DECISION',
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: true,
      },
      issuanceDecision: null,
      reviewDecision: { result: 'INFRINGEMENT' },
    });

    http.getJson.mockResolvedValueOnce({
      ...reviewed,
      reviewDecision: { ...reviewed.reviewDecision, result: 'UNKNOWN' },
    });
    await expect(getNotaryMatter('matter-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    http.getJson.mockResolvedValueOnce({
      ...reviewed,
      stage: 'ARCHIVED',
      reviewDecision: {
        ...reviewed.reviewDecision,
        result: 'NO_INFRINGEMENT',
        reason: null,
        archivedAt: '2026-09-24T03:00:00.000Z',
      },
    });
    await expect(getNotaryMatter('matter-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('submits an explicit opening result with expected version and idempotency key', async () => {
    const result = {
      id: 'matter-1',
      stage: 'ARCHIVED',
      version: 6,
      reviewDecision: {
        result: 'NO_INFRINGEMENT',
        reason: '未发现侵权',
        actorKind: 'INTERNAL',
        actorDisplayName: '运营甲',
        decidedAt: '2026-09-24T03:00:00.000Z',
        archivedAt: '2026-09-24T03:00:00.000Z',
      },
    };
    http.requestJson.mockResolvedValue(result);
    await expect(
      reviewNotaryOpening(
        'matter-1',
        {
          result: 'NO_INFRINGEMENT',
          reason: ' 未发现侵权 ',
          expectedVersion: 5,
        },
        'key-1',
      ),
    ).resolves.toEqual(result);
    expect(http.requestJson).toHaveBeenCalledWith(
      '/notary-matters/matter-1/opening-review',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'key-1' },
        body: {
          result: 'NO_INFRINGEMENT',
          reason: '未发现侵权',
          expectedVersion: 5,
        },
      },
    );
    await expect(
      reviewNotaryOpening(
        'matter-1',
        { result: 'NO_INFRINGEMENT', reason: ' ', expectedVersion: 5 },
        'key-2',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    http.requestJson.mockResolvedValueOnce({
      ...result,
      reviewDecision: { ...result.reviewDecision, actorKind: 'CLIENT' },
    });
    await expect(
      reviewNotaryOpening(
        'matter-1',
        { result: 'NO_INFRINGEMENT', reason: '未发现侵权', expectedVersion: 5 },
        'key-2',
      ),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('submits an issuance choice with version and idempotency key', async () => {
    const result = {
      id: 'matter-1',
      stage: 'WAITING_CERTIFICATE',
      version: 6,
      issuanceDecision: {
        decision: 'ISSUE',
        actorDisplayName: '运营甲',
        decidedAt: '2026-09-24T04:00:00.000Z',
      },
    };
    http.requestJson.mockResolvedValue(result);
    await expect(
      decideNotaryIssuance(
        'matter-1',
        { decision: 'ISSUE', expectedVersion: 5 },
        'key-issue',
      ),
    ).resolves.toEqual(result);
    expect(http.requestJson).toHaveBeenCalledWith(
      '/notary-matters/matter-1/issuance-decision',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'key-issue' },
        body: { decision: 'ISSUE', expectedVersion: 5 },
      },
    );
  });
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

  it('loads the evidence capability and persisted evidence contract', async () => {
    const logistics = [
      {
        id: 'logistics-1',
        companyState: 'PRESENT',
        companyValue: '顺丰',
        trackingState: 'NONE',
        trackingValue: null,
      },
    ];
    http.getJson.mockResolvedValue({
      ...matter,
      version: 2,
      capabilities: {
        recordEvidence: true,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
      },
      reviewDecision: null,
      evidence: null,
      opening: null,
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
    await expect(getNotaryMatter('matter-1')).resolves.toMatchObject({
      version: 2,
      capabilities: {
        recordEvidence: true,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
      },
      reviewDecision: null,
      evidence: null,
    });
    http.getJson.mockResolvedValueOnce({
      ...matter,
      version: 3,
      stage: 'WAITING_UNBOX',
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
      },
      reviewDecision: null,
      evidence: {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
        recordedAt: '2026-09-24T02:00:00.000Z',
        recordedByUserId: 'user-1',
        logistics,
      },
      opening: null,
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
    await expect(getNotaryMatter('matter-1')).resolves.toMatchObject({
      stage: 'WAITING_UNBOX',
      evidence: { logistics },
    });
  });

  it('strictly decodes persisted opening photos and the review stage', async () => {
    const opening = {
      senderName: '寄件人甲',
      senderPhone: null,
      senderAddress: '广州市',
      recordedAt: '2026-09-24T02:00:00.000Z',
      recordedByUserId: 'user-1',
      photos: [
        {
          materialId: 'photo-1',
          contentVersionId: 'photo-v1',
          originalFilename: '开箱.jpg',
          mimeType: 'image/jpeg',
        },
      ],
    };
    http.getJson.mockResolvedValue({
      ...matter,
      stage: 'UNBOX_REVIEW',
      version: 4,
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
      },
      reviewDecision: null,
      evidence: {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
        recordedAt: '2026-09-24T01:00:00.000Z',
        recordedByUserId: 'user-1',
        logistics: [
          {
            id: 'logistics-1',
            companyState: 'NONE',
            companyValue: null,
            trackingState: 'NONE',
            trackingValue: null,
          },
        ],
      },
      opening,
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
    await expect(getNotaryMatter('matter-1')).resolves.toMatchObject({
      stage: 'UNBOX_REVIEW',
      capabilities: { recordOpening: false },
      opening,
    });
    http.getJson.mockResolvedValueOnce({
      ...matter,
      stage: 'UNBOX_REVIEW',
      capabilities: {
        recordEvidence: false,
        recordOpening: false,
        reviewOpening: false,
        decideIssuance: false,
      },
      reviewDecision: null,
      opening: { ...opening, photos: [{ ...opening.photos[0], mimeType: 42 }] },
      sourceLead: { id: 'lead-1', businessNo: 'LD-20260921-001' },
      selectedProducts: [],
      selectedMaterials: [],
    });
    await expect(getNotaryMatter('matter-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('records opening content version ids with idempotency and checks the transition', async () => {
    const input = {
      expectedVersion: 3,
      contentVersionIds: ['photo-v1'],
      senderName: '寄件人甲',
    };
    const opening = {
      senderName: '寄件人甲',
      senderPhone: null,
      senderAddress: null,
      recordedAt: '2026-09-24T02:00:00.000Z',
      recordedByUserId: 'user-1',
      photos: [{ materialId: 'photo-1', contentVersionId: 'photo-v1' }],
    };
    const result = {
      id: 'matter-1',
      stage: 'UNBOX_REVIEW',
      version: 4,
      opening,
    };
    http.requestJson.mockResolvedValue(result);
    await expect(
      recordNotaryOpening('matter-1', input, 'opening-key'),
    ).resolves.toEqual(result);
    expect(http.requestJson).toHaveBeenCalledWith(
      '/notary-matters/matter-1/opening',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'opening-key' },
        body: input,
      },
    );
  });

  it('records evidence with the idempotency key and validates the transition response', async () => {
    const input = {
      evidenceAt: '2026-09-24',
      sampleFeeState: 'KNOWN' as const,
      sampleFeeAmount: '0.00',
      logistics: [
        {
          companyState: 'PRESENT' as const,
          companyValue: '顺丰',
          trackingState: 'NONE' as const,
          trackingValue: null,
        },
      ],
      expectedVersion: 2,
    };
    const result = {
      id: 'matter-1',
      stage: 'WAITING_UNBOX',
      version: 3,
      evidence: {
        evidenceAt: input.evidenceAt,
        sampleFeeState: input.sampleFeeState,
        sampleFeeAmount: input.sampleFeeAmount,
        recordedAt: '2026-09-24T02:00:00.000Z',
        recordedByUserId: 'user-1',
        logistics: [{ id: 'logistics-1', ...input.logistics[0] }],
      },
    };
    http.requestJson.mockResolvedValue(result);
    await expect(
      recordNotaryEvidence('matter-1', input, 'evidence-key'),
    ).resolves.toEqual(result);
    expect(http.requestJson).toHaveBeenCalledWith(
      '/notary-matters/matter-1/evidence',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'evidence-key' },
        body: { ...input, logistics: input.logistics },
      },
    );
  });

  it('omits sample fee amount when the fee is pending', async () => {
    http.requestJson.mockResolvedValue({
      id: 'matter-1',
      stage: 'WAITING_UNBOX',
      version: 3,
      evidence: {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'PENDING',
        sampleFeeAmount: null,
        recordedAt: '2026-09-24T02:00:00.000Z',
        recordedByUserId: 'user-1',
        logistics: [
          {
            id: 'logistics-1',
            companyState: 'NONE',
            companyValue: null,
            trackingState: 'NONE',
            trackingValue: null,
          },
        ],
      },
    });
    await recordNotaryEvidence(
      'matter-1',
      {
        evidenceAt: '2026-09-24',
        sampleFeeState: 'PENDING',
        expectedVersion: 2,
        logistics: [
          {
            companyState: 'NONE',
            companyValue: null,
            trackingState: 'NONE',
            trackingValue: null,
          },
        ],
      },
      'pending-key',
    );
    expect(http.requestJson).toHaveBeenCalledWith(
      '/notary-matters/matter-1/evidence',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': 'pending-key' },
        body: {
          evidenceAt: '2026-09-24',
          sampleFeeState: 'PENDING',
          expectedVersion: 2,
          logistics: [
            {
              companyState: 'NONE',
              companyValue: null,
              trackingState: 'NONE',
              trackingValue: null,
            },
          ],
        },
      },
    );
  });
});
