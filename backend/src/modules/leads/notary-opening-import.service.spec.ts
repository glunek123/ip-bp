import { NotaryOpeningImportService } from './notary-opening-import.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const batchId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const matterId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const photo = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  itemId,
  batchId,
  departmentId: actor.departmentId,
  filename: 'a.png',
  storageKey: 'private',
  materialId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  contentVersionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  mimeType: 'image/png',
  sizeBytes: 13,
  sha256: 'a'.repeat(64),
};
function fixture(status = 'READY', expiresAt = new Date(Date.now() + 60_000)) {
  const item = {
    id: itemId,
    batchId,
    departmentId: actor.departmentId,
    position: 1,
    folderName: 'parcel',
    revision: 1,
    status: 'READY',
    confirmedKey: null as string | null,
    selectedMatterId: matterId,
    trackingCandidate: null,
    trackingNo: null,
    recognitionStatus: 'DISABLED',
    senderCandidate: null,
    matchStatus: 'SUGGESTED',
    suggestedMatterId: matterId,
    photos: [photo],
  };
  const batch = {
    id: batchId,
    departmentId: actor.departmentId,
    actorUserId: actor.userId,
    status,
    expiresAt,
    recognitionMode: 'DISABLED',
    items: [item],
  };
  const db = {
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    notaryOpeningImportBatch: { findFirst: jest.fn().mockResolvedValue(batch) },
  };
  const access = {
    buildLeadScope: jest
      .fn()
      .mockResolvedValue({ departmentId: actor.departmentId }),
  };
  const opening = {
    recordWithAdoption: jest.fn().mockResolvedValue({
      id: matterId,
      stage: 'UNBOX_REVIEW',
      version: 3,
      opening: {
        photos: [
          {
            materialId: photo.materialId,
            contentVersionId: photo.contentVersionId,
          },
        ],
      },
    }),
  };
  const blobs = { open: jest.fn() };
  const materials = {
    adoptStagedOpeningPhotos: jest.fn().mockResolvedValue(undefined),
  };
  const service = new NotaryOpeningImportService(
    db as never,
    access as never,
    opening as never,
    { mode: 'DISABLED' } as never,
    materials as never,
    blobs as never,
  );
  return { service, db, access, opening, blobs, batch, item };
}
describe('opening import confirmation', () => {
  const input = { matterId, expectedVersion: 2, expectedRevision: 1 };
  it('passes adoption to the existing opening command, with a separate receipt action', async () => {
    const f = fixture();
    await f.service.confirm(actor, batchId, itemId, 'key', input);
    expect(f.opening.recordWithAdoption).toHaveBeenCalledWith(
      actor,
      matterId,
      'key',
      {
        contentVersionIds: [photo.contentVersionId],
        expectedVersion: 2,
        senderName: undefined,
        senderPhone: undefined,
        senderAddress: undefined,
      },
      expect.any(Function),
      'opening.import.confirm',
      `${batchId}:${itemId}:1`,
    );
  });
  it('replays a committed original key after expiry without re-adopting', async () => {
    const f = fixture('READY', new Date(0));
    f.item.status = 'COMMITTED';
    f.item.confirmedKey = 'key';
    await expect(
      f.service.confirm(actor, batchId, itemId, 'key', input),
    ).resolves.toMatchObject({ itemId });
    await expect(
      f.service.confirm(actor, batchId, itemId, 'changed', input),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
  });
  it('lets an original committed key reach its receipt after a sibling selects the same matter', async () => {
    const f = fixture('READY', new Date(0));
    f.item.status = 'COMMITTED';
    f.item.confirmedKey = 'key';
    f.batch.items.push({
      ...f.item,
      id: '99999999-9999-4999-8999-999999999999',
      status: 'READY',
      confirmedKey: null,
    });
    await expect(
      f.service.confirm(actor, batchId, itemId, 'key', input),
    ).resolves.toMatchObject({ itemId });
  });
  it('rechecks locked batch expiry before adoption', async () => {
    const f = fixture();
    await f.service.confirm(actor, batchId, itemId, 'key', input);
    const callback = f.opening.recordWithAdoption.mock.calls[0][4] as (
      tx: unknown,
    ) => Promise<void>;
    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: batchId }]),
      notaryOpeningImportBatch: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ status: 'READY', expiresAt: new Date(0) }),
      },
      notaryOpeningImportItem: { findUnique: jest.fn(), update: jest.fn() },
    };
    await expect(callback(tx)).rejects.toMatchObject({
      response: { code: 'IMPORT_EXPIRED' },
    });
    expect(tx.notaryOpeningImportItem.update).not.toHaveBeenCalled();
  });
  it('blocks fresh confirmation after expiry and permission revocation', async () => {
    const expired = fixture('READY', new Date(0));
    await expect(
      expired.service.confirm(actor, batchId, itemId, 'key', input),
    ).rejects.toMatchObject({ response: { code: 'IMPORT_EXPIRED' } });
    expect(expired.opening.recordWithAdoption).not.toHaveBeenCalled();
    const revoked = fixture();
    revoked.access.buildLeadScope.mockRejectedValue(new Error('revoked'));
    await expect(
      revoked.service.confirm(actor, batchId, itemId, 'key', input),
    ).rejects.toThrow('revoked');
  });
});
