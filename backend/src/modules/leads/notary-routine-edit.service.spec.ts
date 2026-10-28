import { NotaryRoutineEditService } from './notary-routine-edit.service';

const actor = {
  userId: '10000000-0000-4000-8000-000000000001',
  departmentId: '20000000-0000-4000-8000-000000000002',
  authorizationRevision: 1,
};
const matterId = '30000000-0000-4000-8000-000000000003';
const productId = '40000000-0000-4000-8000-000000000004';
const product = {
  id: productId,
  position: 1,
  title: '原商品',
  url: 'https://example.com/old',
  quantity: 2,
  unitPrice: '3.00',
  commentCount: 8,
  estimatedAmount: '6.00',
};
const input = {
  expectedRevision: 0,
  shopName: '新店铺',
  products: [
    {
      id: productId,
      title: '新商品',
      url: 'https://example.com/new',
      quantity: 3,
      unitPrice: '4.00',
    },
  ],
};

function fixture() {
  const matter = {
    id: matterId,
    departmentId: actor.departmentId,
    stage: 'ARCHIVED',
    sourceSnapshot: { selectedProducts: [product] },
    selectedProducts: [{ leadProductId: productId }],
    sourceLead: { shopName: '原店铺', shopExternalId: 'old-id' },
    routineProfile: null,
  };
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: matterId }]),
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    notaryMatter: { findFirst: jest.fn().mockResolvedValue(matter) },
    notaryRoutineProfile: {
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    ...tx,
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const access = {
    buildLeadScope: jest
      .fn()
      .mockResolvedValue({ departmentId: actor.departmentId }),
  };
  return {
    matter,
    tx,
    database,
    access,
    service: new NotaryRoutineEditService(database as never, access as never),
  };
}

describe('notary routine editing', () => {
  it('saves archived ordinary data separately and audits before/after without changing evidence or stage', async () => {
    const f = fixture();
    const original = structuredClone(f.matter);
    await f.service.update(actor, matterId, input);
    expect(f.matter).toEqual(original);
    expect(f.tx.notaryRoutineProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        matterId,
        departmentId: actor.departmentId,
        shopName: '新店铺',
        shopExternalId: 'old-id',
        products: [
          expect.objectContaining({
            id: productId,
            title: '新商品',
            commentCount: 8,
            estimatedAmount: '12.00',
          }),
        ],
      }),
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.userId,
        action: 'notary.routine.updated',
        details: expect.objectContaining({
          before: expect.any(Object),
          after: expect.any(Object),
        }),
      }),
    });
  });

  it('uses the existing comment-count fallback when quantity is zero', async () => {
    const f = fixture();
    await f.service.update(actor, matterId, {
      ...input,
      products: [{ ...input.products[0]!, quantity: 0 }],
    });
    expect(f.tx.notaryRoutineProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        products: [expect.objectContaining({ estimatedAmount: '32.00' })],
      }),
    });
  });

  it('keeps a profile’s null shop ID instead of recovering a changed source value', async () => {
    const f = fixture();
    f.tx.notaryMatter.findFirst.mockResolvedValue({
      ...f.matter,
      routineProfile: {
        revision: 1,
        shopName: '已保存店铺',
        shopExternalId: null,
        products: [product],
      },
    });
    await f.service.update(actor, matterId, { ...input, expectedRevision: 1 });
    expect(f.tx.notaryRoutineProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shopExternalId: null }),
      }),
    );
  });

  it('rejects external actors, inaccessible records and changed product identities without writing', async () => {
    for (const change of ['external', 'scope', 'product'] as const) {
      const f = fixture();
      if (change === 'external')
        f.tx.userAccount.findUnique.mockResolvedValue({
          accountType: 'CLIENT',
          active: true,
        });
      if (change === 'scope')
        f.tx.notaryMatter.findFirst.mockResolvedValue(null);
      const body = change === 'product' ? { ...input, products: [] } : input;
      await expect(
        f.service.update(actor, matterId, body),
      ).rejects.toBeDefined();
      expect(f.tx.notaryRoutineProfile.create).not.toHaveBeenCalled();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    }
  });

  it('rejects stale revision and protected fields before writes', async () => {
    for (const body of [
      { ...input, expectedRevision: 1 },
      { ...input, stage: 'WAITING_RETURN' },
      {
        ...input,
        products: [{ ...input.products[0]!, title: null, url: null }],
      },
    ]) {
      const f = fixture();
      await expect(
        f.service.update(actor, matterId, body),
      ).rejects.toBeDefined();
      expect(f.tx.notaryRoutineProfile.create).not.toHaveBeenCalled();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    }
  });

  it('retries a serialization conflict and reports persistent contention as a version conflict', async () => {
    const f = fixture();
    f.database.$transaction.mockRejectedValueOnce({ code: 'P2034' });
    await f.service.update(actor, matterId, input);
    expect(f.database.$transaction).toHaveBeenCalledTimes(2);
    const blocked = fixture();
    blocked.database.$transaction.mockRejectedValue({
      meta: { driverAdapterError: { cause: { sqlState: '40001' } } },
    });
    await expect(
      blocked.service.update(actor, matterId, input),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'VERSION_CONFLICT' }),
    });
    expect(blocked.database.$transaction).toHaveBeenCalledTimes(3);
    expect(blocked.tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
