import { ActorContext } from '../../access-control/actor-context';
import { ClientLeadService } from './client-lead.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
  clientCustomerId: '33333333-3333-4333-8333-333333333333',
};

const lead = {
  id: '44444444-4444-4444-8444-444444444444',
  businessNo: 'LD-20260922-001',
  customerId: actor.clientCustomerId,
  departmentId: actor.departmentId,
  responsibleUserId: 'operator-secret',
  teamId: 'team-secret',
  remark: 'internal-secret',
  creationChannel: 'MANUAL',
  externalSourceRef: null,
  status: 'WAITING_REVIEW',
  caseType: 'CIVIL',
  source: 'ONLINE',
  platform: 'TAOBAO',
  foundAt: new Date('2026-09-22T01:00:00.000Z'),
  shopName: '店铺',
  shopExternalId: 'shop-1',
  needDisclose: false,
  pushedAt: new Date('2026-09-22T02:00:00.000Z'),
  products: [
    {
      id: 'product-1',
      position: 1,
      url: 'https://example.test/product',
      title: '商品',
      quantity: 1,
      unitPrice: { toFixed: () => '10.00' },
      commentCount: 0,
      estimatedAmount: { toFixed: () => '10.00' },
    },
  ],
  infringements: [{ type: 'TRADEMARK' }],
  rightsHolder: { name: '权利主体甲' },
};

function setup() {
  const database = {
    customerAccountBinding: {
      findFirst: jest.fn().mockResolvedValue({ id: 'binding-1' }),
    },
    lead: {
      findMany: jest.fn().mockResolvedValue([lead]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn().mockResolvedValue(lead),
    },
  };
  const materials = {
    listCurrentReferenceVersionIds: jest.fn().mockResolvedValue(['version-1']),
  };
  return {
    service: new ClientLeadService(database as never, materials as never),
    database,
    materials,
  };
}

describe('ClientLeadService', () => {
  it('lists only pushed leads for the actor enterprise with a redacted projection', async () => {
    const { service, database } = setup();
    const result = await service.list(actor, 1, 20);

    expect(database.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          customerId: actor.clientCustomerId,
          status: 'WAITING_REVIEW',
          pushedAt: { not: null },
          pushedByUserId: { not: null },
        },
        orderBy: [{ pushedAt: 'desc' }, { id: 'asc' }],
      }),
    );
    expect(result.items[0]).toMatchObject({
      id: lead.id,
      status: 'WAITING_REVIEW',
      rightsHolderName: '权利主体甲',
    });
    expect(result.items[0]).not.toHaveProperty('departmentId');
    expect(result.items[0]).not.toHaveProperty('responsibleUserId');
    expect(result.items[0]).not.toHaveProperty('teamId');
    expect(result.items[0]).not.toHaveProperty('remark');
    expect(result.items[0]).not.toHaveProperty('creationChannel');
  });

  it('returns not found for another enterprise or a waiting-push lead', async () => {
    const { service, database } = setup();
    database.lead.findFirst.mockResolvedValue(null);
    await expect(service.get(actor, lead.id)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
    expect(database.lead.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: lead.id,
          departmentId: actor.departmentId,
          customerId: actor.clientCustomerId,
          status: 'WAITING_REVIEW',
          pushedAt: { not: null },
          pushedByUserId: { not: null },
        },
      }),
    );
  });

  it('rejects an internal actor instead of deriving an internal scope', async () => {
    const { service, database } = setup();
    const { clientCustomerId: _clientCustomerId, ...internal } = actor;
    await expect(service.list(internal, 1, 20)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(database.lead.findMany).not.toHaveBeenCalled();
  });

  it('includes only current allowed screenshot version ids in detail', async () => {
    const { service, materials } = setup();
    const result = await service.get(actor, lead.id);
    expect(materials.listCurrentReferenceVersionIds).toHaveBeenCalledWith(
      expect.anything(),
      actor,
      {
        resourceType: 'lead',
        resourceId: lead.id,
        purpose: 'LEAD_SCREENSHOT',
      },
    );
    expect(result.leadScreenshotContentVersionIds).toEqual(['version-1']);
  });
});
