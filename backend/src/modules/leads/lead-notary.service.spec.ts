import { ForbiddenException } from '@nestjs/common';
import { LeadNotaryService } from './lead-notary.service';

const actor = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 1,
};
const leadId = '33333333-3333-4333-8333-333333333333';
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
            : [{ id: leadId }],
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
    },
    leadCommandReceipt: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    notaryMatter: {
      create: jest.fn().mockResolvedValue({}),
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
    auditEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const database = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
      callback(tx),
    ),
  };
  const access = { authorizeLead: jest.fn().mockResolvedValue(undefined) };
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
