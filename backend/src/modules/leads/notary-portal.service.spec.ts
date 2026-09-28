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
      evidence: { evidenceAt: '2026-09-27', logistics: [] },
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
      capabilities: { recordOpening: false },
    });
    expect(f.db.notaryMatter.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departmentId: actor.departmentId,
          notaryOfficeId: actor.notaryOfficeId,
          stage: { in: ['WAITING_UNBOX', 'UNBOX_REVIEW'] },
        }),
      }),
    );
  });
});
