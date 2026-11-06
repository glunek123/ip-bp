import { Prisma } from '../../generated/prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { CaseRoutineEditService } from './case-routine-edit.service';

const actor = {
  userId: '10000000-0000-4000-8000-000000000001',
  departmentId: '20000000-0000-4000-8000-000000000002',
  authorizationRevision: 1,
};
const caseId = '30000000-0000-4000-8000-000000000003';
const productId = '40000000-0000-4000-8000-000000000004';
const input = {
  expectedRevision: 0,
  shopName: '案件新店铺',
  remark: '案件备注',
  products: [
    {
      id: productId,
      title: '案件商品',
      url: 'https://example.com/item',
      quantity: 2,
      unitPrice: '4.00',
    },
  ],
};
function fixture() {
  const record = {
    id: caseId,
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
    stage: 'ARCHIVED',
    routineProfile: null,
    externalEntry: null,
    sourceLead: {
      shopName: '线索原店铺',
      shopExternalId: null,
      remark: '线索备注',
      products: [
        {
          id: productId,
          position: 1,
          title: '线索商品',
          url: null,
          quantity: 1,
          unitPrice: new Prisma.Decimal('3'),
          commentCount: 1,
          estimatedAmount: new Prisma.Decimal('3'),
        },
      ],
    },
  };
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: caseId }]),
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    case: { findFirst: jest.fn().mockResolvedValue(record) },
    caseRoutineProfile: {
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
    authorizeDepartmentAction: jest.fn(
      async (_actor: unknown, action: string) => {
        if (action === 'case.routine.edit') throw new ForbiddenException();
      },
    ),
    authorizeDepartmentProxyAction: jest.fn(async (): Promise<void> => {
      throw new ForbiddenException();
    }),
  };
  return {
    record,
    tx,
    database,
    access,
    service: new CaseRoutineEditService(database as never, access as never),
  };
}

describe('case routine editing', () => {
  it('returns the current values and requires a separate grant for a colleague', async () => {
    const f = fixture();
    await expect(f.service.get(actor, caseId)).resolves.toMatchObject({
      revision: 0,
      canEdit: true,
      shopName: '线索原店铺',
      remark: '线索备注',
    });
    expect(f.database.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    f.tx.case.findFirst.mockResolvedValue({
      ...f.record,
      responsibleUserId: 'another',
    });
    await expect(f.service.get(actor, caseId)).resolves.toMatchObject({
      canEdit: false,
    });
  });
  it('supports an external case without inventing source products', async () => {
    const f = fixture();
    f.tx.case.findFirst.mockResolvedValue({
      ...f.record,
      sourceLead: null,
      externalEntry: {
        known: { shopName: '转入店铺', shopExternalId: '外部ID' },
      },
    });
    await expect(f.service.get(actor, caseId)).resolves.toMatchObject({
      shopName: '转入店铺',
      shopExternalId: '外部ID',
      products: [],
      canEdit: true,
    });
    await f.service.update(actor, caseId, {
      expectedRevision: 0,
      shopName: '案件新店铺',
      remark: null,
      products: [],
    });
    expect(f.tx.caseRoutineProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shopName: '案件新店铺',
        shopExternalId: '外部ID',
        products: [],
      }),
    });
  });
  it('saves archived case data independently and audits the old and new values', async () => {
    const f = fixture();
    const original = {
      ...f.record.sourceLead,
      products: f.record.sourceLead.products.map((p) => ({ ...p })),
    };
    await f.service.update(actor, caseId, input);
    expect(f.record.sourceLead).toEqual(original);
    expect(f.tx.caseRoutineProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        caseId,
        departmentId: actor.departmentId,
        shopName: '案件新店铺',
        products: [
          expect.objectContaining({
            id: productId,
            title: '案件商品',
            estimatedAmount: '8.00',
          }),
        ],
      }),
    });
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'case.routine.updated',
        actorUserId: actor.userId,
        details: expect.objectContaining({
          before: expect.any(Object),
          after: expect.any(Object),
        }),
      }),
    });
  });
  it('denies non-owner and external accounts and never writes', async () => {
    const other = fixture();
    other.tx.case.findFirst.mockResolvedValue({
      ...other.record,
      responsibleUserId: 'another',
    });
    await expect(
      other.service.update(actor, caseId, input),
    ).rejects.toBeDefined();
    expect(other.tx.caseRoutineProfile.create).not.toHaveBeenCalled();
    const external = fixture();
    external.tx.userAccount.findUnique.mockResolvedValue({
      accountType: 'CLIENT',
      active: true,
    });
    await expect(
      external.service.update(actor, caseId, input),
    ).rejects.toBeDefined();
    expect(external.tx.auditEvent.create).not.toHaveBeenCalled();
  });
  it('allows a department-authorized colleague and audits the actual actor and owner', async () => {
    const f = fixture();
    const ownerId = '10000000-0000-4000-8000-000000000099';
    f.tx.case.findFirst.mockResolvedValue({
      ...f.record,
      responsibleUserId: ownerId,
    });
    f.access.authorizeDepartmentProxyAction.mockImplementation(async () => {});
    await expect(f.service.get(actor, caseId)).resolves.toMatchObject({
      canEdit: true,
    });
    await expect(f.service.update(actor, caseId, input)).resolves.toMatchObject(
      {
        revision: 1,
      },
    );
    expect(f.access.authorizeDepartmentProxyAction).toHaveBeenCalledWith(
      actor,
      'case.routine.edit',
      { departmentId: actor.departmentId },
      f.tx,
    );
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: actor.userId,
        details: expect.objectContaining({
          proxyAuthorization: {
            responsibleUserId: ownerId,
            action: 'case.routine.edit',
            scope: 'DEPARTMENT',
          },
        }),
      }),
    });
  });
  it('rejects changed product identities and stale versions', async () => {
    for (const body of [
      { ...input, expectedRevision: 1 },
      { ...input, products: [] },
    ]) {
      const f = fixture();
      await expect(f.service.update(actor, caseId, body)).rejects.toBeDefined();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    }
  });
});
