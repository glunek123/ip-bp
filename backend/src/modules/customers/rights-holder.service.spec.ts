import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { RightsHolderService } from './rights-holder.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};
const customerId = '33333333-3333-4333-8333-333333333333';
const secondCustomerId = '44444444-4444-4444-8444-444444444444';
const holderId = '55555555-5555-4555-8555-555555555555';
const linkId = '66666666-6666-4666-8666-666666666666';
const key = 'create-rights-holder-1';

const customer = (id = customerId, version = 1) => ({
  id,
  departmentId: actor.departmentId,
  responsibleUserId: actor.userId,
  teamId: null,
  version,
});

const holder = (overrides: Record<string, unknown> = {}) => ({
  id: holderId,
  name: '权利主体甲',
  credit: null,
  address: null,
  legalRepresentative: null,
  duty: null,
  departmentId: actor.departmentId,
  updatedAt: new Date('2026-09-17T07:00:00.000Z'),
  ...overrides,
});

describe('RightsHolderService', () => {
  const editScope = {
    departmentId: actor.departmentId,
    responsibleUserId: actor.userId,
  };
  const readScope = { departmentId: actor.departmentId };
  const buildCustomerScope = jest.fn();
  const tryBuildCustomerScope = jest.fn();
  const accessControl = {
    buildCustomerScope,
    tryBuildCustomerScope,
  } as unknown as AccessControlService;

  const transaction = jest.fn();
  const customerFindFirst = jest.fn();
  const holderFindMany = jest.fn();
  const holderFindFirst = jest.fn();
  const holderCount = jest.fn();
  const receiptFindUniqueAfterRace = jest.fn();
  const database = {
    customer: { findFirst: customerFindFirst },
    rightsHolder: {
      findMany: holderFindMany,
      findFirst: holderFindFirst,
      count: holderCount,
    },
    rightsHolderCommandReceipt: {
      findUnique: receiptFindUniqueAfterRace,
    },
    $transaction: transaction,
  } as unknown as DatabaseService;
  const service = new RightsHolderService(database, accessControl);

  beforeEach(() => {
    jest.clearAllMocks();
    buildCustomerScope.mockImplementation(
      async (_actor: ActorContext, action: string) =>
        action === 'customer.edit-routine' ? editScope : readScope,
    );
    tryBuildCustomerScope.mockResolvedValue(readScope);
    receiptFindUniqueAfterRace.mockResolvedValue(null);
  });

  function commandTransaction(options?: {
    targetCustomerId?: string;
    currentVersion?: number;
    existingReceipt?: Record<string, unknown> | null;
    visibleHolder?: Record<string, unknown> | null;
    existingLink?: Record<string, unknown> | null;
    updateCount?: number;
    linkFailure?: Error;
    auditFailureAt?: number;
  }) {
    const rightsHolderCreate = jest.fn().mockResolvedValue(holder());
    const rightsHolderFindFirst = jest
      .fn()
      .mockResolvedValue(
        options !== undefined &&
          Object.prototype.hasOwnProperty.call(options, 'visibleHolder')
          ? options.visibleHolder
          : holder(),
      );
    const linkCreate = options?.linkFailure
      ? jest.fn().mockRejectedValue(options.linkFailure)
      : jest.fn().mockResolvedValue({ id: linkId });
    const linkFindUnique = jest
      .fn()
      .mockResolvedValue(options?.existingLink ?? null);
    const auditCreate = jest.fn().mockImplementation(async () => {
      if (
        options?.auditFailureAt !== undefined &&
        auditCreate.mock.calls.length === options.auditFailureAt
      ) {
        throw new Error('audit failed');
      }
      return { id: `audit-${auditCreate.mock.calls.length}` };
    });
    const receiptFindUnique = jest
      .fn()
      .mockResolvedValue(options?.existingReceipt ?? null);
    const receiptCreate = jest.fn().mockResolvedValue({ id: 'receipt-1' });
    const customerUpdateMany = jest
      .fn()
      .mockResolvedValue({ count: options?.updateCount ?? 1 });
    const tx = {
      customer: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            customer(
              options?.targetCustomerId ?? customerId,
              options?.currentVersion ?? 1,
            ),
          ),
        updateMany: customerUpdateMany,
      },
      rightsHolder: {
        create: rightsHolderCreate,
        findFirst: rightsHolderFindFirst,
      },
      customerRightsHolderLink: {
        create: linkCreate,
        findUnique: linkFindUnique,
      },
      rightsHolderCommandReceipt: {
        findUnique: receiptFindUnique,
        create: receiptCreate,
      },
      auditEvent: { create: auditCreate },
    };
    transaction.mockImplementation(async (callback) => callback(tx));
    return {
      tx,
      rightsHolderCreate,
      rightsHolderFindFirst,
      linkCreate,
      linkFindUnique,
      auditCreate,
      receiptFindUnique,
      receiptCreate,
      customerUpdateMany,
    };
  }

  it('creates one holder, one link, two audit facts, and one customer version increment atomically', async () => {
    const mocks = commandTransaction();

    await expect(
      service.createAndLink(actor, customerId, key, {
        expectedCustomerVersion: 1,
        name: '  权利主体甲  ',
        credit: ' 91310000RH001 ',
      }),
    ).resolves.toEqual({
      customerVersion: 2,
      holder: {
        id: holderId,
        name: '权利主体甲',
        credit: null,
        address: null,
        legalRepresentative: null,
        duty: null,
        updatedAt: '2026-09-17T07:00:00.000Z',
      },
      linkId,
    });
    expect(mocks.customerUpdateMany).toHaveBeenCalledWith({
      where: {
        id: customerId,
        departmentId: actor.departmentId,
        version: 1,
      },
      data: { version: { increment: 1 } },
    });
    expect(mocks.rightsHolderCreate).toHaveBeenCalledWith({
      data: {
        departmentId: actor.departmentId,
        name: '权利主体甲',
        credit: '91310000RH001',
        address: null,
        legalRepresentative: null,
        duty: null,
      },
    });
    expect(mocks.linkCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customerId,
        rightsHolderId: holderId,
        departmentId: actor.departmentId,
      }),
    });
    expect(mocks.auditCreate).toHaveBeenCalledTimes(2);
    expect(
      mocks.auditCreate.mock.calls.map((call) => call[0].data.action),
    ).toEqual(['rights-holder.created', 'customer.rights-holder-linked']);
    expect(JSON.stringify(mocks.auditCreate.mock.calls)).not.toContain(
      '91310000RH001',
    );
    expect(mocks.receiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'create-and-link',
        actorUserId: actor.userId,
        departmentId: actor.departmentId,
        idempotencyKey: key,
        resultCustomerId: customerId,
        resultCustomerVersion: 2,
        resultHolderId: holderId,
        resultLinkId: linkId,
        requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    });
  });

  it('rejects a blank holder name before starting a transaction', async () => {
    await expect(
      service.createAndLink(actor, customerId, key, {
        expectedCustomerVersion: 1,
        name: '   ',
      }),
    ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('normalizes every optional field to a trimmed value or null', async () => {
    const mocks = commandTransaction();

    await service.createAndLink(actor, customerId, key, {
      expectedCustomerVersion: 1,
      name: '主体甲',
      credit: ' ',
      address: ' 上海 ',
      legalRepresentative: ' 张三 ',
      duty: undefined,
    });

    expect(mocks.rightsHolderCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        credit: null,
        address: '上海',
        legalRepresentative: '张三',
        duty: null,
      }),
    });
  });

  it('links the same visible stable holder to two authorized customers', async () => {
    const createdLinks: string[] = [];
    transaction.mockImplementation(async (callback) => {
      const nextCustomerId =
        createdLinks.length === 0 ? customerId : secondCustomerId;
      return callback({
        customer: {
          findFirst: jest.fn().mockResolvedValue(customer(nextCustomerId)),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        rightsHolder: { findFirst: jest.fn().mockResolvedValue(holder()) },
        customerRightsHolderLink: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation(async ({ data }) => {
            createdLinks.push(data.customerId);
            return { id: `${linkId}-${createdLinks.length}` };
          }),
        },
        rightsHolderCommandReceipt: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'receipt' }),
        },
        auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit' }) },
      });
    });

    const first = await service.linkExisting(actor, customerId, 'link-a', {
      expectedCustomerVersion: 1,
      rightsHolderId: holderId,
    });
    const second = await service.linkExisting(
      actor,
      secondCustomerId,
      'link-b',
      { expectedCustomerVersion: 1, rightsHolderId: holderId },
    );

    expect(first.holder.id).toBe(holderId);
    expect(second.holder.id).toBe(holderId);
    expect(createdLinks).toEqual([customerId, secondCustomerId]);
  });

  it('uses the same non-leaking customer 404 when the target is missing or outside edit scope', async () => {
    const mocks = commandTransaction();
    mocks.tx.customer.findFirst.mockResolvedValue(null);

    await expect(
      service.linkExisting(actor, customerId, key, {
        expectedCustomerVersion: 1,
        rightsHolderId: holderId,
      }),
    ).rejects.toMatchObject({ response: { code: 'CUSTOMER_NOT_FOUND' } });
    expect(mocks.rightsHolderFindFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['outside the actor read scope', null],
    [
      'in another department',
      holder({ departmentId: '77777777-7777-4777-8777-777777777777' }),
    ],
  ])('does not reveal or link a guessed holder %s', async (_label, found) => {
    const mocks = commandTransaction({ visibleHolder: found });
    if (found !== null) {
      mocks.rightsHolderFindFirst.mockResolvedValue(null);
    }

    await expect(
      service.linkExisting(actor, customerId, key, {
        expectedCustomerVersion: 1,
        rightsHolderId: holderId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'RIGHTS_HOLDER_NOT_FOUND' },
    });
    expect(mocks.linkCreate).not.toHaveBeenCalled();
  });

  it('rejects a repeated customer-holder association', async () => {
    const mocks = commandTransaction({ existingLink: { id: linkId } });

    await expect(
      service.linkExisting(actor, customerId, key, {
        expectedCustomerVersion: 1,
        rightsHolderId: holderId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'RIGHTS_HOLDER_ALREADY_LINKED' },
    });
    expect(mocks.customerUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale customer version without linking or auditing', async () => {
    const mocks = commandTransaction({ updateCount: 0 });

    await expect(
      service.linkExisting(actor, customerId, key, {
        expectedCustomerVersion: 1,
        rightsHolderId: holderId,
      }),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_VERSION_CONFLICT' },
    });
    expect(mocks.linkCreate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('rechecks current grants and stops before database access when a grant is revoked', async () => {
    buildCustomerScope.mockRejectedValueOnce(
      new ForbiddenException({
        code: 'CUSTOMER_ACTION_FORBIDDEN',
        message: '无权执行此客户操作',
      }),
    );

    await expect(
      service.createAndLink(actor, customerId, key, {
        expectedCustomerVersion: 1,
        name: '主体甲',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('returns the original result for an identical idempotency replay before the version gate', async () => {
    const firstMocks = commandTransaction();
    await service.createAndLink(actor, customerId, key, {
      expectedCustomerVersion: 1,
      name: '主体甲',
    });
    const fingerprint =
      firstMocks.receiptCreate.mock.calls[0][0].data.requestFingerprint;

    const replayMocks = commandTransaction({
      currentVersion: 2,
      existingReceipt: {
        requestFingerprint: fingerprint,
        resultCustomerId: customerId,
        resultCustomerVersion: 2,
        resultHolderId: holderId,
        resultLinkId: linkId,
      },
    });

    await expect(
      service.createAndLink(actor, customerId, key, {
        expectedCustomerVersion: 1,
        name: '主体甲',
      }),
    ).resolves.toMatchObject({
      customerVersion: 2,
      holder: { id: holderId },
      linkId,
    });
    expect(replayMocks.customerUpdateMany).not.toHaveBeenCalled();
    expect(replayMocks.rightsHolderCreate).not.toHaveBeenCalled();
  });

  it('rejects conflicting reuse of an idempotency key', async () => {
    const mocks = commandTransaction({
      existingReceipt: {
        requestFingerprint: '0'.repeat(64),
        resultCustomerId: customerId,
        resultCustomerVersion: 2,
        resultHolderId: holderId,
        resultLinkId: linkId,
      },
    });

    await expect(
      service.createAndLink(actor, customerId, key, {
        expectedCustomerVersion: 1,
        name: '不同主体',
      }),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
    expect(mocks.customerUpdateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['link', { linkFailure: new Error('link failed') }],
    ['audit', { auditFailureAt: 1 }],
  ])(
    'propagates a %s failure from the single write transaction',
    async (_stage, options) => {
      const mocks = commandTransaction(options);

      await expect(
        service.createAndLink(actor, customerId, key, {
          expectedCustomerVersion: 1,
          name: '主体甲',
        }),
      ).rejects.toThrow();
      expect(transaction).toHaveBeenCalledTimes(1);
      expect(mocks.receiptCreate).not.toHaveBeenCalled();
    },
  );

  it('lists only holders associated with the scoped target customer', async () => {
    customerFindFirst.mockResolvedValue(customer());
    holderFindMany.mockResolvedValue([holder()]);
    holderCount.mockResolvedValue(1);
    transaction.mockResolvedValue([[holder()], 1]);

    await expect(service.list(actor, customerId, 1, 20)).resolves.toEqual({
      items: [
        {
          id: holderId,
          name: '权利主体甲',
          credit: null,
          address: null,
          legalRepresentative: null,
          duty: null,
          updatedAt: '2026-09-17T07:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
      capabilities: { create: true, link: true },
    });
    expect(holderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          links: { some: { customerId } },
        },
        select: expect.not.objectContaining({ links: true }),
      }),
    );
  });

  it('returns a holder detail without exposing its other customer associations', async () => {
    customerFindFirst.mockResolvedValue(customer());
    holderFindFirst.mockResolvedValue(holder());

    const result = await service.get(actor, customerId, holderId);

    expect(result).toEqual({
      id: holderId,
      name: '权利主体甲',
      credit: null,
      address: null,
      legalRepresentative: null,
      duty: null,
      updatedAt: '2026-09-17T07:00:00.000Z',
    });
    expect(result).not.toHaveProperty('links');
    expect(holderFindFirst).toHaveBeenCalledWith({
      where: {
        id: holderId,
        departmentId: actor.departmentId,
        links: { some: { customerId } },
      },
      select: expect.not.objectContaining({ links: true }),
    });
  });

  it('finds only visible same-department holders that are not linked to the target', async () => {
    customerFindFirst.mockResolvedValue(customer());
    holderFindMany.mockResolvedValue([]);
    holderCount.mockResolvedValue(0);
    transaction.mockResolvedValue([[], 0]);

    await expect(
      service.findLinkable(actor, customerId, ' 主体 ', 2, 10),
    ).resolves.toEqual({ items: [], total: 0, page: 2, pageSize: 10 });
    expect(holderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          departmentId: actor.departmentId,
          links: { some: { customer: readScope } },
          NOT: { links: { some: { customerId } } },
          name: { contains: '主体', mode: 'insensitive' },
        },
        skip: 10,
        take: 10,
      }),
    );
  });
});
