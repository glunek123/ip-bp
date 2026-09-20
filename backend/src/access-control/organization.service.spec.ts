import { ForbiddenException } from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { ActorContext } from './actor-context';

const actor: ActorContext = {
  userId: 'actor-user',
  departmentId: 'department-a',
  authorizationRevision: 4,
};

const departmentGrant = (action: string) => ({
  action,
  scope: 'DEPARTMENT',
});

function createFixture(options?: {
  actorGrants?: Array<{ action: string; scope: string }>;
  actorTeamId?: string | null;
  actorAssignmentTeamId?: string | null;
  actorTeamStatus?: 'ACTIVE' | 'INACTIVE';
  targetDepartmentId?: string;
  targetTeamId?: string | null;
  targetRoleGrants?: Array<{ action: string; scope: string }>;
  teamStatus?: 'ACTIVE' | 'INACTIVE';
  existingAssignments?: Array<{
    id: string;
    active: boolean;
    teamId: string | null;
    version: number;
  }>;
}) {
  const actorGrants = options?.actorGrants ?? [
    departmentGrant('ROLE_ASSIGN'),
    departmentGrant('CUSTOMER_READ'),
  ];
  const targetDepartmentId = options?.targetDepartmentId ?? actor.departmentId;
  const targetTeamId = options?.targetTeamId ?? null;
  const targetRoleGrants = options?.targetRoleGrants ?? [
    { action: 'CUSTOMER_READ', scope: 'SELF' },
  ];
  const transaction = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    userAccount: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === actor.userId
            ? { active: true, authorizationRevision: 4 }
            : { active: true, authorizationRevision: 2 },
        ),
      ),
      update: jest.fn().mockResolvedValue({ authorizationRevision: 3 }),
    },
    departmentMembership: {
      findUnique: jest.fn(
        ({
          where,
        }: {
          where: {
            userId_departmentId: { userId: string; departmentId: string };
          };
        }) => {
          const key = where.userId_departmentId;
          if (key.userId === actor.userId) {
            return Promise.resolve({
              id: 'membership-actor',
              active: true,
              departmentId: actor.departmentId,
              teamId: options?.actorTeamId ?? null,
              team:
                options?.actorTeamId === undefined ||
                options.actorTeamId === null
                  ? null
                  : { status: options?.actorTeamStatus ?? 'ACTIVE' },
            });
          }
          if (key.departmentId !== targetDepartmentId)
            return Promise.resolve(null);
          return Promise.resolve({
            id: 'membership-target',
            active: true,
            departmentId: targetDepartmentId,
            teamId: targetTeamId,
            team:
              targetTeamId === null
                ? null
                : { status: options?.teamStatus ?? 'ACTIVE' },
          });
        },
      ),
      update: jest.fn(),
    },
    roleAssignment: {
      findMany: jest.fn(
        ({ where }: { where: { userId: string; roleTemplateId?: string } }) =>
          Promise.resolve(
            where.userId === actor.userId && where.roleTemplateId === undefined
              ? [
                  {
                    teamId:
                      options?.actorAssignmentTeamId ??
                      options?.actorTeamId ??
                      null,
                    roleTemplate: { active: true, grants: actorGrants },
                  },
                ]
              : (options?.existingAssignments ?? []),
          ),
      ),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: 'assignment-new',
        active: true,
        teamId: targetTeamId,
        version: 1,
      }),
      update: jest.fn().mockResolvedValue({
        id: 'assignment-existing',
        active: true,
        teamId: targetTeamId,
        version: 2,
      }),
    },
    roleTemplate: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'target-role',
        active: true,
        departmentId: targetDepartmentId,
        grants: targetRoleGrants,
      }),
    },
    team: {
      findUnique: jest.fn().mockResolvedValue(
        targetTeamId === null
          ? null
          : {
              id: targetTeamId,
              departmentId: targetDepartmentId,
              status: options?.teamStatus ?? 'ACTIVE',
            },
      ),
      create: jest.fn().mockResolvedValue({
        id: 'team-new',
        departmentId: actor.departmentId,
        name: '新团队',
        status: 'ACTIVE',
      }),
      update: jest.fn().mockResolvedValue({
        id: 'team-a',
        departmentId: actor.departmentId,
        name: '团队甲',
        status: 'INACTIVE',
      }),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const database = {
    $transaction: jest.fn(
      async (callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
    ),
  };
  return {
    service: new OrganizationService(database as never),
    database,
    transaction,
  };
}

describe('OrganizationService role assignment boundary', () => {
  it('allows a department grant to assign a covered role to another member', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.assignRole(actor, {
        targetUserId: 'target-user',
        roleTemplateId: 'target-role',
        teamId: null,
      }),
    ).resolves.toMatchObject({ id: 'assignment-new', active: true });
    expect(fixture.transaction.roleAssignment.create).toHaveBeenCalled();
    expect(fixture.transaction.auditEvent.create).toHaveBeenCalled();
    expect(fixture.transaction.userAccount.update).toHaveBeenCalledWith({
      where: { id: 'target-user' },
      data: { authorizationRevision: { increment: 1 } },
    });
  });

  it('denies assignment without role.assign', async () => {
    const fixture = createFixture({
      actorGrants: [departmentGrant('CUSTOMER_READ')],
    });

    await expect(
      fixture.service.assignRole(actor, {
        targetUserId: 'target-user',
        roleTemplateId: 'target-role',
        teamId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.transaction.roleAssignment.create).not.toHaveBeenCalled();
  });

  it('denies a target outside the active department', async () => {
    const fixture = createFixture({ targetDepartmentId: 'department-b' });

    await expect(
      fixture.service.assignRole(actor, {
        targetUserId: 'target-user',
        roleTemplateId: 'target-role',
        teamId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a TEAM role.assign grant for a member of another Team', async () => {
    const fixture = createFixture({
      actorTeamId: 'team-a',
      targetTeamId: 'team-b',
      actorGrants: [
        { action: 'ROLE_ASSIGN', scope: 'TEAM' },
        { action: 'CUSTOMER_READ', scope: 'TEAM' },
      ],
      targetRoleGrants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
    });

    await expect(
      fixture.service.assignRole(actor, {
        targetUserId: 'target-user',
        roleTemplateId: 'target-role',
        teamId: 'team-b',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies TEAM grants whose assignment does not match the active membership Team', async () => {
    const fixture = createFixture({
      actorTeamId: 'team-a',
      actorAssignmentTeamId: 'team-b',
      targetTeamId: 'team-b',
      actorGrants: [
        { action: 'ROLE_ASSIGN', scope: 'TEAM' },
        { action: 'CUSTOMER_READ', scope: 'TEAM' },
      ],
      targetRoleGrants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
    });

    await expect(
      fixture.service.assignRole(actor, {
        targetUserId: 'target-user',
        roleTemplateId: 'target-role',
        teamId: 'team-b',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies TEAM grants from an inactive membership Team', async () => {
    const fixture = createFixture({
      actorTeamId: 'team-a',
      actorTeamStatus: 'INACTIVE',
      targetTeamId: 'team-a',
      actorGrants: [
        { action: 'ROLE_ASSIGN', scope: 'TEAM' },
        { action: 'CUSTOMER_READ', scope: 'TEAM' },
      ],
      targetRoleGrants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
    });

    await expect(
      fixture.service.assignRole(actor, {
        targetUserId: 'target-user',
        roleTemplateId: 'target-role',
        teamId: 'team-a',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not treat the actor SELF scope as the target member SELF scope', async () => {
    const fixture = createFixture({
      actorGrants: [
        departmentGrant('ROLE_ASSIGN'),
        { action: 'CUSTOMER_READ', scope: 'SELF' },
      ],
    });

    await expect(
      fixture.service.assignRole(actor, {
        targetUserId: 'target-user',
        roleTemplateId: 'target-role',
        teamId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not treat TEAM scope as covering another member SELF scope', async () => {
    const fixture = createFixture({
      actorTeamId: 'team-a',
      targetTeamId: 'team-a',
      actorGrants: [
        departmentGrant('ROLE_ASSIGN'),
        { action: 'CUSTOMER_READ', scope: 'TEAM' },
      ],
    });

    await expect(
      fixture.service.assignRole(actor, {
        targetUserId: 'target-user',
        roleTemplateId: 'target-role',
        teamId: 'team-a',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checks uncovered management grants inside the assigned role', async () => {
    const fixture = createFixture({
      targetRoleGrants: [{ action: 'TEAM_MANAGE', scope: 'DEPARTMENT' }],
    });

    await expect(
      fixture.service.assignRole(actor, {
        targetUserId: 'target-user',
        roleTemplateId: 'target-role',
        teamId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects new and restored bindings to an inactive Team', async () => {
    const fixture = createFixture({
      targetTeamId: 'team-a',
      teamStatus: 'INACTIVE',
      actorGrants: [
        departmentGrant('ROLE_ASSIGN'),
        departmentGrant('CUSTOMER_READ'),
      ],
      targetRoleGrants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
      existingAssignments: [
        {
          id: 'assignment-existing',
          active: false,
          teamId: 'team-a',
          version: 1,
        },
      ],
    });

    await expect(
      fixture.service.assignRole(actor, {
        targetUserId: 'target-user',
        roleTemplateId: 'target-role',
        teamId: 'team-a',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.transaction.roleAssignment.update).not.toHaveBeenCalled();
  });

  it('forbids self-assignment even with department scope', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.assignRole(actor, {
        targetUserId: actor.userId,
        roleTemplateId: 'target-role',
        teamId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('OrganizationService Team lifecycle', () => {
  it('creates a Team only with department-scoped team.manage', async () => {
    const fixture = createFixture({
      actorGrants: [departmentGrant('TEAM_MANAGE')],
    });

    await expect(
      fixture.service.createTeam(actor, { name: ' 新团队 ' }),
    ).resolves.toMatchObject({
      id: 'team-new',
      name: '新团队',
      status: 'ACTIVE',
    });
    expect(fixture.transaction.team.create).toHaveBeenCalledWith({
      data: { departmentId: actor.departmentId, name: '新团队' },
      select: expect.any(Object),
    });
  });

  it('does not let a TEAM-scoped manager create a new Team', async () => {
    const fixture = createFixture({
      actorTeamId: 'team-a',
      actorGrants: [{ action: 'TEAM_MANAGE', scope: 'TEAM' }],
    });

    await expect(
      fixture.service.createTeam(actor, { name: '越权团队' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('inactivates a Team without deleting its historical references', async () => {
    const fixture = createFixture({
      targetTeamId: 'team-a',
      actorGrants: [departmentGrant('TEAM_MANAGE')],
    });

    await expect(
      fixture.service.setTeamStatus(actor, 'team-a', 'INACTIVE'),
    ).resolves.toMatchObject({ id: 'team-a', status: 'INACTIVE' });
    expect(fixture.transaction.team.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'team-a' },
        data: { status: 'INACTIVE' },
      }),
    );
  });

  it('does not treat SELF team.manage as permission to change Team status', async () => {
    const fixture = createFixture({
      targetTeamId: 'team-a',
      actorGrants: [{ action: 'TEAM_MANAGE', scope: 'SELF' }],
    });

    await expect(
      fixture.service.setTeamStatus(actor, 'team-a', 'INACTIVE'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.transaction.team.update).not.toHaveBeenCalled();
  });

  it('rejects a member Team change while an active TEAM role assignment exists', async () => {
    const fixture = createFixture({
      targetTeamId: 'team-old',
      actorGrants: [departmentGrant('USER_MANAGE')],
    });
    fixture.transaction.roleAssignment.findFirst.mockResolvedValueOnce({
      id: 'team-assignment',
    });

    await expect(
      fixture.service.changeMembershipTeam(actor, {
        targetUserId: 'target-user',
        teamId: 'team-a',
      }),
    ).rejects.toMatchObject({
      response: { code: 'ACTIVE_TEAM_ROLE_ASSIGNMENT_EXISTS' },
    });
    expect(
      fixture.transaction.departmentMembership.update,
    ).not.toHaveBeenCalled();
  });

  it('rejects a member Team change for any active Team-bound assignment', async () => {
    const fixture = createFixture({
      targetTeamId: 'team-old',
      actorGrants: [departmentGrant('USER_MANAGE')],
    });
    fixture.transaction.roleAssignment.findFirst.mockResolvedValueOnce({
      id: 'inactive-template-or-non-team-grant-assignment',
    });

    await expect(
      fixture.service.changeMembershipTeam(actor, {
        targetUserId: 'target-user',
        teamId: 'team-a',
      }),
    ).rejects.toMatchObject({
      response: { code: 'ACTIVE_TEAM_ROLE_ASSIGNMENT_EXISTS' },
    });
    expect(fixture.transaction.roleAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'target-user',
        departmentId: actor.departmentId,
        active: true,
        teamId: { not: null },
      },
      select: { id: true },
    });
  });
});
