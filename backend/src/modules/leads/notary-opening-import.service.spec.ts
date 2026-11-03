import { NotaryOpeningImportService } from './notary-opening-import.service';
import { zipSync } from 'fflate';

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
    notaryOpeningImportBatch: {
      findFirst: jest.fn().mockResolvedValue(batch),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    notaryOpeningImportItem: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notaryMatter: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: matterId }),
    },
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
  const blobs = {
    open: jest.fn(),
    put: jest.fn().mockResolvedValue({
      detectedMimeType: 'image/png',
      sizeBytes: 13,
      sha256: 'a'.repeat(64),
    }),
    delete: jest.fn(),
  };
  const recognition = {
    mode: 'MOCK',
    recognize: jest.fn().mockResolvedValue({
      status: 'SUCCEEDED',
      trackingCandidate: 'MOCK20261103001',
      senderCandidate: null,
    }),
  };
  const materials = {
    adoptStagedOpeningPhotos: jest.fn().mockResolvedValue(undefined),
  };
  const service = new NotaryOpeningImportService(
    db as never,
    access as never,
    opening as never,
    recognition as never,
    materials as never,
    blobs as never,
  );
  return { service, db, access, opening, blobs, recognition, batch, item };
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

describe('opening import recognition boundary', () => {
  it('passes validated image bytes to the async provider before persisting a batch', async () => {
    const f = fixture();
    const png = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 1,
    ]);
    const zip = Buffer.from(
      zipSync({ 'parcel/MOCK20261103001.png': png }, { level: 0 }),
    );
    jest.spyOn(f.service, 'get').mockResolvedValue({ id: batchId } as never);
    await f.service.upload(actor, 'upload-key', zip);
    expect(f.recognition.recognize).toHaveBeenCalledWith({
      photos: [
        {
          filename: 'MOCK20261103001.png',
          mimeType: 'image/png',
          bytes: Buffer.from(png),
        },
      ],
    });
    expect(f.db.notaryOpeningImportBatch.create).toHaveBeenCalled();
  });
});

describe('opening import manual tracking correction', () => {
  it('re-matches current scoped logistics without changing the raw candidate', async () => {
    const f = fixture();
    f.item.selectedMatterId = null as never;
    f.item.matchStatus = 'UNMATCHED';
    f.db.notaryMatter.findMany.mockResolvedValue([
      {
        id: matterId,
        evidence: { logistics: [{ trackingValue: 'MOCK20261103001' }] },
        evidenceCorrections: [],
      },
    ]);
    f.db.notaryOpeningImportItem.updateMany.mockImplementation(
      async ({
        data,
      }: {
        data: { matchStatus: string; suggestedMatterId: string };
      }) => {
        f.item.matchStatus = data.matchStatus;
        f.item.suggestedMatterId = data.suggestedMatterId;
        f.item.trackingNo = 'MOCK20261103001' as never;
        f.item.revision += 1;
        return { count: 1 };
      },
    );
    const result = await f.service.patch(actor, batchId, itemId, {
      trackingNo: 'MOCK20261103001',
      selectedMatterId: null,
      expectedRevision: 1,
    });
    expect(result).toMatchObject({
      matchStatus: 'SUGGESTED',
      suggestedMatterId: matterId,
      trackingCandidate: null,
    });
    expect(f.db.notaryMatter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          stage: 'WAITING_UNBOX',
          sourceLead: { departmentId: actor.departmentId },
        }),
      }),
    );
  });
});
