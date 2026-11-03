import { MaterialService } from './material.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const matterId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const photo = {
  materialId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  contentVersionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  storageKey: `${actor.departmentId}/opening-import/batch/photo`,
  filename: 'a.png',
  mimeType: 'image/png',
  sizeBytes: 13,
  sha256: 'a'.repeat(64),
};
describe('staged opening material adoption', () => {
  it('creates formal material and version only through the supplied transaction', async () => {
    const service = Object.create(MaterialService.prototype) as MaterialService;
    const tx = {
      material: { create: jest.fn(), update: jest.fn() },
      contentVersion: { create: jest.fn() },
    };
    await service.adoptStagedOpeningPhotos(tx as never, actor, matterId, [
      photo,
    ]);
    expect(tx.material.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerId: matterId,
        category: 'NOTARY_OPENING_PHOTO',
      }),
    });
    expect(tx.contentVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storageKey: photo.storageKey,
        materialId: photo.materialId,
        uploadedBy: actor.userId,
      }),
    });
    expect(tx.material.update).toHaveBeenCalledWith({
      where: { id: photo.materialId },
      data: { currentVersionId: photo.contentVersionId },
    });
  });
  it('propagates a late version write failure to abort the caller transaction', async () => {
    const service = Object.create(MaterialService.prototype) as MaterialService;
    const tx = {
      material: { create: jest.fn(), update: jest.fn() },
      contentVersion: {
        create: jest.fn().mockRejectedValue(new Error('version failure')),
      },
    };
    await expect(
      service.adoptStagedOpeningPhotos(tx as never, actor, matterId, [photo]),
    ).rejects.toThrow('version failure');
    expect(tx.material.update).not.toHaveBeenCalled();
  });
});
