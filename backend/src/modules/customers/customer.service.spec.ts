import { NotFoundException } from '@nestjs/common';
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
  const authorizeCustomer = jest.fn();
  const buildCustomerScope = jest.fn();
  const accessControl = {
    authorizeCustomer,
    buildCustomerScope,
  } as unknown as AccessControlService;
  const customerCreate = jest.fn();
  const auditCreate = jest.fn();
  const customerFindMany = jest.fn();
  const customerCount = jest.fn();
  const customerFindFirst = jest.fn();
  const auditFindMany = jest.fn();
  const transaction = jest.fn();
  const database = {
    customer: {
      findMany: customerFindMany,
      count: customerCount,
      findFirst: customerFindFirst,
    },
    auditEvent: { findMany: auditFindMany },
    $transaction: transaction,
  } as unknown as DatabaseService;
  const service = new CustomerService(database, accessControl);

  beforeEach(() => {
    jest.clearAllMocks();
    authorizeCustomer.mockResolvedValue(undefined);
    buildCustomerScope.mockResolvedValue({ departmentId: actor.departmentId });
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
        customer: { create: customerCreate },
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
      profileStatus: 'draft',
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      version: 1,
      updatedAt: '2026-09-16T12:00:00.000Z',
    });
    expect(authorizeCustomer).toHaveBeenCalledWith(
      actor,
      'customer.create-draft',
      {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      },
    );
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
        customer: { create: customerCreate },
        auditEvent: { create: auditCreate },
      }),
    );

    await expect(service.createDraft(actor, { name: '客户' })).rejects.toThrow(
      'audit failed',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
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
  });
});
