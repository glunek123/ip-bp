import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { MaterialService } from '../materials';
import {
  CASE_TYPE_OPTIONS,
  INFRINGEMENT_TYPE_OPTIONS,
  PLATFORM_OPTIONS,
  SOURCE_OPTIONS,
} from './lead.constants';
import { LeadService } from './lead.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};

describe('LeadService', () => {
  it('exposes only the approved controlled dictionaries', () => {
    expect(CASE_TYPE_OPTIONS.map(({ value }) => value)).toEqual([
      'CIVIL',
      'CRIMINAL',
      'ADMINISTRATIVE',
      'INVESTIGATION',
      'NOTARIZATION',
      'HEARING_REPRESENTATION',
    ]);
    expect(INFRINGEMENT_TYPE_OPTIONS).toHaveLength(12);
    expect(SOURCE_OPTIONS.map(({ value }) => value)).toEqual([
      'ONLINE',
      'OFFLINE',
    ]);
    expect(PLATFORM_OPTIONS.ONLINE.map(({ value }) => value)).toEqual([
      'TAOBAO',
      'TMALL',
      'PINDUODUO',
      'JD',
      'DOUYIN',
      'ALIBABA_1688',
      'XIAOHONGSHU',
      'KUAISHOU',
      'XIANYU',
      'WECHAT',
      'OTHER',
    ]);
    expect(PLATFORM_OPTIONS.OFFLINE.map(({ value }) => value)).toEqual([
      'MEITUAN',
      'DIANPING',
      'MAP',
      'OTHER',
    ]);
  });

  it('returns all four status counters even when the database omits zero groups', async () => {
    const database = {
      lead: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest
          .fn()
          .mockResolvedValue([{ status: 'WAITING_PUSH', _count: { _all: 2 } }]),
      },
      $transaction: jest.fn(async (operations) => Promise.all(operations)),
    } as unknown as DatabaseService;
    const access = {
      buildLeadScope: jest
        .fn()
        .mockResolvedValue({ departmentId: actor.departmentId }),
      canAuthorizeNewLead: jest.fn().mockResolvedValue(true),
    } as unknown as AccessControlService;
    const service = new LeadService(database, access, {
      listCurrentReferenceVersionIds: jest.fn().mockResolvedValue([]),
    } as unknown as MaterialService);

    await expect(service.list(actor, 1, 20)).resolves.toMatchObject({
      counts: {
        WAITING_PUSH: 2,
        WAITING_REVIEW: 0,
        WAITING_EVIDENCE_DECISION: 0,
        ARCHIVED: 0,
      },
      capabilities: { create: true },
    });
  });

  it.each([
    [{ source: 'ONLINE', platform: 'MEITUAN' }, 'VALIDATION_ERROR'],
    [{ source: 'OFFLINE', platform: 'TAOBAO' }, 'VALIDATION_ERROR'],
    [
      {
        products: [
          {
            url: 'ftp://example.test/a',
            quantity: 1,
            unitPrice: '1.00',
            commentCount: 0,
          },
        ],
      },
      'VALIDATION_ERROR',
    ],
    [
      { products: [{ quantity: 1, unitPrice: '1.00', commentCount: 0 }] },
      'VALIDATION_ERROR',
    ],
    [
      {
        products: [
          { title: '商品', quantity: -1, unitPrice: '1.00', commentCount: 0 },
        ],
      },
      'VALIDATION_ERROR',
    ],
    [
      {
        products: [
          { title: '商品', quantity: 0.5, unitPrice: '1.00', commentCount: 0 },
        ],
      },
      'VALIDATION_ERROR',
    ],
  ])('rejects invalid domain input %#', async (override, code) => {
    const fixture = createCreateFixture();
    await expect(
      fixture.service.create(actor, 'key', {
        ...validCreate(),
        ...override,
      } as never),
    ).rejects.toMatchObject({ response: { code } });
    expect(fixture.transaction).not.toHaveBeenCalled();
  });

  it('calculates Decimal estimates and persists server-derived ownership', async () => {
    const fixture = createCreateFixture();
    const result = await fixture.service.create(actor, 'key', validCreate());
    expect(result.products).toEqual([
      expect.objectContaining({ unitPrice: '1.55', estimatedAmount: '4.65' }),
    ]);
    expect(fixture.tx.lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        teamId: null,
        status: 'WAITING_PUSH',
        creationChannel: 'MANUAL',
        externalSourceRef: null,
      }),
      include: expect.any(Object),
    });
  });

  it('replays the immutable receipt snapshot and rejects a changed request', async () => {
    const fixture = createCreateFixture();
    const snapshot = fixture.createdLead;
    fixture.tx.leadCommandReceipt.findUnique.mockResolvedValue({
      requestFingerprint: 'different',
      resultLeadId: snapshot.id,
      resultLeadVersion: 1,
      resultSnapshot: snapshot,
    });
    await expect(
      fixture.service.create(actor, 'key', validCreate()),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.tx.lead.create).not.toHaveBeenCalled();
  });

  it('rejects sequence 1000 without creating a lead', async () => {
    const fixture = createCreateFixture();
    fixture.tx.$queryRawUnsafe.mockResolvedValue([
      { sequence: 1000, business_date: new Date('2026-09-21') },
    ]);
    await expect(
      fixture.service.create(actor, 'key', validCreate()),
    ).rejects.toMatchObject({ response: { code: 'LEAD_NUMBER_EXHAUSTED' } });
    expect(fixture.tx.lead.create).not.toHaveBeenCalled();
  });

  it('prevents the database counter from incrementing past 999', async () => {
    const fixture = createCreateFixture();
    fixture.tx.$queryRawUnsafe.mockImplementation(async (sql: string) =>
      sql.includes('lead_number_counters')
        ? []
        : [{ customer_id: validCreate().customerId }],
    );
    await expect(
      fixture.service.create(actor, 'key', validCreate()),
    ).rejects.toMatchObject({ response: { code: 'LEAD_NUMBER_EXHAUSTED' } });
    expect(fixture.tx.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        'WHERE "lead_number_counters"."last_value" < 999',
      ),
    );
    expect(fixture.tx.lead.create).not.toHaveBeenCalled();
  });

  it('atomically pushes an authorized waiting lead and records an immutable result', async () => {
    const fixture = createPushFixture();
    const result = await fixture.service.push(
      actor,
      fixture.current.id,
      'push-key',
      { expectedVersion: 1 },
    );

    expect(fixture.access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'lead.push',
      {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      },
      fixture.tx,
    );
    expect(fixture.tx.lead.updateMany).toHaveBeenCalledWith({
      where: {
        id: fixture.current.id,
        departmentId: actor.departmentId,
        version: 1,
        status: 'WAITING_PUSH',
      },
      data: {
        status: 'WAITING_REVIEW',
        pushedAt: expect.any(Date),
        pushedByUserId: actor.userId,
        version: { increment: 1 },
      },
    });
    expect(fixture.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'lead.pushed',
        details: { fromVersion: 1, toVersion: 2 },
      }),
    });
    expect(fixture.tx.leadCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'push',
        idempotencyKey: 'push-key',
        resultLeadVersion: 2,
        resultSnapshot: expect.objectContaining({
          status: 'WAITING_REVIEW',
          pushedAt: expect.any(String),
          pushedByUserId: actor.userId,
        }),
      }),
    });
    expect(result).toMatchObject({
      status: 'WAITING_REVIEW',
      version: 2,
      pushedByUserId: actor.userId,
      pushedByDisplayName: '运营甲',
    });
  });

  it('replays the first push result and rejects the same key with a different version', async () => {
    const fixture = createPushFixture();
    const first = await fixture.service.push(
      actor,
      fixture.current.id,
      'same-key',
      { expectedVersion: 1 },
    );
    const receipt =
      fixture.tx.leadCommandReceipt.create.mock.calls[0]?.[0]?.data;
    const legacySnapshot = { ...receipt.resultSnapshot };
    Reflect.deleteProperty(legacySnapshot, 'pushedByDisplayName');
    receipt.resultSnapshot = legacySnapshot;
    fixture.tx.leadCommandReceipt.findUnique.mockResolvedValue(receipt);
    fixture.tx.lead.updateMany.mockClear();

    await expect(
      fixture.service.push(actor, fixture.current.id, 'same-key', {
        expectedVersion: 1,
      }),
    ).resolves.toEqual(first);
    await expect(
      fixture.service.push(actor, fixture.current.id, 'same-key', {
        expectedVersion: 2,
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(fixture.tx.lead.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong state', { status: 'WAITING_REVIEW' }, 'INVALID_STATE'],
    ['stale version', { version: 2 }, 'VERSION_CONFLICT'],
    ['no products', { products: [] }, 'LEAD_PRODUCTS_REQUIRED'],
    [
      'customer no longer admitted',
      { customer: { profileStatus: 'DRAFT', clientAccountBindings: [] } },
      'CUSTOMER_NOT_ADMITTED',
    ],
    [
      'no active client account',
      { customer: { profileStatus: 'ADMITTED', clientAccountBindings: [] } },
      'CLIENT_ACCOUNT_UNAVAILABLE',
    ],
  ])('rejects push when %s', async (_label, override, code) => {
    const fixture = createPushFixture(override);
    await expect(
      fixture.service.push(actor, fixture.current.id, `key-${code}`, {
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ response: { code } });
    expect(fixture.tx.lead.updateMany).not.toHaveBeenCalled();
  });

  it('rejects push without lead.push permission before mutation', async () => {
    const fixture = createPushFixture();
    (fixture.access.authorizeLead as jest.Mock).mockRejectedValue(
      new ForbiddenException('denied'),
    );
    await expect(
      fixture.service.push(actor, fixture.current.id, 'denied', {
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(fixture.tx.lead.updateMany).not.toHaveBeenCalled();
  });

  it('uses the database-returned Shanghai business date for sequence 999', async () => {
    const fixture = createCreateFixture();
    fixture.tx.$queryRawUnsafe.mockResolvedValue([
      { sequence: 999, business_date: new Date('2026-01-02T00:00:00.000Z') },
    ]);
    fixture.tx.lead.create.mockImplementation(async ({ data }) => ({
      ...fixture.createdLead,
      businessNo: data.businessNo,
      products: fixture.createdLead.products,
      infringements: fixture.createdLead.infringements,
    }));
    await expect(
      fixture.service.create(actor, 'key', validCreate()),
    ).resolves.toMatchObject({ businessNo: 'LD-20260102-999' });
  });

  it('adopts and freezes screenshot facts on the reserved Lead id', async () => {
    const fixture = createCreateFixture();
    const input = {
      ...validCreate(),
      reservedLeadId: fixture.createdLead.id,
      leadScreenshotContentVersionIds: ['66666666-6666-4666-8666-666666666666'],
    };
    const fact = {
      materialId: 'm',
      contentVersionId: input.leadScreenshotContentVersionIds[0],
    };
    (fixture.materials.assertAvailableVersions as jest.Mock).mockResolvedValue([
      fact,
    ]);
    await fixture.service.create(actor, 'reserved', input);
    expect(fixture.materials.assertAvailableVersions).toHaveBeenCalledWith(
      fixture.tx,
      actor,
      {
        ownerType: 'LEAD_DRAFT',
        ownerId: input.reservedLeadId,
        category: 'LEAD_SCREENSHOT',
        contentVersionIds: input.leadScreenshotContentVersionIds,
        minCount: 0,
        maxCount: 20,
      },
    );
    expect(fixture.materials.adoptLeadDraftVersions).toHaveBeenCalledWith(
      fixture.tx,
      {
        reservedLeadId: input.reservedLeadId,
        targetLeadId: input.reservedLeadId,
        versions: [fact],
      },
    );
    expect(fixture.materials.freezeReferences).toHaveBeenCalledWith(
      fixture.tx,
      {
        departmentId: actor.departmentId,
        resourceType: 'lead',
        resourceId: input.reservedLeadId,
        facts: [fact],
      },
    );
  });

  it('retries an edit transaction after P2034 and commits the next attempt', async () => {
    const fixture = createUpdateFixture();
    fixture.transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (callback) => callback(fixture.tx));
    await expect(
      fixture.service.update(actor, fixture.current.id, validUpdate()),
    ).resolves.toMatchObject({ id: fixture.current.id, version: 2 });
    expect(fixture.transaction).toHaveBeenCalledTimes(2);
  });

  it('replays the original create snapshot for the same idempotency intent', async () => {
    const fixture = createCreateFixture();
    const input = { ...validCreate(), reservedLeadId: fixture.createdLead.id };
    const first = await fixture.service.create(actor, 'same-key', input);
    const receiptData =
      fixture.tx.leadCommandReceipt.create.mock.calls[0]?.[0]?.data;
    fixture.tx.leadCommandReceipt.findUnique.mockResolvedValue(receiptData);
    fixture.tx.lead.create.mockClear();
    await expect(
      fixture.service.create(actor, 'same-key', input),
    ).resolves.toEqual(first);
    expect(fixture.tx.lead.create).not.toHaveBeenCalled();
  });

  it('rejects an inactive current Team before allocating a number', async () => {
    const fixture = createCreateFixture();
    fixture.tx.departmentMembership.findFirst.mockResolvedValue({
      active: true,
      teamId: '77777777-7777-4777-8777-777777777777',
      team: { status: 'INACTIVE' },
    });
    await expect(
      fixture.service.create(actor, 'inactive-team', validCreate()),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(fixture.tx.lead.create).not.toHaveBeenCalled();
  });

  it('hides an unadmitted customer and an invalid holder relationship', async () => {
    const fixture = createCreateFixture();
    fixture.tx.customer.findFirst.mockResolvedValue(null);
    await expect(
      fixture.service.create(actor, 'hidden-customer', validCreate()),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.tx.lead.create).not.toHaveBeenCalled();
  });

  it.each([
    ['WAITING_REVIEW', 1, 'INVALID_STATE'],
    ['WAITING_PUSH', 2, 'VERSION_CONFLICT'],
  ])('rejects edit state/version %s/%s', async (status, version, code) => {
    const fixture = createUpdateFixture();
    fixture.current.status = status;
    fixture.current.version = version;
    await expect(
      fixture.service.update(actor, fixture.current.id, validUpdate() as never),
    ).rejects.toMatchObject({ response: { code } });
    expect(fixture.tx.lead.updateMany).not.toHaveBeenCalled();
  });

  it('propagates audit failure from the edit transaction', async () => {
    const fixture = createUpdateFixture();
    fixture.tx.auditEvent.create.mockRejectedValue(new Error('audit failed'));
    await expect(
      fixture.service.update(actor, fixture.current.id, validUpdate()),
    ).rejects.toThrow('audit failed');
  });

  it('does not report unchanged edit fields as audit changes', async () => {
    const fixture = createUpdateFixture();
    await fixture.service.update(actor, fixture.current.id, validUpdate());
    expect(fixture.tx.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        details: { fromVersion: 1, toVersion: 2, changedFields: [] },
      }),
    });
  });

  it('rejects a missing current customer-rights-holder relationship', async () => {
    const fixture = createCreateFixture();
    fixture.tx.customerRightsHolderLink.findFirst.mockResolvedValue(null);
    await expect(
      fixture.service.create(actor, 'missing-link', validCreate()),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });

  it('propagates reserved screenshot owner/version rejection before Lead creation', async () => {
    const fixture = createCreateFixture();
    (fixture.materials.assertAvailableVersions as jest.Mock).mockRejectedValue({
      response: { code: 'MATERIAL_VERSION_INVALID' },
    });
    await expect(
      fixture.service.create(actor, 'foreign-shot', {
        ...validCreate(),
        reservedLeadId: fixture.createdLead.id,
        leadScreenshotContentVersionIds: [
          '66666666-6666-4666-8666-666666666666',
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'MATERIAL_VERSION_INVALID' } });
    expect(fixture.tx.lead.create).not.toHaveBeenCalled();
  });

  it('keeps Lead, children, material and receipt writes in the audit transaction', async () => {
    const fixture = createCreateFixture();
    const versionId = '66666666-6666-4666-8666-666666666666';
    const fact = { materialId: 'm', contentVersionId: versionId };
    (fixture.materials.assertAvailableVersions as jest.Mock).mockResolvedValue([
      fact,
    ]);
    fixture.tx.auditEvent.create.mockRejectedValue(new Error('audit failed'));
    await expect(
      fixture.service.create(actor, 'audit-rollback', {
        ...validCreate(),
        reservedLeadId: fixture.createdLead.id,
        leadScreenshotContentVersionIds: [versionId],
      }),
    ).rejects.toThrow('audit failed');
    expect(fixture.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(fixture.materials.adoptLeadDraftVersions).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({ versions: [fact] }),
    );
    expect(fixture.materials.freezeReferences).toHaveBeenCalledWith(
      fixture.tx,
      expect.objectContaining({ facts: [fact] }),
    );
    expect(fixture.tx.leadCommandReceipt.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      'SELF',
      { departmentId: actor.departmentId, responsibleUserId: actor.userId },
    ],
    ['TEAM', { departmentId: actor.departmentId, teamId: { in: ['team-a'] } }],
    ['DEPARTMENT', { departmentId: actor.departmentId }],
  ])('applies the %s Lead scope to list and detail', async (_label, scope) => {
    const lead = createCreateFixture().createdLead;
    const leadRepo = {
      findMany: jest.fn().mockResolvedValue([lead]),
      count: jest.fn().mockResolvedValue(1),
      groupBy: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(lead),
    };
    const database = { lead: leadRepo } as unknown as DatabaseService;
    const access = {
      buildLeadScope: jest.fn().mockResolvedValue(scope),
      canAuthorizeNewLead: jest.fn().mockResolvedValue(false),
      authorizeLead: jest.fn().mockResolvedValue(undefined),
    } as unknown as AccessControlService;
    const listCurrentReferenceVersionIds = jest
      .fn()
      .mockResolvedValue(['version-a']);
    const service = new LeadService(database, access, {
      listCurrentReferenceVersionIds,
    } as unknown as MaterialService);
    const listResult = await service.list(actor, 1, 20);
    const detailResult = await service.get(actor, lead.id);
    expect(leadRepo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: scope }),
    );
    expect(leadRepo.findFirst).toHaveBeenCalledWith({
      where: { id: lead.id, ...scope },
      include: expect.any(Object),
    });
    expect(listCurrentReferenceVersionIds).toHaveBeenCalledTimes(2);
    expect(listCurrentReferenceVersionIds).toHaveBeenCalledWith(
      database,
      actor,
      {
        resourceType: 'lead',
        resourceId: lead.id,
        purpose: 'LEAD_SCREENSHOT',
      },
    );
    expect(listResult.items[0]?.leadScreenshotContentVersionIds).toEqual([
      'version-a',
    ]);
    expect(detailResult.leadScreenshotContentVersionIds).toEqual(['version-a']);
  });

  it.each([
    ['granted', 'WAITING_PUSH', true, true],
    ['read-only', 'WAITING_PUSH', false, false],
    ['wrong state', 'WAITING_REVIEW', true, false],
  ])(
    'reports edit capability for %s detail',
    async (_label, status, editVisible, expected) => {
      const lead = { ...createCreateFixture().createdLead, status };
      const leadRepo = {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(lead)
          .mockResolvedValueOnce(editVisible ? { id: lead.id } : null),
      };
      const database = { lead: leadRepo } as unknown as DatabaseService;
      const access = {
        buildLeadScope: jest
          .fn()
          .mockResolvedValueOnce({ departmentId: actor.departmentId })
          .mockResolvedValueOnce(
            editVisible
              ? { departmentId: actor.departmentId }
              : { id: '__never__' },
          ),
        authorizeLead: jest.fn().mockResolvedValue(undefined),
      } as unknown as AccessControlService;
      const service = new LeadService(database, access, {
        listCurrentReferenceVersionIds: jest.fn().mockResolvedValue([]),
      } as unknown as MaterialService);

      await expect(service.get(actor, lead.id)).resolves.toMatchObject({
        capabilities: { edit: expected },
      });
      expect(access.buildLeadScope).toHaveBeenNthCalledWith(
        1,
        actor,
        'lead.read',
      );
      if (status === 'WAITING_PUSH') {
        expect(access.buildLeadScope).toHaveBeenNthCalledWith(
          2,
          actor,
          'lead.edit',
        );
      } else {
        expect(access.buildLeadScope).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('filters list items and total by status while keeping global counters', async () => {
    const scope = { departmentId: actor.departmentId };
    const leadRepo = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    };
    const database = { lead: leadRepo } as unknown as DatabaseService;
    const access = {
      buildLeadScope: jest.fn().mockResolvedValue(scope),
      canAuthorizeNewLead: jest.fn().mockResolvedValue(false),
    } as unknown as AccessControlService;
    const service = new LeadService(database, access, {
      listCurrentReferenceVersionIds: jest.fn(),
    } as unknown as MaterialService);

    await service.list(actor, 2, 20, 'WAITING_PUSH');
    expect(leadRepo.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...scope, status: 'WAITING_PUSH' },
        skip: 20,
        take: 20,
      }),
    );
    expect(leadRepo.count).toHaveBeenCalledWith({
      where: { ...scope, status: 'WAITING_PUSH' },
    });
    expect(leadRepo.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: scope }),
    );
  });

  it('returns RESOURCE_NOT_FOUND when a scoped detail query cannot see the Lead', async () => {
    const database = {
      lead: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as DatabaseService;
    const access = {
      buildLeadScope: jest.fn().mockResolvedValue({
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      }),
    } as unknown as AccessControlService;
    await expect(
      new LeadService(database, access, {} as MaterialService).get(
        actor,
        'hidden',
      ),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });

  it('queries form context with visible ADMITTED scope and returns current linked holders', async () => {
    const customerFindMany = jest.fn().mockResolvedValue([
      {
        id: 'c',
        name: '客户',
        rightsHolderLinks: [{ rightsHolder: { id: 'r', name: '主体' } }],
      },
    ]);
    const database = {
      customer: { findMany: customerFindMany },
    } as unknown as DatabaseService;
    const access = {
      canAuthorizeNewLead: jest.fn().mockResolvedValue(true),
      buildCustomerScope: jest.fn().mockResolvedValue({
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      }),
    } as unknown as AccessControlService;
    await expect(
      new LeadService(database, access, {} as MaterialService).formContext(
        actor,
      ),
    ).resolves.toMatchObject({
      customers: [{ id: 'c', rightsHolders: [{ id: 'r' }] }],
    });
    expect(customerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          responsibleUserId: actor.userId,
          profileStatus: 'ADMITTED',
        },
        select: expect.objectContaining({
          rightsHolderLinks: expect.any(Object),
        }),
      }),
    );
  });

  it('returns a scoped edit context without requiring lead.create', async () => {
    const leadFindFirst = jest.fn().mockResolvedValue({
      id: 'lead-1',
      status: 'WAITING_PUSH',
      customerId: 'customer-1',
      rightsHolderId: 'holder-1',
    });
    const customerFindFirst = jest.fn().mockResolvedValue({
      id: 'customer-1',
      name: '客户甲',
      rightsHolderLinks: [{ rightsHolder: { id: 'holder-1', name: '主体甲' } }],
    });
    const database = {
      lead: { findFirst: leadFindFirst },
      customer: { findFirst: customerFindFirst },
    } as unknown as DatabaseService;
    const access = {
      buildLeadScope: jest.fn().mockResolvedValue({
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      }),
      buildCustomerScope: jest.fn().mockResolvedValue({
        departmentId: actor.departmentId,
      }),
      canAuthorizeNewLead: jest.fn().mockResolvedValue(false),
    } as unknown as AccessControlService;

    await expect(
      new LeadService(database, access, {} as MaterialService).editContext(
        actor,
        'lead-1',
      ),
    ).resolves.toMatchObject({
      customers: [
        {
          id: 'customer-1',
          name: '客户甲',
          rightsHolders: [{ id: 'holder-1', name: '主体甲' }],
        },
      ],
      dictionaries: { caseTypes: CASE_TYPE_OPTIONS },
    });
    expect(access.buildLeadScope).toHaveBeenCalledWith(actor, 'lead.edit');
    expect(access.buildCustomerScope).toHaveBeenCalledWith(
      actor,
      'customer.read',
    );
    expect(access.canAuthorizeNewLead).not.toHaveBeenCalled();
  });

  it('rejects edit context without lead.edit before reading Lead facts', async () => {
    const leadFindFirst = jest.fn();
    const access = {
      buildLeadScope: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('denied')),
    } as unknown as AccessControlService;
    const database = {
      lead: { findFirst: leadFindFirst },
    } as unknown as DatabaseService;

    await expect(
      new LeadService(database, access, {} as MaterialService).editContext(
        actor,
        'lead-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(leadFindFirst).not.toHaveBeenCalled();
  });

  it('hides a Lead outside edit scope from edit context', async () => {
    const database = {
      lead: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as DatabaseService;
    const access = {
      buildLeadScope: jest.fn().mockResolvedValue({
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      }),
    } as unknown as AccessControlService;

    await expect(
      new LeadService(database, access, {} as MaterialService).editContext(
        actor,
        'foreign-lead',
      ),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
  });

  it('rejects edit context after the Lead leaves WAITING_PUSH', async () => {
    const database = {
      lead: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'lead-1',
          status: 'WAITING_REVIEW',
          customerId: 'customer-1',
          rightsHolderId: 'holder-1',
        }),
      },
    } as unknown as DatabaseService;
    const access = {
      buildLeadScope: jest.fn().mockResolvedValue({
        departmentId: actor.departmentId,
      }),
    } as unknown as AccessControlService;

    await expect(
      new LeadService(database, access, {} as MaterialService).editContext(
        actor,
        'lead-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
  });

  it('applies customer.read scope inside create transaction', async () => {
    const fixture = createCreateFixture();
    const customerScope = {
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
    };
    (fixture.access.buildCustomerScope as jest.Mock).mockResolvedValue(
      customerScope,
    );
    await fixture.service.create(actor, 'customer-scope', validCreate());
    expect(fixture.access.buildCustomerScope).toHaveBeenCalledWith(
      actor,
      'customer.read',
      fixture.tx,
    );
    expect(fixture.tx.customer.findFirst).toHaveBeenCalledWith({
      where: {
        id: validCreate().customerId,
        ...customerScope,
        profileStatus: 'ADMITTED',
      },
      select: { id: true },
    });
  });

  it('edits only Lead-owned screenshots and replaces only mutable draft references', async () => {
    const fixture = createUpdateFixture();
    const versionId = '66666666-6666-4666-8666-666666666666';
    const fact = { contentVersionId: versionId };
    (fixture.materials.assertAvailableVersions as jest.Mock).mockResolvedValue([
      fact,
    ]);
    (fixture.materials.replaceCurrentReferences as jest.Mock).mockResolvedValue(
      {
        beforeVersionIds: ['version-old'],
        afterVersionIds: [versionId],
        changed: true,
      },
    );
    const result = await fixture.service.update(actor, fixture.current.id, {
      ...validUpdate(),
      leadScreenshotContentVersionIds: [versionId],
    });
    expect(fixture.materials.assertAvailableVersions).toHaveBeenCalledWith(
      fixture.tx,
      actor,
      {
        ownerType: 'LEAD',
        ownerId: fixture.current.id,
        category: 'LEAD_SCREENSHOT',
        contentVersionIds: [versionId],
        minCount: 0,
        maxCount: 20,
        leadAction: 'lead.edit',
      },
    );
    expect(fixture.materials.adoptLeadDraftVersions).not.toHaveBeenCalled();
    expect(fixture.materials.replaceCurrentReferences).toHaveBeenCalledWith(
      fixture.tx,
      actor,
      {
        resourceType: 'lead',
        resourceId: fixture.current.id,
        purpose: 'LEAD_SCREENSHOT',
        versions: [fact],
      },
    );
    expect(result.leadScreenshotContentVersionIds).toEqual([versionId]);
  });

  it('rejects a screenshot owned by another Lead before replacing references', async () => {
    const fixture = createUpdateFixture();
    (fixture.materials.assertAvailableVersions as jest.Mock).mockRejectedValue({
      response: { code: 'MATERIAL_VERSION_INVALID' },
    });
    await expect(
      fixture.service.update(actor, fixture.current.id, {
        ...validUpdate(),
        leadScreenshotContentVersionIds: [
          '66666666-6666-4666-8666-666666666666',
        ],
      }),
    ).rejects.toMatchObject({
      response: { code: 'MATERIAL_VERSION_INVALID' },
    });
    expect(fixture.materials.replaceCurrentReferences).not.toHaveBeenCalled();
  });

  it.each([
    [['version-a'], [], true],
    [['version-a'], ['version-a'], false],
    [['version-a'], ['version-b'], true],
  ] as const)(
    'audits screenshot collection %j -> %j with changed=%s',
    async (beforeVersionIds, afterVersionIds, changed) => {
      const fixture = createUpdateFixture();
      const facts = afterVersionIds.map((contentVersionId) => ({
        contentVersionId,
      }));
      (
        fixture.materials.assertAvailableVersions as jest.Mock
      ).mockResolvedValue(facts);
      (
        fixture.materials.replaceCurrentReferences as jest.Mock
      ).mockResolvedValue({ beforeVersionIds, afterVersionIds, changed });
      await fixture.service.update(actor, fixture.current.id, {
        ...validUpdate(),
        leadScreenshotContentVersionIds: [...afterVersionIds],
      });
      const changedFields =
        fixture.tx.auditEvent.create.mock.calls[0]?.[0]?.data.details
          .changedFields;
      expect(changedFields.includes('leadScreenshotContentVersionIds')).toBe(
        changed,
      );
      expect(fixture.tx).not.toHaveProperty('materialReference');
    },
  );

  it('hides a customer outside customer.read scope during create', async () => {
    const fixture = createCreateFixture();
    (fixture.access.buildCustomerScope as jest.Mock).mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: '99999999-9999-4999-8999-999999999999',
    });
    fixture.tx.customer.findFirst.mockResolvedValue(null);
    await expect(
      fixture.service.create(actor, 'scope-hidden', validCreate()),
    ).rejects.toMatchObject({
      response: { code: 'RESOURCE_NOT_FOUND' },
    });
  });

  it('edits with customer.read but without lead.create while keeping relations immutable', async () => {
    const fixture = createUpdateFixture();
    await fixture.service.update(actor, fixture.current.id, validUpdate());
    expect(fixture.access.buildCustomerScope).toHaveBeenCalledWith(
      actor,
      'customer.read',
      fixture.tx,
    );
    expect(fixture.access.canAuthorizeNewLead).not.toHaveBeenCalled();
    expect(fixture.tx.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({
          rightsHolderId: expect.anything(),
        }),
      }),
    );
  });

  it.each([
    [
      'current customer is outside customer.read scope',
      (fixture: ReturnType<typeof createUpdateFixture>) => {
        (fixture.access.buildCustomerScope as jest.Mock).mockRejectedValueOnce(
          new ForbiddenException('denied'),
        );
      },
    ],
    [
      'current customer is no longer ADMITTED',
      (fixture: ReturnType<typeof createUpdateFixture>) => {
        fixture.tx.customer.findFirst.mockResolvedValueOnce(null);
      },
    ],
    [
      'current customer-rights holder link no longer exists',
      (fixture: ReturnType<typeof createUpdateFixture>) => {
        fixture.tx.$queryRawUnsafe.mockImplementationOnce(async () => [
          { id: fixture.current.id },
        ]);
        fixture.tx.$queryRawUnsafe.mockImplementationOnce(async () => []);
      },
    ],
  ])('rejects edit without writes when %s', async (_reason, arrange) => {
    const fixture = createUpdateFixture();
    arrange(fixture);

    await expect(
      fixture.service.update(actor, fixture.current.id, validUpdate()),
    ).rejects.toMatchObject({ response: { code: 'RESOURCE_NOT_FOUND' } });
    expect(fixture.tx.lead.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.leadProduct.deleteMany).not.toHaveBeenCalled();
    expect(fixture.tx.leadInfringement.deleteMany).not.toHaveBeenCalled();
    expect(fixture.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(fixture.materials.replaceCurrentReferences).not.toHaveBeenCalled();
  });

  it('persists estimates computed from quantity, comment fallback, zero and max money', async () => {
    const fixture = createCreateFixture();
    await fixture.service.create(actor, 'amounts', {
      ...validCreate(),
      products: [
        { title: '销量', quantity: 2, unitPrice: '1.55', commentCount: 9 },
        { title: '评论', quantity: 0, unitPrice: '1.55', commentCount: 3 },
        { title: '零', quantity: 0, unitPrice: '0', commentCount: 0 },
        {
          title: '边界',
          quantity: 1,
          unitPrice: '9999999999999999.99',
          commentCount: 0,
        },
      ],
    });
    const products =
      fixture.tx.lead.create.mock.calls[0]?.[0]?.data.products.create;
    expect(
      products.map(
        (product: { estimatedAmount: { toFixed(scale: number): string } }) =>
          product.estimatedAmount.toFixed(2),
      ),
    ).toEqual(['3.10', '4.65', '0.00', '9999999999999999.99']);
  });

  it('retries create once on P2034 and then succeeds', async () => {
    const fixture = createCreateFixture();
    fixture.transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (callback) => callback(fixture.tx));
    await expect(
      fixture.service.create(actor, 'create-retry', validCreate()),
    ).resolves.toMatchObject({ status: 'WAITING_PUSH' });
    expect(fixture.transaction).toHaveBeenCalledTimes(2);
  });

  it('retries the PostgreSQL adapter form of a serialization conflict', async () => {
    const fixture = createCreateFixture();
    fixture.transaction
      .mockRejectedValueOnce({
        code: 'P2010',
        meta: {
          driverAdapterError: { cause: { originalCode: '40001' } },
        },
      })
      .mockImplementationOnce(async (callback) => callback(fixture.tx));
    await expect(
      fixture.service.create(actor, 'adapter-retry', validCreate()),
    ).resolves.toMatchObject({ status: 'WAITING_PUSH' });
    expect(fixture.transaction).toHaveBeenCalledTimes(2);
  });

  it.each(['create', 'edit'] as const)(
    'maps three exhausted P2034 %s attempts to VERSION_CONFLICT',
    async (operation) => {
      const fixture =
        operation === 'create' ? createCreateFixture() : createUpdateFixture();
      fixture.transaction.mockRejectedValue({ code: 'P2034' });
      const result =
        operation === 'create'
          ? fixture.service.create(actor, 'exhausted', validCreate())
          : fixture.service.update(
              actor,
              createUpdateFixture().current.id,
              validUpdate(),
            );
      await expect(result).rejects.toMatchObject({
        response: { code: 'VERSION_CONFLICT' },
      });
      expect(fixture.transaction).toHaveBeenCalledTimes(3);
    },
  );
});

function validCreate() {
  return {
    customerId: '33333333-3333-4333-8333-333333333333',
    rightsHolderId: '44444444-4444-4444-8444-444444444444',
    caseType: 'CIVIL' as const,
    infringementTypes: ['TRADEMARK' as const],
    source: 'ONLINE' as const,
    platform: 'TAOBAO' as const,
    foundAt: '2026-09-21T04:00:00.000Z',
    shopName: '店铺',
    needDisclose: false,
    products: [
      { title: '商品', quantity: 3, unitPrice: '1.55', commentCount: 9 },
    ],
    leadScreenshotContentVersionIds: [],
  };
}

function createCreateFixture() {
  const createdLead = {
    id: '55555555-5555-4555-8555-555555555555',
    businessNo: 'LD-20260921-001',
    departmentId: actor.departmentId,
    customerId: validCreate().customerId,
    rightsHolderId: validCreate().rightsHolderId,
    responsibleUserId: actor.userId,
    teamId: null,
    status: 'WAITING_PUSH',
    caseType: 'CIVIL',
    source: 'ONLINE',
    platform: 'TAOBAO',
    foundAt: new Date(validCreate().foundAt),
    shopName: '店铺',
    shopExternalId: null,
    needDisclose: false,
    remark: null,
    creationChannel: 'MANUAL',
    externalSourceRef: null,
    version: 1,
    createdAt: new Date('2026-09-21T04:00:00Z'),
    updatedAt: new Date('2026-09-21T04:00:00Z'),
    products: [
      {
        id: 'p',
        position: 1,
        url: null,
        title: '商品',
        quantity: 3,
        unitPrice: { toFixed: () => '1.55' },
        commentCount: 9,
        estimatedAmount: { toFixed: () => '4.65' },
      },
    ],
    infringements: [{ type: 'TRADEMARK' }],
  };
  const tx = {
    $queryRawUnsafe: jest
      .fn()
      .mockImplementation(async (sql: string) =>
        sql.includes('lead_number_counters')
          ? [{ sequence: 1, business_date: new Date('2026-09-21') }]
          : [{ customer_id: validCreate().customerId }],
      ),
    customer: {
      findFirst: jest.fn().mockResolvedValue({
        id: validCreate().customerId,
        profileStatus: 'ADMITTED',
      }),
    },
    customerRightsHolderLink: {
      findFirst: jest.fn().mockResolvedValue({ id: 'link' }),
    },
    departmentMembership: {
      findFirst: jest.fn().mockResolvedValue({ active: true, teamId: null }),
    },
    leadCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    lead: { create: jest.fn().mockResolvedValue(createdLead) },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
  };
  const transaction = jest.fn(async (callback) => callback(tx));
  const database = { $transaction: transaction } as unknown as DatabaseService;
  const access = {
    canAuthorizeNewLead: jest.fn().mockResolvedValue(true),
    authorizeLead: jest.fn().mockResolvedValue(undefined),
    buildCustomerScope: jest
      .fn()
      .mockResolvedValue({ departmentId: actor.departmentId }),
  } as unknown as AccessControlService;
  const materials = {
    assertAvailableVersions: jest.fn().mockResolvedValue([]),
    adoptLeadDraftVersions: jest.fn().mockResolvedValue(undefined),
    freezeReferences: jest.fn().mockResolvedValue(undefined),
  } as unknown as MaterialService;
  return {
    service: new LeadService(database, access, materials),
    transaction,
    tx,
    createdLead,
    materials,
    access,
  };
}

function validUpdate() {
  const create = validCreate();
  return {
    caseType: create.caseType,
    infringementTypes: create.infringementTypes,
    source: create.source,
    platform: create.platform,
    foundAt: create.foundAt,
    shopName: create.shopName,
    needDisclose: create.needDisclose,
    products: create.products,
    leadScreenshotContentVersionIds: create.leadScreenshotContentVersionIds,
    expectedVersion: 1,
  };
}

function createUpdateFixture() {
  const current = { ...createCreateFixture().createdLead };
  const updated = { ...current, version: 2 };
  const tx = {
    $queryRawUnsafe: jest
      .fn()
      .mockImplementation(async (sql: string) =>
        sql.includes('FROM "leads"')
          ? [{ id: current.id }]
          : [{ customer_id: current.customerId }],
      ),
    lead: {
      findFirst: jest.fn().mockResolvedValue(current),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(updated),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: current.customerId }),
    },
    customerRightsHolderLink: {
      findFirst: jest.fn().mockResolvedValue({ id: 'link' }),
    },
    leadProduct: { deleteMany: jest.fn(), createMany: jest.fn() },
    leadInfringement: { deleteMany: jest.fn(), createMany: jest.fn() },
    auditEvent: { create: jest.fn() },
  };
  const transaction = jest.fn(async (callback) => callback(tx));
  const database = { $transaction: transaction } as unknown as DatabaseService;
  const access = {
    buildLeadScope: jest
      .fn()
      .mockResolvedValue({ departmentId: actor.departmentId }),
    buildCustomerScope: jest
      .fn()
      .mockResolvedValue({ departmentId: actor.departmentId }),
    canAuthorizeNewLead: jest.fn().mockResolvedValue(false),
  } as unknown as AccessControlService;
  const materials = {
    assertAvailableVersions: jest.fn().mockResolvedValue([]),
    adoptLeadDraftVersions: jest.fn(),
    freezeReferences: jest.fn(),
    replaceCurrentReferences: jest.fn().mockResolvedValue({
      beforeVersionIds: [],
      afterVersionIds: [],
      changed: false,
    }),
  } as unknown as MaterialService;
  return {
    service: new LeadService(database, access, materials),
    transaction,
    tx,
    current,
    materials,
    access,
  };
}

function createPushFixture(override: Record<string, unknown> = {}) {
  const base = createCreateFixture().createdLead;
  const current = {
    ...base,
    pushedAt: null,
    pushedByUserId: null,
    customer: {
      profileStatus: 'ADMITTED',
      clientAccountBindings: [{ user: { active: true }, active: true }],
    },
    ...override,
  };
  const pushedAt = new Date('2026-09-22T04:00:00.000Z');
  const updated = {
    ...current,
    status: 'WAITING_REVIEW',
    version: 2,
    pushedAt,
    pushedByUserId: actor.userId,
  };
  const tx = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: current.id }]),
    leadCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    lead: {
      findFirst: jest.fn().mockResolvedValue(current),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(updated),
    },
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({ displayName: '运营甲' }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-push' }) },
  };
  const transaction = jest.fn(async (callback) => callback(tx));
  const database = {
    $transaction: transaction,
    leadCommandReceipt: { findUnique: jest.fn().mockResolvedValue(null) },
    userAccount: {
      findUnique: jest.fn().mockResolvedValue({ displayName: '运营甲' }),
    },
  } as unknown as DatabaseService;
  const access = {
    authorizeLead: jest.fn().mockResolvedValue(undefined),
  } as unknown as AccessControlService;
  const materials = {
    listCurrentReferenceVersionIds: jest.fn().mockResolvedValue([]),
  } as unknown as MaterialService;
  return {
    service: new LeadService(database, access, materials),
    transaction,
    tx,
    current,
    access,
  };
}
