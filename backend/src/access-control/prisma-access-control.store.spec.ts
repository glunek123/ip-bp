import { DatabaseService } from '../database/database.service';
import {
  AccessControlSnapshotReader,
  PermissionAction,
} from './access-control.service';
import { PrismaAccessControlStore } from './prisma-access-control.store';

const snapshotRecord = {
  active: true,
  accountType: 'INTERNAL',
  authorizationRevision: 4,
  memberships: [
    {
      id: 'membership-a',
      teamId: 'team-a',
      team: { status: 'ACTIVE' },
    },
  ],
  roleAssignments: [
    {
      teamId: 'team-a',
      roleTemplate: {
        active: true,
        grants: [{ action: 'CUSTOMER_READ', scope: 'DEPARTMENT' }],
      },
    },
  ],
};

describe('PrismaAccessControlStore', () => {
  it('maps the list export grant to its internal action', async () => {
    const record = {
      ...snapshotRecord,
      roleAssignments: [
        {
          ...snapshotRecord.roleAssignments[0],
          roleTemplate: {
            active: true,
            grants: [{ action: 'NOTARY_LIST_EXPORT', scope: 'TEAM' }],
          },
        },
      ],
    };
    const store = new PrismaAccessControlStore({
      userAccount: { findUnique: jest.fn().mockResolvedValue(record) },
    } as unknown as DatabaseService);
    await expect(
      store.loadSnapshot('user-a', 'department-a'),
    ).resolves.toMatchObject({
      grants: [{ action: 'notary.list.export', scope: 'team' }],
    });
  });
  it('maps the return archive grant to its internal action', async () => {
    const record = {
      ...snapshotRecord,
      roleAssignments: [
        {
          ...snapshotRecord.roleAssignments[0],
          roleTemplate: {
            active: true,
            grants: [{ action: 'NOTARY_RETURN_ARCHIVE', scope: 'SELF' }],
          },
        },
      ],
    };
    const store = new PrismaAccessControlStore({
      userAccount: { findUnique: jest.fn().mockResolvedValue(record) },
    } as unknown as DatabaseService);
    await expect(
      store.loadSnapshot('user-a', 'department-a'),
    ).resolves.toMatchObject({
      grants: [{ action: 'notary.return.archive', scope: 'self' }],
    });
  });
  it('never treats a client account with a stale internal membership and role as an internal grant', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValue({ ...snapshotRecord, accountType: 'CLIENT' });
    const store = new PrismaAccessControlStore({
      userAccount: { findUnique },
    } as unknown as DatabaseService);

    await expect(
      store.loadSnapshot('client-a', 'department-a'),
    ).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ accountType: true }),
      }),
    );
  });

  it('loads the user, role assignments and grants through the caller reader', async () => {
    const defaultFindUnique = jest.fn();
    const transactionFindUnique = jest.fn().mockResolvedValue(snapshotRecord);
    const store = new PrismaAccessControlStore({
      userAccount: { findUnique: defaultFindUnique },
    } as unknown as DatabaseService);
    const transaction = {
      userAccount: { findUnique: transactionFindUnique },
    } as unknown as AccessControlSnapshotReader;

    await expect(
      store.loadSnapshot('user-a', 'department-a', transaction),
    ).resolves.toMatchObject({
      active: true,
      authorizationRevision: 4,
      grants: [
        {
          action: 'customer.read' satisfies PermissionAction,
          scope: 'department',
          teamId: 'team-a',
        },
      ],
    });

    expect(defaultFindUnique).not.toHaveBeenCalled();
    expect(transactionFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          roleAssignments: expect.objectContaining({
            select: expect.objectContaining({
              roleTemplate: expect.objectContaining({
                select: expect.objectContaining({ grants: expect.any(Object) }),
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('uses the injected database when no caller reader is provided', async () => {
    const defaultFindUnique = jest.fn().mockResolvedValue(snapshotRecord);
    const store = new PrismaAccessControlStore({
      userAccount: { findUnique: defaultFindUnique },
    } as unknown as DatabaseService);

    await expect(
      store.loadSnapshot('user-a', 'department-a'),
    ).resolves.toMatchObject({ grants: [{ action: 'customer.read' }] });
    expect(defaultFindUnique).toHaveBeenCalledTimes(1);
  });
});
