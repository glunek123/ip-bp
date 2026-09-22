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
  version: 2,
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
  reviewDecision: null,
};

const processedLead = {
  ...lead,
  status: 'WAITING_EVIDENCE_DECISION',
  version: 3,
  reviewDecision: {
    id: 'decision-secret',
    departmentId: actor.departmentId,
    leadId: lead.id,
    customerId: actor.clientCustomerId,
    reviewerUserId: 'reviewer-secret',
    customerAccountBindingId: 'binding-secret',
    reviewerDisplayNameSnapshot: '企业审核员',
    result: 'INFRINGEMENT',
    decidedAt: new Date('2026-09-22T03:00:00.000Z'),
    fromVersion: 2,
    toVersion: 3,
  },
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
  it('lists only pushed pending leads for the actor enterprise with a redacted projection', async () => {
    const { service, database } = setup();
    const result = await service.list(actor, 'PENDING', 1, 20);

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
      version: 2,
      rightsHolderName: '权利主体甲',
      reviewDecision: null,
      capabilities: { review: true },
    });
    expect(result.items[0]).not.toHaveProperty('departmentId');
    expect(result.items[0]).not.toHaveProperty('responsibleUserId');
    expect(result.items[0]).not.toHaveProperty('teamId');
    expect(result.items[0]).not.toHaveProperty('remark');
    expect(result.items[0]).not.toHaveProperty('creationChannel');
    expect(result.items[0]).not.toHaveProperty('externalSourceRef');
  });

  it('lists only processed leads with a formal decision and redacts decision internals', async () => {
    const { service, database } = setup();
    database.lead.findMany.mockResolvedValue([processedLead]);

    const result = await service.list(actor, 'PROCESSED', 2, 10);

    expect(database.lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          customerId: actor.clientCustomerId,
          status: 'WAITING_EVIDENCE_DECISION',
          pushedAt: { not: null },
          pushedByUserId: { not: null },
          reviewDecision: { isNot: null },
        },
        skip: 10,
        take: 10,
        include: expect.objectContaining({
          reviewDecision: {
            select: {
              result: true,
              reviewerDisplayNameSnapshot: true,
              decidedAt: true,
            },
          },
        }),
      }),
    );
    expect(result.items[0]).toMatchObject({
      status: 'WAITING_EVIDENCE_DECISION',
      version: 3,
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: { review: false },
    });
    expect(result.items[0].reviewDecision).not.toHaveProperty('id');
    expect(result.items[0].reviewDecision).not.toHaveProperty('reviewerUserId');
    expect(result.items[0].reviewDecision).not.toHaveProperty('fromVersion');
    expect(result.items[0].reviewDecision).not.toHaveProperty('toVersion');
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
          pushedAt: { not: null },
          pushedByUserId: { not: null },
          OR: [
            { status: 'WAITING_REVIEW' },
            {
              status: 'WAITING_EVIDENCE_DECISION',
              reviewDecision: { isNot: null },
            },
          ],
        },
      }),
    );
  });

  it('rejects an internal actor instead of deriving an internal scope', async () => {
    const { service, database } = setup();
    const internal: ActorContext = {
      userId: actor.userId,
      departmentId: actor.departmentId,
      authorizationRevision: actor.authorizationRevision,
    };
    await expect(service.list(internal, 'PENDING', 1, 20)).rejects.toMatchObject({
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

  it('projects a processed decision in detail after revalidating the client binding', async () => {
    const { service, database } = setup();
    database.lead.findFirst.mockResolvedValue(processedLead);

    const result = await service.get(actor, lead.id);

    expect(database.customerAccountBinding.findFirst).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'WAITING_EVIDENCE_DECISION',
      reviewDecision: {
        result: 'INFRINGEMENT',
        reviewerDisplayName: '企业审核员',
        decidedAt: '2026-09-22T03:00:00.000Z',
      },
      capabilities: { review: false },
    });
  });
});
