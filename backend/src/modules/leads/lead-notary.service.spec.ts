import { ForbiddenException } from '@nestjs/common';
import { LeadNotaryService } from './lead-notary.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const leadId = '33333333-3333-4333-8333-333333333333';
const matterId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const productId = '44444444-4444-4444-8444-444444444444';
const officeId = '55555555-5555-4555-8555-555555555555';

function fixture(status = 'WAITING_EVIDENCE_DECISION') {
  const lead = {
    id: leadId,
    businessNo: 'LD-20260924-001',
    departmentId: actor.departmentId,
    customerId: '66666666-6666-4666-8666-666666666666',
    rightsHolderId: '77777777-7777-4777-8777-777777777777',
    responsibleUserId: actor.userId,
    teamId: null,
    status,
    version: status === 'WAITING_EVIDENCE_DECISION' ? 3 : 4,
    activeReviewDecisionId: '88888888-8888-4888-8888-888888888888',
    reviewDecision: {
      id: '88888888-8888-4888-8888-888888888888',
      result: 'INFRINGEMENT',
    },
    evidenceDecision: null,
    customer: { profileStatus: 'ADMITTED' },
    products: [
      {
        id: productId,
        position: 1,
        title: '商品',
        url: 'https://example.test',
        quantity: 1,
        unitPrice: { toFixed: () => '10.00' },
        commentCount: 0,
        estimatedAmount: { toFixed: () => '10.00' },
      },
    ],
    caseType: 'CIVIL',
    source: 'ONLINE',
    platform: 'TAOBAO',
    shopName: '店铺',
    foundAt: new Date('2026-09-24T00:00:00Z'),
  };
  const tx = {
    $queryRawUnsafe: jest
      .fn()
      .mockImplementation((sql: string) =>
        Promise.resolve(
          sql.includes('INSERT INTO "notary_matter_number_counters"')
            ? [{ sequence: 1, business_date: '2026-09-24' }]
            : [{ id: sql.includes('"notary_matters"') ? matterId : leadId }],
        ),
      ),
    lead: {
      findFirst: jest.fn().mockResolvedValue(lead),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', displayName: '运营' }),
    },
    notaryOffice: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: officeId, name: '公证处', status: 'ACTIVE' }),
      create: jest.fn(),
    },
    leadCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    notaryMatter: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue({
        id: matterId,
        departmentId: actor.departmentId,
        sourceLeadId: leadId,
        responsibleUserId: actor.userId,
        stage: 'PENDING_EVIDENCE',
        evidenceMode: 'ONLINE_PURCHASE',
        version: 1,
        sourceLead: { responsibleUserId: actor.userId, teamId: null },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest
        .fn()
        .mockResolvedValue(status === 'TRANSFERRED_TO_NOTARY' ? 1 : 0),
    },
    notaryMatterProduct: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notaryMatterMaterial: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    notaryMatterLogistics: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    notaryMatterEvidence: {
      create: jest.fn().mockResolvedValue({}),
    },
    notaryMatterCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
    userAccount: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ accountType: 'INTERNAL', active: true }),
    },
    notaryOffice: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: officeId, name: '公证处', status: 'ACTIVE' },
        ]),
    },
  };
  const access = {
    authorizeLead: jest.fn().mockResolvedValue(undefined),
    authorizeDepartmentAction: jest.fn().mockResolvedValue(undefined),
    buildLeadScope: jest
      .fn()
      .mockResolvedValue({ departmentId: actor.departmentId }),
  };
  const materials = {
    listCurrentReferenceVersionIds: jest.fn().mockResolvedValue([]),
    assertAvailableVersions: jest.fn().mockResolvedValue([]),
  };
  const service = new LeadNotaryService(
    database as never,
    access as never,
    materials as never,
  );
  return { service, tx, lead, database, access, materials };
}

const command = {
  selectedProductIds: [productId],
  selectedContentVersionIds: [],
  notaryOfficeId: officeId,
  evidenceMode: 'ONLINE_PURCHASE' as const,
  batchPurpose: '购买取证',
  expectedVersion: 3,
};

describe('LeadNotaryService transfer', () => {
  it('creates a matter, selected product, audit and receipt in one transaction', async () => {
    const { service, tx } = fixture();
    const result = await service.transfer(actor, leadId, 'batch-1', command);
    expect(result).toMatchObject({
      leadId,
      leadStatus: 'TRANSFERRED_TO_NOTARY',
      leadVersion: 4,
      stage: 'PENDING_EVIDENCE',
      selectedProductIds: [productId],
    });
    expect(tx.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'TRANSFERRED_TO_NOTARY' }),
      }),
    );
    expect(tx.notaryMatter.create).toHaveBeenCalled();
    expect(tx.notaryMatterProduct.createMany).toHaveBeenCalled();
    expect(tx.auditEvent.create).toHaveBeenCalled();
    expect(tx.leadCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ resultSnapshot: result }),
    });
  });

  it('replays the same key and rejects changed intent', async () => {
    const { service, tx } = fixture();
    const result = await service.transfer(actor, leadId, 'batch-1', command);
    tx.leadCommandReceipt.findUnique.mockResolvedValue(
      tx.leadCommandReceipt.create.mock.calls[0][0].data,
    );
    tx.lead.updateMany.mockClear();
    await expect(
      service.transfer(actor, leadId, 'batch-1', command),
    ).resolves.toEqual(result);
    await expect(
      service.transfer(actor, leadId, 'batch-1', {
        ...command,
        batchPurpose: '另一目的',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(tx.lead.updateMany).not.toHaveBeenCalled();
  });

  it('requires explicit new batch after initial transfer', async () => {
    const { service, tx } = fixture('TRANSFERRED_TO_NOTARY');
    await expect(
      service.transfer(actor, leadId, 'batch-2', {
        ...command,
        expectedVersion: 4,
      }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    await expect(
      service.transfer(actor, leadId, 'batch-2', {
        ...command,
        expectedVersion: 4,
        createNewBatch: true,
      }),
    ).resolves.toMatchObject({
      leadVersion: 5,
      leadStatus: 'TRANSFERRED_TO_NOTARY',
    });
    expect(tx.notaryMatter.create).toHaveBeenCalledTimes(1);
  });

  it('rejects unavailable office, invalid product, customer status and stale version', async () => {
    const cases: Array<(f: ReturnType<typeof fixture>) => void> = [
      (f) => f.tx.notaryOffice.findFirst.mockResolvedValue(null),
      (f) => {
        f.lead.products = [];
      },
      (f) => {
        f.lead.customer.profileStatus = 'DRAFT';
      },
      (f) => {
        f.lead.version = 4;
      },
    ];
    for (const alter of cases) {
      const f = fixture();
      alter(f);
      await expect(
        f.service.transfer(actor, leadId, 'key', command),
      ).rejects.toBeDefined();
      expect(f.tx.notaryMatter.create).not.toHaveBeenCalled();
    }
  });

  it('rejects a client account and a caller outside the lead grant even on replay', async () => {
    const f = fixture();
    f.tx.userAccount.findUnique.mockResolvedValue({
      accountType: 'CLIENT',
      displayName: '客户',
    });
    await expect(
      f.service.transfer(actor, leadId, 'key', command),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.notaryMatter.create).not.toHaveBeenCalled();

    f.tx.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      displayName: '运营',
    });
    f.access.authorizeLead.mockRejectedValue(new ForbiddenException());
    await expect(
      f.service.transfer(actor, leadId, 'key', command),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.notaryMatter.create).not.toHaveBeenCalled();
  });

  it('rejects material versions outside current lead references and freezes chosen version facts', async () => {
    const f = fixture();
    const selectedId = '99999999-9999-4999-8999-999999999999';
    const request = { ...command, selectedContentVersionIds: [selectedId] };
    await expect(
      f.service.transfer(actor, leadId, 'key', request),
    ).rejects.toMatchObject({ response: { code: 'INVALID_SELECTION' } });
    f.materials.listCurrentReferenceVersionIds.mockResolvedValue([selectedId]);
    f.materials.assertAvailableVersions.mockResolvedValue([
      {
        materialId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        contentVersionId: selectedId,
      },
    ]);
    await expect(
      f.service.transfer(actor, leadId, 'key', request),
    ).resolves.toMatchObject({ selectedContentVersionIds: [selectedId] });
    expect(f.materials.assertAvailableVersions).toHaveBeenCalledWith(
      f.tx,
      actor,
      expect.objectContaining({
        ownerType: 'LEAD',
        ownerId: leadId,
        category: 'LEAD_SCREENSHOT',
        leadAction: 'lead.evidence.decide',
      }),
    );
    expect(f.tx.notaryMatterMaterial.createMany).toHaveBeenCalledWith({
      data: [
        {
          notaryMatterId: expect.any(String),
          departmentId: actor.departmentId,
          materialId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          contentVersionId: selectedId,
        },
      ],
    });
  });

  it('does not write receipt when audit fails', async () => {
    const f = fixture();
    f.tx.auditEvent.create.mockRejectedValue(new Error('audit write failed'));
    await expect(
      f.service.transfer(actor, leadId, 'key', command),
    ).rejects.toThrow('audit write failed');
    expect(f.tx.leadCommandReceipt.create).not.toHaveBeenCalled();
  });
});

const evidenceCommand = {
  evidenceAt: '2026-09-24',
  sampleFeeState: 'KNOWN' as const,
  sampleFeeAmount: '0.00',
  logistics: [
    {
      companyState: 'PRESENT' as const,
      companyValue: '真实快递',
      trackingState: 'PRESENT' as const,
      trackingValue: 'REAL-123',
    },
  ],
  expectedVersion: 1,
};

describe('LeadNotaryService recordEvidence', () => {
  function action(f: ReturnType<typeof fixture>) {
    return f.service as unknown as {
      recordEvidence: (
        who: typeof actor,
        id: string,
        key: string,
        input: unknown,
      ) => Promise<{
        id: string;
        stage: string;
        version: number;
        evidence: { logistics: Array<{ trackingValue: string | null }> };
      }>;
    };
  }

  it('atomically records real logistics and advances exactly one stage', async () => {
    const f = fixture();
    const result = await action(f).recordEvidence(
      actor,
      matterId,
      'evidence-1',
      evidenceCommand,
    );
    expect(result).toMatchObject({
      id: matterId,
      stage: 'WAITING_UNBOX',
      version: 2,
      evidence: { logistics: [{ trackingValue: 'REAL-123' }] },
    });
    expect(f.access.authorizeLead).toHaveBeenCalledWith(
      actor,
      'notary.evidence.record',
      expect.objectContaining({ departmentId: actor.departmentId }),
      f.tx,
    );
    expect(f.tx.notaryMatter.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: matterId,
          stage: 'PENDING_EVIDENCE',
          version: 1,
        }),
        data: expect.objectContaining({ stage: 'WAITING_UNBOX', version: 2 }),
      }),
    );
    expect(f.tx.notaryMatterLogistics.createMany).toHaveBeenCalled();
    expect(f.tx.auditEvent.create).toHaveBeenCalled();
    expect(f.tx.notaryMatterCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ resultSnapshot: result }),
    });
  });

  it('does not substitute unknown sample fee with zero or invent logistics', async () => {
    const f = fixture();
    const result = await action(f).recordEvidence(actor, matterId, 'none', {
      ...evidenceCommand,
      sampleFeeState: 'PENDING',
      sampleFeeAmount: undefined,
      logistics: [
        {
          companyState: 'NONE',
          companyValue: null,
          trackingState: 'NONE',
          trackingValue: null,
        },
      ],
    });
    expect(result.evidence.logistics[0]?.trackingValue).toBeNull();
    expect(f.tx.notaryMatterEvidence.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sampleFeeAmount: null }),
      }),
    );
  });

  it('rejects invalid dates, fee state and incomplete logistics before writing', async () => {
    const invalid = [
      { ...evidenceCommand, evidenceAt: '2026-02-30' },
      { ...evidenceCommand, sampleFeeAmount: '-1.00' },
      { ...evidenceCommand, sampleFeeState: 'PENDING' },
      { ...evidenceCommand, logistics: [] },
      {
        ...evidenceCommand,
        logistics: [
          {
            companyState: 'NONE',
            companyValue: null,
            trackingState: 'PRESENT',
            trackingValue: '',
          },
        ],
      },
    ];
    for (const input of invalid) {
      const f = fixture();
      await expect(
        action(f).recordEvidence(actor, matterId, 'invalid', input),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(f.tx.notaryMatter.updateMany).not.toHaveBeenCalled();
    }
  });

  it('rejects non-internal or revoked grant even when a receipt exists', async () => {
    const f = fixture();
    f.tx.userAccount.findUnique.mockResolvedValue({ accountType: 'CLIENT' });
    await expect(
      action(f).recordEvidence(actor, matterId, 'key', evidenceCommand),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    f.tx.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    f.access.authorizeLead.mockRejectedValue(new ForbiddenException());
    await expect(
      action(f).recordEvidence(actor, matterId, 'key', evidenceCommand),
    ).rejects.toMatchObject({ response: { code: 'ACTION_FORBIDDEN' } });
    expect(f.tx.notaryMatterCommandReceipt.findUnique).not.toHaveBeenCalled();
  });

  it('replays the same key without another write and rejects changed intent', async () => {
    const f = fixture();
    const first = await action(f).recordEvidence(
      actor,
      matterId,
      'same',
      evidenceCommand,
    );
    f.tx.notaryMatterCommandReceipt.findUnique.mockResolvedValue(
      f.tx.notaryMatterCommandReceipt.create.mock.calls[0][0].data,
    );
    f.tx.notaryMatter.updateMany.mockClear();
    await expect(
      action(f).recordEvidence(actor, matterId, 'same', evidenceCommand),
    ).resolves.toEqual(first);
    await expect(
      action(f).recordEvidence(actor, matterId, 'same', {
        ...evidenceCommand,
        evidenceAt: '2026-09-23',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    expect(f.tx.notaryMatter.updateMany).not.toHaveBeenCalled();
  });

  it('rejects stale version, wrong stage and a lost update', async () => {
    const f = fixture();
    f.tx.notaryMatter.findFirst.mockResolvedValueOnce({
      ...(await f.tx.notaryMatter.findFirst()),
      stage: 'WAITING_UNBOX',
    });
    await expect(
      action(f).recordEvidence(actor, matterId, 'stage', evidenceCommand),
    ).rejects.toMatchObject({ response: { code: 'INVALID_STATE' } });
    f.tx.notaryMatter.findFirst.mockResolvedValueOnce({
      ...(await f.tx.notaryMatter.findFirst()),
      version: 2,
    });
    await expect(
      action(f).recordEvidence(actor, matterId, 'version', evidenceCommand),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
    f.tx.notaryMatter.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      action(f).recordEvidence(actor, matterId, 'competition', evidenceCommand),
    ).rejects.toMatchObject({ response: { code: 'VERSION_CONFLICT' } });
  });

  it('does not write a receipt when audit fails', async () => {
    const f = fixture();
    f.tx.auditEvent.create.mockRejectedValue(new Error('audit failed'));
    await expect(
      action(f).recordEvidence(actor, matterId, 'audit', evidenceCommand),
    ).rejects.toThrow('audit failed');
    expect(f.tx.notaryMatterCommandReceipt.create).not.toHaveBeenCalled();
  });
});

describe('LeadNotaryService office permissions', () => {
  it('lets a current internal office manager list only current-department active offices without a lead grant', async () => {
    const f = fixture();
    f.access.buildLeadScope.mockRejectedValue(new ForbiddenException());
    await expect(f.service.listOffices(actor)).resolves.toEqual({
      items: [{ id: officeId, name: '公证处', status: 'ACTIVE' }],
      capabilities: { create: true },
    });
    expect(f.access.buildLeadScope).not.toHaveBeenCalled();
    expect(f.access.authorizeDepartmentAction).toHaveBeenCalledWith(
      actor,
      'notary.office.manage',
    );
    expect(f.database.notaryOffice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { departmentId: actor.departmentId, status: 'ACTIVE' },
      }),
    );
  });

  it('lets an evidence decider list but not create offices', async () => {
    const f = fixture();
    f.access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException(),
    );
    await expect(f.service.listOffices(actor)).resolves.toMatchObject({
      capabilities: { create: false },
    });
    expect(f.access.buildLeadScope).toHaveBeenCalledWith(
      actor,
      'lead.evidence.decide',
    );
    await expect(
      f.service.createOffice(actor, { name: '新公证处' }),
    ).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.tx.notaryOffice.create).not.toHaveBeenCalled();
  });

  it('denies clients, revoked internal accounts and internal actors without either grant before listing', async () => {
    const f = fixture();
    f.database.userAccount.findUnique.mockResolvedValue({
      accountType: 'CLIENT',
      active: true,
    });
    await expect(f.service.listOffices(actor)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    f.database.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: false,
    });
    await expect(f.service.listOffices(actor)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    f.database.userAccount.findUnique.mockResolvedValue({
      accountType: 'INTERNAL',
      active: true,
    });
    f.access.authorizeDepartmentAction.mockRejectedValue(
      new ForbiddenException(),
    );
    f.access.buildLeadScope.mockRejectedValue(new ForbiddenException());
    await expect(f.service.listOffices(actor)).rejects.toMatchObject({
      response: { code: 'ACTION_FORBIDDEN' },
    });
    expect(f.database.notaryOffice.findMany).not.toHaveBeenCalled();
  });
});
