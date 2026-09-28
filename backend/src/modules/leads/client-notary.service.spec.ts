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
      findFirst: jest.fn().mockResolvedValue({
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
      findMany: jest.fn().mockResolvedValue([
        {
          materialId: 'photo-1',
          contentVersionId: 'frozen-1',
          contentVersion: {
            originalFilename: 'opening.png',
            mimeType: 'image/png',
          },
          actionEvent: { details: { contentVersionIds: ['frozen-1'] } },
        },
      ]),
    },
  };
  return { database, service: new ClientNotaryService(database as never) };
}

describe('ClientNotaryService', () => {
  it.each([
    ['WAITING_CERTIFICATE', 'ISSUE'],
    ['WAITING_RETURN', 'NO_ISSUE'],
  ] as const)(
    'retains own historical %s decision without internal fields',
    async (stage, decision) => {
      const { service, database } = fixture();
      const decidedAt = new Date('2026-09-28T02:00:00.000Z');
      const reviewed = {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'INTERNAL',
        actorDisplayNameSnapshot: '运营',
        decidedAt,
        archivedAt: null,
      };
      database.notaryMatter.findFirst.mockResolvedValue({
        ...matter,
        stage,
        openingReviewDecision: reviewed,
        issuanceDecision: {
          decision,
          actorDisplayNameSnapshot: '运营',
          actorUserId: 'internal-secret',
          decidedAt,
        },
      });
      database.notaryMatter.findMany.mockResolvedValue([
        {
          ...matter,
          stage,
          openingReviewDecision: reviewed,
          issuanceDecision: { decision, decidedAt },
        },
      ]);
      const detail = await service.get(actor, matterId);
      const list = await service.list(actor, 1, 20, 'lead-1');
      expect(detail).toMatchObject({
        stage,
        reviewDecision: { result: 'INFRINGEMENT' },
        issuanceDecision: { decision, decidedAt: decidedAt.toISOString() },
      });
      expect(list.items[0].stage).toBe(stage);
      expect(JSON.stringify(detail)).not.toMatch(
        /internal-secret|actorUserId|senderPhone|teamId|responsibleUserId/u,
      );
    },
  );

  it('rejects a waiting stage whose immutable issuance fact names the opposite choice', async () => {
    const { service, database } = fixture();
    database.notaryMatter.findFirst.mockResolvedValue({
      ...matter,
      stage: 'WAITING_CERTIFICATE',
      openingReviewDecision: {
        result: 'INFRINGEMENT',
        reason: null,
        actorKind: 'INTERNAL',
        actorDisplayNameSnapshot: '运营',
        decidedAt: new Date(),
        archivedAt: null,
      },
      issuanceDecision: { decision: 'NO_ISSUE', decidedAt: new Date() },
    });
    await expect(service.get(actor, matterId)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('lists opened batches for one pushed source lead including a reviewed batch', async () => {
    const { service, database } = fixture();
    database.notaryMatter.findMany.mockResolvedValue([
      {
        ...matter,
        stage: 'ARCHIVED',
        openingReviewDecision: {
          result: 'NO_INFRINGEMENT',
          reason: '不侵权',
          decidedAt: new Date('2026-09-28T01:00:00Z'),
          archivedAt: new Date('2026-09-28T01:00:00Z'),
        },
      },
      matter,
    ]);
    database.notaryMatter.count.mockResolvedValue(2);
    const result = await service.list(actor, 1, 20, 'lead-1');
    expect(database.notaryMatter.findMany.mock.calls[0][0].where).toMatchObject(
      {
        sourceLeadId: 'lead-1',
        departmentId: actor.departmentId,
        customerId: actor.clientCustomerId,
        stage: {
          in: [
            'UNBOX_REVIEW',
            'ISSUANCE_DECISION',
            'WAITING_CERTIFICATE',
            'WAITING_RETURN',
            'ARCHIVED',
          ],
        },
        sourceLead: { pushedAt: { not: null }, pushedByUserId: { not: null } },
      },
    );
    expect(result.items.map((item: { stage: string }) => item.stage)).toEqual([
      'ARCHIVED',
      'UNBOX_REVIEW',
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /secret|sender|logistics|fee|teamId|responsibleUserId|sourceSnapshot/u,
    );
  });
  it('hides a same-matter reference whose opening audit did not freeze its version', async () => {
    const { service, database } = fixture();
    database.materialReference.findMany.mockResolvedValue([
      {
        materialId: 'unsubmitted-photo',
        contentVersionId: 'unsubmitted-version',
        contentVersion: {
          originalFilename: 'unsubmitted.png',
          mimeType: 'image/png',
        },
        actionEvent: { details: { contentVersionIds: ['frozen-1'] } },
      },
    ]);
    await expect(service.get(actor, matterId)).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it.each([
    [
      'infringement stage with no-infringement decision',
      'ISSUANCE_DECISION',
      'NO_INFRINGEMENT',
      '不侵权',
      null,
    ],
    [
      'archive stage with infringement decision',
      'ARCHIVED',
      'INFRINGEMENT',
      null,
      null,
    ],
    [
      'archive without archive time',
      'ARCHIVED',
      'NO_INFRINGEMENT',
      '不侵权',
      null,
    ],
    [
      'archive without reason',
      'ARCHIVED',
      'NO_INFRINGEMENT',
      null,
      new Date('2026-09-28T01:00:00Z'),
    ],
  ])(
    'hides inconsistent %s',
    async (_name, stage, result, reason, archivedAt) => {
      const { service, database } = fixture();
      database.notaryMatter.findFirst.mockResolvedValue({
        ...matter,
        stage,
        openingReviewDecision: {
          result,
          reason,
          archivedAt,
          actorKind: 'CLIENT',
          actorDisplayNameSnapshot: '客户甲',
          decidedAt: new Date('2026-09-28T01:00:00Z'),
        },
      });
      await expect(service.get(actor, matterId)).rejects.toMatchObject({
        response: { code: 'RESOURCE_NOT_FOUND' },
      });
    },
  );
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
