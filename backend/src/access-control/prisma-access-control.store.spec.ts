import { DatabaseService } from '../database/database.service';
import {
  AccessControlSnapshotReader,
  PermissionAction,
} from './access-control.service';
import { PrismaAccessControlStore } from './prisma-access-control.store';

const snapshotRecord = {
  active: true,
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
