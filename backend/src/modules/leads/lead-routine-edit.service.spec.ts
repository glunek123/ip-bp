import { Prisma } from '../../generated/prisma/client';
import { LeadRoutineEditService } from './lead-routine-edit.service';

const actor = {
  userId: '10000000-0000-4000-8000-000000000001',
  departmentId: '20000000-0000-4000-8000-000000000002',
  authorizationRevision: 1,
};
const leadId = '30000000-0000-4000-8000-000000000003';
const productId = '40000000-0000-4000-8000-000000000004';
const matterId = '50000000-0000-4000-8000-000000000005';
const caseId = '60000000-0000-4000-8000-000000000006';
const product = {
  id: productId,
  position: 1,
  title: '原商品',
  url: null,
  quantity: 1,
  unitPrice: new Prisma.Decimal('3'),
  commentCount: 1,
  estimatedAmount: new Prisma.Decimal('3'),
};
const frozen = { ...product, unitPrice: '3.00', estimatedAmount: '3.00' };
const input = {
  expectedRevision: 4,
  shopName: '线索新店铺',
  remark: '备注',
  products: [
    {
      id: productId,
      title: '线索新商品',
      url: null,
      quantity: 2,
      unitPrice: '4.00',
    },
  ],
};
function fixture() {
  const lead = {
    id: leadId,
    departmentId: actor.departmentId,
    status: 'ARCHIVED',
    version: 4,
    shopName: '线索原店铺',
    shopExternalId: null,
    remark: null,
    products: [product],
  };
  const matter = {
    id: matterId,
    sourceSnapshot: { selectedProducts: [frozen] },
    selectedProducts: [{ leadProductId: productId }],
  };
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: leadId }]),
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    lead: {
      findFirst: jest.fn().mockResolvedValue(lead),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    leadProduct: { update: jest.fn().mockResolvedValue({}) },
    notaryMatter: { findMany: jest.fn().mockResolvedValue([matter]) },
    case: { findMany: jest.fn().mockResolvedValue([{ id: caseId }]) },
    notaryRoutineProfile: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    caseRoutineProfile: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const access = {
    buildLeadScope: jest
      .fn()
      .mockResolvedValue({ departmentId: actor.departmentId }),
  };
  return {
    lead,
    matter,
    tx,
    access,
    service: new LeadRoutineEditService(database as never, access as never),
  };
}
describe('lead routine editing', () => {
  it('captures downstream display before updating ordinary values and never touches evidence', async () => {
    const f = fixture();
    await f.service.update(actor, leadId, input);
    expect(f.tx.notaryRoutineProfile.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            matterId,
            shopName: '线索原店铺',
            products: [frozen],
          }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(f.tx.caseRoutineProfile.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            caseId,
            shopName: '线索原店铺',
            products: [frozen],
          }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(f.tx.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shopName: '线索新店铺',
          remark: '备注',
        }),
      }),
    );
    expect(f.tx.leadProduct.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: productId },
        data: expect.objectContaining({
          title: '线索新商品',
          estimatedAmount: '8.00',
        }),
      }),
    );
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'lead.routine.updated',
        details: expect.objectContaining({
          before: expect.any(Object),
          after: expect.any(Object),
        }),
      }),
    });
    expect(f.matter.sourceSnapshot.selectedProducts).toEqual([frozen]);
  });
  it('rejects inaccessible, external, stale and product-identity changes without writes', async () => {
    for (const kind of ['external', 'scope', 'stale', 'products'] as const) {
      const f = fixture();
      if (kind === 'external')
        f.tx.userAccount.findUnique.mockResolvedValue({
          accountType: 'CLIENT',
          active: true,
        });
      if (kind === 'scope') f.tx.lead.findFirst.mockResolvedValue(null);
      const body =
        kind === 'stale'
          ? { ...input, expectedRevision: 3 }
          : kind === 'products'
            ? { ...input, products: [] }
            : input;
      await expect(f.service.update(actor, leadId, body)).rejects.toBeDefined();
      expect(f.tx.lead.updateMany).not.toHaveBeenCalled();
      expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    }
  });
});
