import { ClientNotaryService } from './client-notary.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
  clientCustomerId: '33333333-3333-4333-8333-333333333333',
};
const matterId = '44444444-4444-4444-8444-444444444444';
const matter = {
  id: matterId,
  businessNo: 'NT-001',
  stage: 'UNBOX_REVIEW',
  version: 3,
  createdAt: new Date('2026-09-28T01:00:00Z'),
  sourceLeadId: 'lead-1',
  sourceSnapshot: {
    selectedProducts: [
      {
        id: 'product-1',
        position: 1,
        title: '商品',
        url: null,
        quantity: 1,
        unitPrice: '9.00',
        commentCount: 0,
        estimatedAmount: '9.00',
      },
    ],
    senderPhone: 'secret',
  },
  selectedProducts: [{ leadProductId: 'product-1' }],
  sourceLead: {
    id: 'lead-1',
    businessNo: 'LD-001',
    pushedAt: new Date(),
    pushedByUserId: 'operator-secret',
    responsibleUserId: 'operator-secret',
    teamId: 'team-secret',
  },
  opening: {
    matterId,
    senderName: 'secret',
    senderPhone: 'secret',
    recordedAt: new Date('2026-09-28T01:00:00Z'),
  },
  openingReviewDecision: null,
};

function fixture() {
  const database = {
    customerAccountBinding: {
      findFirst: jest
        .fn()
        .mockResolvedValue({
          id: 'binding-1',
          customerId: actor.clientCustomerId,
        }),
    },
    notaryMatter: {
      findMany: jest.fn().mockResolvedValue([matter]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(matter),
    },
    materialReference: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          {
            materialId: 'photo-1',
            contentVersionId: 'frozen-1',
            contentVersion: {
              originalFilename: 'opening.png',
              mimeType: 'image/png',
            },
          },
        ]),
    },
  };
  return { database, service: new ClientNotaryService(database as never) };
}

describe('ClientNotaryService', () => {
  it('scopes the pending list to the live enterprise, department, pushed lead and opening', async () => {
    const { service, database } = fixture();
    const result = await service.list(actor, 1, 20);
    expect(database.notaryMatter.findMany.mock.calls[0][0].where).toMatchObject(
      {
        departmentId: actor.departmentId,
        customerId: actor.clientCustomerId,
        stage: 'UNBOX_REVIEW',
        opening: { isNot: null },
        sourceLead: { pushedAt: { not: null }, pushedByUserId: { not: null } },
      },
    );
    expect(result.items[0]).toMatchObject({
      id: matterId,
      stage: 'UNBOX_REVIEW',
    });
    expect(JSON.stringify(result)).not.toMatch(
      /secret|sender|logistics|fee|teamId|responsibleUserId|sourceSnapshot/u,
    );
  });

  it('returns only selected products, frozen photo references and safe decision facts', async () => {
    const { service, database } = fixture();
    const detail = await service.get(actor, matterId);
    expect(detail).toMatchObject({
      id: matterId,
      selectedProducts: [{ id: 'product-1', title: '商品' }],
      opening: {
        photos: [{ materialId: 'photo-1', contentVersionId: 'frozen-1' }],
      },
      capabilities: { reviewOpening: true },
    });
    expect(
      database.materialReference.findMany.mock.calls[0][0].where,
    ).toMatchObject({
      resourceType: 'notary_matter',
      resourceId: matterId,
      purpose: 'NOTARY_OPENING_PHOTO',
      actionEventId: { not: null },
      material: {
        ownerType: 'NOTARY_MATTER',
        ownerId: matterId,
        category: 'NOTARY_OPENING_PHOTO',
      },
    });
    expect(JSON.stringify(detail)).not.toMatch(
      /secret|sender|logistics|fee|teamId|responsibleUserId|sourceSnapshot/u,
    );
  });

  it('rejects revoked binding on the next request before reading matters or bytes', async () => {
    const { service, database } = fixture();
    database.customerAccountBinding.findFirst.mockResolvedValue(null);
    await expect(service.get(actor, matterId)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(database.notaryMatter.findFirst).not.toHaveBeenCalled();
    expect(database.materialReference.findMany).not.toHaveBeenCalled();
  });

  it('hides other enterprise, department and unpushed matters', async () => {
    const { service, database } = fixture();
    database.notaryMatter.findFirst.mockResolvedValue(null);
    await expect(service.get(actor, matterId)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    expect(
      database.notaryMatter.findFirst.mock.calls[0][0].where,
    ).toMatchObject({
      id: matterId,
      departmentId: actor.departmentId,
      customerId: actor.clientCustomerId,
      sourceLead: { pushedAt: { not: null }, pushedByUserId: { not: null } },
    });
  });
});
