import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { DatabaseService } from '../../database/database.service';
import { CustomerCalendarSourceService } from './customer-calendar-source.service';

const actor = {
  userId: 'user',
  departmentId: 'department',
  authorizationRevision: 7,
};

describe('CustomerCalendarSourceService', () => {
  function fixture() {
    const database = {
      userAccount: {
        findUnique: jest.fn().mockResolvedValue({
          active: true,
          accountType: 'INTERNAL',
          authorizationRevision: 7,
        }),
      },
      customer: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'customer-1', name: '客户' }]),
      },
      customerAgreement: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'agreement-1',
            customerId: 'customer-1',
            currentVersionId: 'version-2',
          },
        ]),
      },
      customerAgreementVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'version-2',
            agreementId: 'agreement-1',
            customerId: 'customer-1',
            validityMode: 'FIXED',
            effectiveTo: new Date('2026-11-12T00:00:00.000Z'),
          },
        ]),
      },
    };
    const access = {
      buildCustomerScope: jest
        .fn()
        .mockImplementation(async (_actor: unknown, action: string) =>
          action === 'customer.read'
            ? { responsibleUserId: 'user' }
            : { teamId: 'team' },
        ),
    };
    const service = new CustomerCalendarSourceService(
      database as unknown as DatabaseService,
      access as unknown as AccessControlService,
    );
    return { database, access, service };
  }

  it('intersects both customer scopes and reads only the current fixed version', async () => {
    const { database, service } = fixture();
    const events = await service.list(actor);
    expect(database.customer.findMany.mock.calls[0][0].where.AND).toEqual([
      { responsibleUserId: 'user' },
      { teamId: 'team' },
    ]);
    expect(events).toMatchObject([
      {
        sourceId: 'version-2',
        date: '2026-11-12',
        customerId: 'customer-1',
        name: '客户',
      },
    ]);
  });

  it('marks agreement forbidden without querying customers when one scope is absent', async () => {
    const { database, access, service } = fixture();
    access.buildCustomerScope.mockImplementation(
      async (_actor: unknown, action: string) => {
        if (action === 'customer.agreement.read')
          throw new ForbiddenException();
        return { departmentId: actor.departmentId };
      },
    );
    await expect(service.list(actor)).resolves.toBeNull();
    expect(database.customer.findMany).not.toHaveBeenCalled();
  });

  it('does not expose agreements to client or lawyer principals', async () => {
    const { database, service } = fixture();
    await expect(
      service.list({ ...actor, clientCustomerId: 'customer-1' }),
    ).resolves.toBeNull();
    await expect(
      service.list({ ...actor, lawyerAccountId: actor.userId }),
    ).resolves.toBeNull();
    expect(database.userAccount.findUnique).not.toHaveBeenCalled();
  });

  it('excludes floating validity', async () => {
    const { database, service } = fixture();
    database.customerAgreementVersion.findMany.mockResolvedValue([
      {
        id: 'version-2',
        agreementId: 'agreement-1',
        customerId: 'customer-1',
        validityMode: 'INDEFINITE',
        effectiveTo: null,
      },
    ]);
    await expect(service.list(actor)).resolves.toEqual([]);
  });

  it('rejects an already selected customer moved outside the scope', async () => {
    const { database, service } = fixture();
    database.customer.findMany
      .mockResolvedValueOnce([{ id: 'customer-1', name: '客户' }])
      .mockResolvedValueOnce([]);
    await expect(service.list(actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(database.customer.findMany.mock.calls[1][0].where).toMatchObject({
      id: { in: ['customer-1'] },
      AND: [{ responsibleUserId: 'user' }, { teamId: 'team' }],
    });
  });

  it('rejects a current agreement version pointer changed during the read', async () => {
    const { database, service } = fixture();
    database.customerAgreement.findMany
      .mockResolvedValueOnce([
        {
          id: 'agreement-1',
          customerId: 'customer-1',
          currentVersionId: 'version-2',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'agreement-1',
          customerId: 'customer-1',
          currentVersionId: 'version-3',
        },
      ]);
    await expect(service.list(actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
