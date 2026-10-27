import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import { CustomerCaseEntrySourceService } from './customer-case-entry-source.service';

const actor: ActorContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  departmentId: '22222222-2222-4222-8222-222222222222',
  authorizationRevision: 3,
};

describe('CustomerCaseEntrySourceService', () => {
  const buildCustomerScope = jest.fn();
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const queryRaw = jest.fn();
  const service = new CustomerCaseEntrySourceService(
    { customer: { findMany } } as unknown as DatabaseService,
    { buildCustomerScope } as unknown as AccessControlService,
  );
  const tx = {
    customer: { findFirst },
    $queryRaw: queryRaw,
  } as unknown as Prisma.TransactionClient;

  beforeEach(() => {
    jest.resetAllMocks();
    buildCustomerScope.mockResolvedValue({ responsibleUserId: actor.userId });
    findFirst.mockResolvedValue({ id: 'customer' });
    queryRaw.mockResolvedValue([{ id: 'customer' }]);
  });

  it('does not query or disclose candidates without current customer scope', async () => {
    buildCustomerScope.mockRejectedValue(new ForbiddenException());
    await expect(service.list(actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('returns only scoped admitted customers and real linked holder names', async () => {
    findMany.mockResolvedValue([
      {
        id: 'customer',
        name: '真实客户',
        rightsHolderLinks: [
          { rightsHolder: { id: 'holder', name: '真实主体' } },
        ],
      },
    ]);
    await expect(service.list(actor)).resolves.toEqual([
      {
        id: 'customer',
        name: '真实客户',
        rightsHolders: [{ id: 'holder', name: '真实主体' }],
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ responsibleUserId: actor.userId }],
          departmentId: actor.departmentId,
          profileStatus: 'ADMITTED',
          deletedAt: null,
        },
      }),
    );
  });

  it('exposes scoped customer business IDs only for CSV matching', async () => {
    findMany.mockResolvedValue([
      {
        id: 'customer',
        name: '真实客户',
        businessId: 'CU-1',
        rightsHolderLinks: [
          { rightsHolder: { id: 'holder', name: '真实主体' } },
        ],
      },
    ]);
    await expect(service.listForCsv(actor)).resolves.toEqual([
      {
        id: 'customer',
        name: '真实客户',
        businessId: 'CU-1',
        rightsHolders: [{ id: 'holder', name: '真实主体' }],
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [{ responsibleUserId: actor.userId }],
          departmentId: actor.departmentId,
          profileStatus: 'ADMITTED',
          deletedAt: null,
        },
        select: expect.objectContaining({ businessId: true }),
      }),
    );
  });

  it('reads CSV candidates and customer scope through the supplied transaction', async () => {
    const txFindMany = jest.fn().mockResolvedValue([]);
    const reader = {
      customer: { findMany: txFindMany },
    } as unknown as Prisma.TransactionClient;
    await expect(service.listForCsv(actor, reader)).resolves.toEqual([]);
    expect(buildCustomerScope).toHaveBeenCalledWith(
      actor,
      'customer.read',
      reader,
    );
    expect(txFindMany).toHaveBeenCalledTimes(1);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects an invisible customer before acquiring a party lock', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      service.assertEligible(tx, actor, 'customer', 'holder'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a missing or different-department real holder link', async () => {
    queryRaw.mockResolvedValue([]);
    await expect(
      service.assertEligible(tx, actor, 'customer', 'holder'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('revalidates current customer scope after locking the actual parties', async () => {
    buildCustomerScope
      .mockResolvedValueOnce({ responsibleUserId: actor.userId })
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      service.assertEligible(tx, actor, 'customer', 'holder'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('accepts an admitted historical customer without requiring active cooperation', async () => {
    await expect(
      service.assertEligible(tx, actor, 'customer', 'holder'),
    ).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(buildCustomerScope).toHaveBeenCalledTimes(2);
  });
});
