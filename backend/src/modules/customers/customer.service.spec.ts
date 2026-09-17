import { ConflictException, NotFoundException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { CustomerService } from './customer.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};

describe('CustomerService', () => {
  const authorizeNewCustomer = jest.fn();
  const buildCustomerScope = jest.fn();
  const canAuthorizeCustomer = jest.fn();
  const canAuthorizeNewCustomer = jest.fn();
  const tryBuildCustomerScope = jest.fn();
  const accessControl = {
    authorizeNewCustomer,
    buildCustomerScope,
    canAuthorizeCustomer,
    canAuthorizeNewCustomer,
    tryBuildCustomerScope,
  } as unknown as AccessControlService;
  const customerCreate = jest.fn();
  const auditCreate = jest.fn();
  const customerFindMany = jest.fn();
  const customerCount = jest.fn();
  const customerFindFirst = jest.fn();
  const customerFindUnique = jest.fn();
  const customerUpdateMany = jest.fn();
  const auditFindMany = jest.fn();
  const transaction = jest.fn();
  const database = {
    customer: {
      findMany: customerFindMany,
      count: customerCount,
      findFirst: customerFindFirst,
      findUnique: customerFindUnique,
      updateMany: customerUpdateMany,
    },
    auditEvent: { findMany: auditFindMany },
    $transaction: transaction,
  } as unknown as DatabaseService;
  const service = new CustomerService(database, accessControl);

  beforeEach(() => {
    jest.clearAllMocks();
    authorizeNewCustomer.mockResolvedValue({
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
    });
    buildCustomerScope.mockResolvedValue({ departmentId: actor.departmentId });
    canAuthorizeCustomer.mockResolvedValue(true);
    canAuthorizeNewCustomer.mockResolvedValue(true);
    tryBuildCustomerScope.mockResolvedValue({
      departmentId: actor.departmentId,
    });
  });

  it('creates a trimmed draft with server-derived ownership and one audit event', async () => {
    const created = {
      id: '33333333-3333-4333-8333-333333333333',
      name: '测试客户甲',
      category: null,
      region: null,
      profileStatus: 'DRAFT',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      version: 1,
      updatedAt: new Date('2026-09-16T12:00:00.000Z'),
    };
    customerCreate.mockResolvedValue(created);
    auditCreate.mockResolvedValue({ id: 'audit-1' });
    transaction.mockImplementation(async (callback) =>
      callback({
        customer: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: customerCreate,
        },
        auditEvent: { create: auditCreate },
      }),
    );

    await expect(
      service.createDraft(actor, { name: '  测试客户甲  ' }),
    ).resolves.toEqual({
      id: created.id,
      name: '测试客户甲',
      category: null,
      region: null,
      admissionContactName: null,
      admissionContactPhone: null,
      admissionContactEmail: null,
      profileStatus: 'draft',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      version: 1,
      updatedAt: '2026-09-16T12:00:00.000Z',
    });
    expect(authorizeNewCustomer).toHaveBeenCalledWith(actor);
    expect(customerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: '测试客户甲',
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        profileStatus: 'DRAFT',
      }),
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'customer.draft-created',
        actorUserId: actor.userId,
        departmentId: actor.departmentId,
        resourceId: created.id,
        resourceType: 'customer',
      }),
    });
  });

  it('propagates audit failure from the same transaction callback', async () => {
    customerCreate.mockResolvedValue({ id: 'customer-1' });
    auditCreate.mockRejectedValue(new Error('audit failed'));
    transaction.mockImplementation(async (callback) =>
      callback({
        customer: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: customerCreate,
        },
        auditEvent: { create: auditCreate },
      }),
    );

    await expect(service.createDraft(actor, { name: '客户' })).rejects.toThrow(
      'audit failed',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('creates a draft with one phone-only admission contact', async () => {
    const created = {
      id: '33333333-3333-4333-8333-333333333333',
      name: '测试客户甲',
      normalizedName: '测试客户甲',
      customerType: null,
      identityType: null,
      identityNumber: null,
      normalizedIdentityNumber: null,
      issuingCountryOrRegion: null,
      category: null,
      region: null,
      admissionContactName: '张三',
      admissionContactPhone: '+86 138-0013-8000',
      admissionContactEmail: null,
      profileStatus: 'DRAFT',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      version: 1,
      updatedAt: new Date('2026-09-17T05:00:00.000Z'),
    };
    customerCreate.mockResolvedValue(created);
    transaction.mockImplementation(async (callback) =>
      callback({
        customer: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: customerCreate,
        },
        auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
      }),
    );

    await expect(
      service.createDraft(actor, {
        name: '测试客户甲',
        admissionContactName: '张三',
        admissionContactPhone: '+86 138-0013-8000',
      } as never),
    ).resolves.toMatchObject({
      admissionContactName: '张三',
      admissionContactPhone: '+86 138-0013-8000',
      admissionContactEmail: null,
    });
    expect(customerCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        admissionContactName: '张三',
        admissionContactPhone: '+86 138-0013-8000',
        admissionContactEmail: null,
      }),
    });
  });

  it.each([
    {
      name: '客户甲',
      admissionContactName: '张三',
      expectedMessage: '联系人至少填写电话或邮箱',
    },
    {
      name: '客户甲',
      admissionContactPhone: '13800138000',
      expectedMessage: '请填写联系人姓名',
    },
  ])('rejects an incomplete admission contact %#', async (input) => {
    await expect(service.createDraft(actor, input as never)).rejects.toThrow(
      input.expectedMessage,
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('applies the authorization predicate inside list database queries', async () => {
    const scope = {
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
    };
    buildCustomerScope.mockResolvedValue(scope);
    customerFindMany.mockResolvedValue([]);
    customerCount.mockResolvedValue(0);
    transaction.mockResolvedValue([[], 0]);

    await expect(service.list(actor, 1, 20)).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      capabilities: { createDraft: true },
    });
    expect(customerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: scope,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
      }),
    );
    expect(customerCount).toHaveBeenCalledWith({ where: scope });
    expect(canAuthorizeNewCustomer).toHaveBeenCalledWith(actor);
  });

  it('uses one non-leaking id-and-scope query for detail', async () => {
    buildCustomerScope.mockResolvedValue({ departmentId: actor.departmentId });
    customerFindFirst.mockResolvedValue(null);

    await expect(service.get(actor, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(customerFindFirst).toHaveBeenCalledWith({
      where: { id: 'missing', departmentId: actor.departmentId },
    });
    expect(auditFindMany).not.toHaveBeenCalled();
  });

  it('returns the shared creation event only after the scoped customer is found', async () => {
    const customer = {
      id: '33333333-3333-4333-8333-333333333333',
      name: '测试客户甲',
      category: null,
      region: null,
      profileStatus: 'DRAFT',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      version: 1,
      updatedAt: new Date('2026-09-16T12:00:00.000Z'),
    };
    customerFindFirst.mockResolvedValue(customer);
    auditFindMany.mockResolvedValue([
      {
        action: 'customer.draft-created',
        actorUserId: actor.userId,
        createdAt: new Date('2026-09-16T11:59:00.000Z'),
      },
    ]);

    await expect(service.get(actor, customer.id)).resolves.toMatchObject({
      id: customer.id,
      history: [
        {
          action: 'customer.draft-created',
          actorUserId: actor.userId,
          occurredAt: '2026-09-16T11:59:00.000Z',
        },
      ],
    });
    expect(auditFindMany).toHaveBeenCalledWith({
      where: {
        departmentId: actor.departmentId,
        resourceType: 'customer',
        resourceId: customer.id,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { action: true, actorUserId: true, createdAt: true },
    });
  });

  it('keeps exact identity results independent from a crowded same-name result set', async () => {
    const base = {
      customerType: 'enterprise',
      identityType: 'CREDIT-CODE',
      identityNumber: '91310000ABC123',
      normalizedIdentityNumber: '91310000ABC123',
      issuingCountryOrRegion: null,
      category: null,
      region: null,
      profileStatus: 'DRAFT',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      version: 1,
      updatedAt: new Date('2026-09-17T01:00:00.000Z'),
    };
    const exact = {
      ...base,
      id: '33333333-3333-4333-8333-333333333333',
      name: '证件命中',
      normalizedName: '证件命中',
    };
    const sameNames = Array.from({ length: 20 }, (_, index) => ({
      ...base,
      id: `same-${index}`,
      name: '拥挤同名',
      normalizedName: '拥挤同名',
      identityNumber: null,
      normalizedIdentityNumber: null,
    }));
    customerFindMany
      .mockResolvedValueOnce([exact])
      .mockResolvedValueOnce(sameNames);

    await expect(
      service.findDuplicates(actor, {
        name: '拥挤同名',
        identityType: 'credit-code',
        identityNumber: '91310000abc123',
      }),
    ).resolves.toMatchObject({
      exactIdentity: [expect.objectContaining({ id: exact.id })],
      sameName: expect.arrayContaining([
        expect.objectContaining({ id: 'same-0' }),
      ]),
    });
    expect(customerFindMany).toHaveBeenCalledTimes(2);
  });

  it('requires one reason when an edited draft matches another customer name', async () => {
    buildCustomerScope.mockResolvedValue({ departmentId: actor.departmentId });
    const current = {
      id: '33333333-3333-4333-8333-333333333333',
      name: '旧名称',
      category: null,
      region: null,
      customerType: null,
      identityType: null,
      identityNumber: null,
      issuingCountryOrRegion: null,
      profileStatus: 'DRAFT',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      version: 1,
      updatedAt: new Date('2026-09-16T12:00:00.000Z'),
    };
    transaction.mockImplementation(async (callback) =>
      callback({
        customer: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(current)
            .mockResolvedValueOnce({ id: 'another-customer' }),
        },
      }),
    );

    await expect(
      service.updateDraft(actor, current.id, {
        expectedVersion: 1,
        name: '同名客户',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_NAME_REASON_REQUIRED' },
    });
  });

  it('rejects an exact identity duplicate before updating', async () => {
    buildCustomerScope.mockResolvedValue({ departmentId: actor.departmentId });
    const current = {
      id: '33333333-3333-4333-8333-333333333333',
      name: '客户甲',
      category: null,
      region: null,
      customerType: null,
      identityType: null,
      identityNumber: null,
      issuingCountryOrRegion: null,
      profileStatus: 'DRAFT',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      version: 1,
      updatedAt: new Date('2026-09-16T12:00:00.000Z'),
    };
    transaction.mockImplementation(async (callback) =>
      callback({
        customer: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(current)
            .mockResolvedValueOnce({ id: 'identity-owner' }),
        },
      }),
    );

    await expect(
      service.updateDraft(actor, current.id, {
        expectedVersion: 1,
        name: '客户甲',
        customerType: 'enterprise',
        identityType: 'credit-code',
        identityNumber: '91310000abc123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(customerUpdateMany).not.toHaveBeenCalled();
  });

  it('updates with optimistic locking and records non-sensitive field differences', async () => {
    buildCustomerScope.mockResolvedValue({ departmentId: actor.departmentId });
    const current = {
      id: '33333333-3333-4333-8333-333333333333',
      name: '旧名称',
      category: null,
      region: null,
      customerType: null,
      identityType: null,
      identityNumber: null,
      issuingCountryOrRegion: null,
      profileStatus: 'DRAFT',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      version: 1,
      updatedAt: new Date('2026-09-16T12:00:00.000Z'),
    };
    const updated = {
      ...current,
      name: '同名客户',
      customerType: 'enterprise',
      identityType: 'CREDIT-CODE',
      identityNumber: '91310000ABC123',
      version: 2,
      updatedAt: new Date('2026-09-17T03:00:00.000Z'),
    };
    const txFindFirst = jest
      .fn()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'another-customer' });
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const txFindUnique = jest.fn().mockResolvedValue(updated);
    const txAuditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
    transaction.mockImplementation(async (callback) =>
      callback({
        customer: {
          findFirst: txFindFirst,
          updateMany: txUpdateMany,
          findUnique: txFindUnique,
        },
        auditEvent: { create: txAuditCreate },
      }),
    );

    await expect(
      service.updateDraft(actor, current.id, {
        expectedVersion: 1,
        name: '同名客户',
        customerType: 'enterprise',
        identityType: 'credit-code',
        identityNumber: '91310000abc123',
        duplicateNameReason: '不同业务主体，经核对后继续',
      }),
    ).resolves.toMatchObject({
      id: current.id,
      name: '同名客户',
      identityNumber: '91310000ABC123',
      version: 2,
    });
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: {
        id: current.id,
        departmentId: actor.departmentId,
        version: 1,
      },
      data: expect.objectContaining({
        name: '同名客户',
        identityType: 'CREDIT-CODE',
        identityNumber: '91310000ABC123',
        version: { increment: 1 },
      }),
    });
    expect(txAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'customer.updated',
        details: expect.objectContaining({
          fromVersion: 1,
          toVersion: 2,
          changedFields: expect.arrayContaining([
            'name',
            'customerType',
            'identityType',
            'identityNumber',
          ]),
          changes: expect.objectContaining({
            name: { before: '旧名称', after: '同名客户' },
            identityNumber: { before: null, after: '***C123' },
          }),
        }),
      }),
    });
    expect(txAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'customer.duplicate-name-overridden',
        details: expect.objectContaining({
          reason: '不同业务主体，经核对后继续',
        }),
      }),
    });
  });

  it('updates an email-only admission contact and masks it in the shared audit', async () => {
    const current = {
      id: '33333333-3333-4333-8333-333333333333',
      name: '客户甲',
      normalizedName: '客户甲',
      category: null,
      region: null,
      customerType: null,
      identityType: null,
      identityNumber: null,
      normalizedIdentityNumber: null,
      issuingCountryOrRegion: null,
      admissionContactName: null,
      admissionContactPhone: null,
      admissionContactEmail: null,
      profileStatus: 'DRAFT',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      version: 1,
      updatedAt: new Date('2026-09-17T04:00:00.000Z'),
    };
    const updated = {
      ...current,
      admissionContactName: '李四',
      admissionContactEmail: 'contact@example.com',
      version: 2,
      updatedAt: new Date('2026-09-17T05:00:00.000Z'),
    };
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const txAuditCreate = jest.fn().mockResolvedValue({ id: 'audit-1' });
    transaction.mockImplementation(async (callback) =>
      callback({
        customer: {
          findFirst: jest.fn().mockResolvedValueOnce(current),
          updateMany: txUpdateMany,
          findUnique: jest.fn().mockResolvedValue(updated),
        },
        auditEvent: { create: txAuditCreate },
      }),
    );

    await expect(
      service.updateDraft(actor, current.id, {
        expectedVersion: 1,
        admissionContactName: '李四',
        admissionContactEmail: 'contact@example.com',
      } as never),
    ).resolves.toMatchObject({
      admissionContactName: '李四',
      admissionContactPhone: null,
      admissionContactEmail: 'contact@example.com',
      version: 2,
    });
    expect(txUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: current.id, version: 1 }),
      data: expect.objectContaining({
        admissionContactName: '李四',
        admissionContactPhone: null,
        admissionContactEmail: 'contact@example.com',
        version: { increment: 1 },
      }),
    });
    expect(txAuditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'customer.updated',
        details: expect.objectContaining({
          changedFields: expect.arrayContaining([
            'admissionContactName',
            'admissionContactEmail',
          ]),
          changes: expect.objectContaining({
            admissionContactEmail: {
              before: null,
              after: '***@example.com',
            },
          }),
        }),
      }),
    });
  });

  it('preserves omitted fields in a partial edit', async () => {
    const current = {
      id: '33333333-3333-4333-8333-333333333333',
      name: '客户甲',
      normalizedName: '客户甲',
      category: '重要客户',
      region: '上海',
      customerType: 'enterprise',
      identityType: 'CREDIT-CODE',
      identityNumber: '91310000ABC123',
      normalizedIdentityNumber: '91310000ABC123',
      issuingCountryOrRegion: '中国',
      profileStatus: 'DRAFT',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      version: 1,
      updatedAt: new Date('2026-09-16T12:00:00.000Z'),
    };
    const updated = {
      ...current,
      name: '客户甲（更新）',
      normalizedName: '客户甲(更新)',
      version: 2,
      updatedAt: new Date('2026-09-17T03:00:00.000Z'),
    };
    const txUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    transaction.mockImplementation(async (callback) =>
      callback({
        customer: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce(current)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null),
          updateMany: txUpdateMany,
          findUnique: jest.fn().mockResolvedValue(updated),
        },
        auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
      }),
    );

    await service.updateDraft(actor, current.id, {
      expectedVersion: 1,
      name: '客户甲（更新）',
    });

    expect(txUpdateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: current.id, version: 1 }),
      data: expect.objectContaining({
        category: '重要客户',
        region: '上海',
        customerType: 'enterprise',
        identityType: 'CREDIT-CODE',
        identityNumber: '91310000ABC123',
        issuingCountryOrRegion: '中国',
      }),
    });
  });

  it('rejects a stale expected version without writing audit', async () => {
    buildCustomerScope.mockResolvedValue({ departmentId: actor.departmentId });
    const current = {
      id: '33333333-3333-4333-8333-333333333333',
      name: '客户甲',
      category: null,
      region: null,
      customerType: null,
      identityType: null,
      identityNumber: null,
      issuingCountryOrRegion: null,
      profileStatus: 'DRAFT',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      teamId: null,
      version: 2,
      updatedAt: new Date('2026-09-16T12:00:00.000Z'),
    };
    const txAuditCreate = jest.fn();
    transaction.mockImplementation(async (callback) =>
      callback({
        customer: { findFirst: jest.fn().mockResolvedValue(current) },
        auditEvent: { create: txAuditCreate },
      }),
    );

    await expect(
      service.updateDraft(actor, current.id, {
        expectedVersion: 1,
        name: '不会覆盖',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CUSTOMER_VERSION_CONFLICT' },
    });
    expect(txAuditCreate).not.toHaveBeenCalled();
  });
});
