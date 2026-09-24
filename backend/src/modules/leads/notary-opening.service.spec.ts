import { ForbiddenException } from '@nestjs/common';
import { NotaryOpeningService } from './notary-opening.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const matterId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const materialId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const command = {
  expectedVersion: 2,
  contentVersionIds: [versionId],
  senderName: '真实寄件人',
  senderPhone: undefined,
  senderAddress: undefined,
};

function fixture() {
  const matter = {
    id: matterId,
    departmentId: actor.departmentId,
    stage: 'WAITING_UNBOX',
    version: 2,
    sourceLead: { responsibleUserId: actor.userId, teamId: null },
  };
  const fact = {
    materialId,
    contentVersionId: versionId,
    ownerType: 'NOTARY_MATTER',
    ownerId: matterId,
    category: 'NOTARY_OPENING_PHOTO',
    departmentId: actor.departmentId,
    purpose: 'NOTARY_OPENING_PHOTO',
  };
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: matterId }]),
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    notaryMatter: {
      findFirst: jest.fn().mockResolvedValue(matter),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notaryMatterOpening: { create: jest.fn().mockResolvedValue({}) },
    notaryMatterCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    auditEvent: {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
    },
  };
  const database = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };
  const access = { authorizeLead: jest.fn().mockResolvedValue(undefined) };
  const materials = {
    assertAvailableVersions: jest.fn().mockResolvedValue([fact]),
    freezeReferences: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const service = new NotaryOpeningService(
    database as never,
    access as never,
    materials as never,
  );
  return { service, matter, fact, tx, database, access, materials };
}

describe('NotaryOpeningService record', () => {
  it('atomically records actual photos and advances exactly one stage', async () => {
    const f = fixture();
    const result = await f.service.record(
      actor,
      matterId,
      'opening-1',
      command,
    );
    expect(result).toMatchObject({
      id: matterId,
      stage: 'UNBOX_REVIEW',
      version: 3,
      opening: {
        senderName: '真实寄件人',
        senderPhone: null,
        senderAddress: null,
        photos: [{ materialId, contentVersionId: versionId }],
      },
    });
    expect(f.access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'notary.unbox.record',
      expect.objectContaining({ departmentId: actor.departmentId }),
      f.tx,
    );
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        ownerType: 'NOTARY_MATTER',
        ownerId: matterId,
        category: 'NOTARY_OPENING_PHOTO',
        minCount: 1,
        maxCount: 50,
      }),
    );
    expect(f.tx.notaryMatter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stage: 'WAITING_UNBOX', version: 2 }),
        data: { stage: 'UNBOX_REVIEW', version: 3 },
      }),
    );
    expect(f.materials.freezeReferences).toHaveBeenCalled();
    expect(f.tx.auditEvent.create).toHaveBeenCalled();
    expect(f.tx.notaryMatterCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ resultSnapshot: result }),
    });
  });

  it('rejects empty photos, duplicate versions and invented sender values', async () => {
    for (const input of [
      { ...command, contentVersionIds: [] },
      { ...command, contentVersionIds: [versionId, versionId] },
      { ...command, senderName: '  ' },
    ]) {
      const f = fixture();
      await expect(
        f.service.record(actor, matterId, 'invalid', input),
      ).rejects.toMatchObject({
        response: { code: 'VALIDATION_ERROR' },
      });
      expect(f.tx.notaryMatter.updateMany).not.toHaveBeenCalled();
    }
  });

  it('rejects revoked grant before looking up an old receipt', async () => {
    const f = fixture();
    f.access.authorizeLead.mockRejectedValue(new ForbiddenException());
    await expect(
      f.service.record(actor, matterId, 'same', command),
    ).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.notaryMatterCommandReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('replays the same key but rejects different intent without another advance', async () => {
    const f = fixture();
    const first = await f.service.record(actor, matterId, 'same', command);
    f.tx.notaryMatterCommandReceipt.findUnique.mockResolvedValue(
      f.tx.notaryMatterCommandReceipt.create.mock.calls[0][0].data,
    );
    f.tx.notaryMatter.updateMany.mockClear();
    await expect(
      f.service.record(actor, matterId, 'same', command),
    ).resolves.toEqual(first);
    await expect(
      f.service.record(actor, matterId, 'same', {
        ...command,
        senderName: '另一个人',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.notaryMatter.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale version and does not issue a receipt if audit fails', async () => {
    const f = fixture();
    f.tx.notaryMatter.findFirst.mockResolvedValueOnce({
      ...f.matter,
      version: 3,
    });
    await expect(
      f.service.record(actor, matterId, 'stale', command),
    ).rejects.toMatchObject({
      response: { code: 'VERSION_CONFLICT' },
    });
    f.tx.auditEvent.create.mockRejectedValue(new Error('audit failed'));
    await expect(
      f.service.record(actor, matterId, 'fail', command),
    ).rejects.toThrow('audit failed');
    expect(f.tx.notaryMatterCommandReceipt.create).not.toHaveBeenCalled();
  });
});
