import { NotaryPortalService } from './notary-portal.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
  notaryOfficeId: '33333333-3333-4333-8333-333333333333',
};

function fixture() {
  const db = {
    notaryOfficeAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({ id: 'binding-1' }),
    },
    notaryMatter: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
    },
    materialReference: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { db, service: new NotaryPortalService(db as never) };
}

describe('NotaryPortalService', () => {
  it('lists archived records only when this office has an issued certificate', async () => {
    const f = fixture();
    await f.service.list(actor, 1, 20, 'ARCHIVED');
    expect(f.db.notaryMatter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          notaryOfficeId: actor.notaryOfficeId,
          stage: 'ARCHIVED',
          certificate: { isNot: null },
        }),
      }),
    );
  });

  it('shows only frozen certificate files in an archived office detail', async () => {
    const f = fixture();
    f.db.notaryMatter.findFirst.mockResolvedValue({
      id: 'matter-1',
      businessNo: 'NT-1',
      stage: 'ARCHIVED',
      version: 6,
      createdAt: new Date('2026-09-28T01:00:00.000Z'),
      evidence: {
        evidenceAt: new Date('2026-09-27T00:00:00.000Z'),
        sampleFeeState: 'KNOWN',
        sampleFeeAmount: { toString: () => '200.00' },
        logistics: [{ id: 'logistics-1', trackingValue: 'private-tracking' }],
      },
      opening: {
        senderName: 'private-sender',
        senderPhone: 'private-phone',
        senderAddress: 'private-address',
        recordedAt: new Date('2026-09-28T02:00:00.000Z'),
      },
      issuanceDecision: {
        decision: 'ISSUE',
        actorDisplayNameSnapshot: '运营',
        decidedAt: new Date('2026-09-28T02:00:00.000Z'),
      },
      certificate: {
        certificateNo: '2026-001',
        certificateDate: new Date('2026-09-28T00:00:00.000Z'),
        issuedAt: new Date('2026-09-28T03:00:00.000Z'),
        needDisclose: false,
        case: { id: 'case-1', businessNo: 'CA-1' },
      },
    });
    f.db.materialReference.findMany.mockResolvedValue([
      {
        purpose: 'NOTARY_CERTIFICATE',
        materialId: 'material-1',
        contentVersionId: 'version-1',
        contentVersion: {
          originalFilename: '证书.pdf',
          mimeType: 'application/pdf',
        },
        actionEvent: { details: { contentVersionIds: ['version-1'] } },
      },
      {
        purpose: 'NOTARY_CERTIFICATE',
        materialId: 'material-2',
        contentVersionId: 'draft-2',
        contentVersion: {
          originalFilename: '草稿.pdf',
          mimeType: 'application/pdf',
        },
        actionEvent: { details: { contentVersionIds: ['version-1'] } },
      },
    ]);
    const result = await f.service.get(actor, 'matter-1');
    expect(result.certificate).toMatchObject({
      certificateNo: '2026-001',
      caseBusinessNo: 'CA-1',
      files: [{ materialId: 'material-1', contentVersionId: 'version-1' }],
    });
    expect(result).toMatchObject({
      evidence: null,
      opening: null,
      issuanceDecision: null,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private-tracking|private-sender|private-phone|private-address|运营/u,
    );
    expect(result.capabilities.issueCertificate).toBe(false);
    expect(f.db.notaryMatter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { stage: 'ARCHIVED', certificate: { isNot: null } },
          ]),
        }),
      }),
    );
  });
  it('lists only assigned waiting matters with minimal fields', async () => {
    const f = fixture();
    const result = await f.service.list(actor, 1, 20);
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    expect(f.db.notaryMatter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          notaryOfficeId: actor.notaryOfficeId,
          stage: 'WAITING_UNBOX',
        }),
        select: {
          id: true,
          businessNo: true,
          stage: true,
          version: true,
          createdAt: true,
        },
      }),
    );
  });
  it('rejects revoked account before reading a matter', async () => {
    const f = fixture();
    f.db.notaryOfficeAccountBinding.findFirst.mockResolvedValue(null);
    await expect(f.service.get(actor, 'matter-1')).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.db.notaryMatter.findFirst).not.toHaveBeenCalled();
  });

  it('returns only opening facts and frozen photo metadata for its office', async () => {
    const f = fixture();
    f.db.notaryMatter.findFirst.mockResolvedValue({
      id: 'matter-1',
      businessNo: 'NT-1',
      stage: 'UNBOX_REVIEW',
      version: 3,
      createdAt: new Date('2026-09-28T01:00:00.000Z'),
      evidence: {
        evidenceAt: new Date('2026-09-27T00:00:00.000Z'),
        sampleFeeState: 'KNOWN',
        sampleFeeAmount: { toString: () => '200.00' },
        logistics: [],
      },
      opening: {
        senderName: null,
        senderPhone: null,
        senderAddress: null,
        recordedAt: new Date('2026-09-28T02:00:00.000Z'),
        recordedByUserId: actor.userId,
      },
    });
    f.db.materialReference.findMany.mockResolvedValue([
      {
        materialId: 'photo-1',
        contentVersionId: 'version-1',
        contentVersion: {
          originalFilename: 'photo.png',
          mimeType: 'image/png',
        },
        actionEvent: { details: { contentVersionIds: ['version-1'] } },
      },
      {
        materialId: 'photo-2',
        contentVersionId: 'version-2',
        contentVersion: {
          originalFilename: 'other.png',
          mimeType: 'image/png',
        },
        actionEvent: { details: { contentVersionIds: ['version-1'] } },
      },
    ]);
    const result = await f.service.get(actor, 'matter-1');
    expect(result).toEqual({
      id: 'matter-1',
      businessNo: 'NT-1',
      stage: 'UNBOX_REVIEW',
      version: 3,
      createdAt: '2026-09-28T01:00:00.000Z',
      evidence: {
        evidenceAt: '2026-09-27',
        sampleFeeState: 'KNOWN',
        sampleFeeAmount: '200.00',
        logistics: [],
      },
      opening: {
        senderName: null,
        senderPhone: null,
        senderAddress: null,
        recordedAt: '2026-09-28T02:00:00.000Z',
        photos: [
          {
            materialId: 'photo-1',
            contentVersionId: 'version-1',
            originalFilename: 'photo.png',
            mimeType: 'image/png',
          },
        ],
      },
      issuanceDecision: null,
      certificate: null,
      capabilities: { recordOpening: false, issueCertificate: false },
    });
    expect(f.db.notaryMatter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          notaryOfficeId: actor.notaryOfficeId,
          OR: expect.any(Array),
        }),
      }),
    );
  });
});
