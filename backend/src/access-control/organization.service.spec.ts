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
  contextMemberships?: Array<{
    id: string;
    active: boolean;
    teamId: string | null;
    user: {
      id: string;
      displayName: string;
      active: boolean;
      localCredential: { username: string } | null;
      roleAssignments: Array<{
        id: string;
        roleTemplateId: string;
        teamId: string | null;
        active: boolean;
        version: number;
        roleTemplate: { name: string };
      }>;
    };
  }>;
  contextTeams?: Array<{
    id: string;
    name: string;
    status: 'ACTIVE' | 'INACTIVE';
  }>;
  contextRoles?: Array<{
    id: string;
    name: string;
    active: boolean;
    grants: Array<{ action: string; scope: string }>;
  }>;
  targetAccountActive?: boolean;
  targetActiveMemberships?: Array<{ id: string; departmentId: string }>;
  targetCredentialHash?: string;
  targetAssignmentActive?: boolean;
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
            : {
                id: where.id,
                active: options?.targetAccountActive ?? true,
                authorizationRevision: 2,
              },
        ),
      ),
      create: jest.fn().mockResolvedValue({
        id: 'user-new',
        displayName: '运营乙',
        active: true,
      }),
      update: jest.fn(({ data }: { data: { active?: boolean } }) =>
        Promise.resolve({
          id: 'target-user',
          active: data.active ?? options?.targetAccountActive ?? true,
          authorizationRevision: 3,
        }),
      ),
    },
    localCredential: {
      findUnique: jest.fn().mockResolvedValue({
        passwordHash:
          options?.targetCredentialHash ??
          'scrypt$v1$16384$8$1$bGVnYWN5LXYxLXNhbHQhIQ$pZvZij3YSVf7LX5VNmX3dOn3DDbUNnc_8tRQaxJ-8iVLMXv4RH7IN2FajhK1bgIUjV-zOu8vUuC8cGrmSxBi7A',
        passwordChangedAt: new Date('2026-09-20T00:00:00.000Z'),
      }),
      create: jest.fn().mockResolvedValue({
        id: 'credential-new',
        username: 'operator.b',
      }),
      update: jest.fn().mockResolvedValue({ id: 'credential-target' }),
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
      create: jest.fn().mockResolvedValue({
        id: 'membership-new',
        active: true,
        teamId: targetTeamId,
      }),
      findMany: jest.fn(({ where }: { where?: { userId?: string } } = {}) =>
        Promise.resolve(
          where?.userId === undefined
            ? (options?.contextMemberships ?? [])
            : (options?.targetActiveMemberships ?? [
                {
                  id: 'membership-target',
                  departmentId: actor.departmentId,
                },
              ]),
        ),
      ),
      update: jest.fn(),
    },
    roleAssignment: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'assignment-existing',
        userId: 'target-user',
        departmentId: actor.departmentId,
        roleTemplateId: 'target-role',
        teamId: targetTeamId,
        active: options?.targetAssignmentActive ?? true,
        version: 1,
      }),
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
      findMany: jest.fn().mockResolvedValue(options?.contextRoles ?? []),
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
      findMany: jest.fn().mockResolvedValue(options?.contextTeams ?? []),
    },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    authSession: {
      updateMany: jest.fn().mockResolvedValue({ count: 2 }),
    },
  };
  const database = {
    localCredential: transaction.localCredential,
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

describe('OrganizationService management context', () => {
  const sameTeamMembership = {
    id: 'membership-same-team',
    active: true,
    teamId: 'team-a',
    user: {
      id: 'same-team-user',
      displayName: '同组人员',
      active: true,
      localCredential: { username: 'same.team' },
      roleAssignments: [],
    },
  };
  const otherTeamMembership = {
    id: 'membership-other-team',
    active: true,
    teamId: 'team-b',
    user: {
      id: 'other-team-user',
      displayName: '其他组人员',
      active: true,
      localCredential: { username: 'other.team' },
      roleAssignments: [],
    },
  };

  it('returns all current-department management data to a department reader', async () => {
    const fixture = createFixture({
      actorGrants: [
        departmentGrant('USER_READ'),
        departmentGrant('USER_MANAGE'),
        departmentGrant('TEAM_READ'),
        departmentGrant('TEAM_MANAGE'),
        departmentGrant('ROLE_READ'),
        departmentGrant('ROLE_ASSIGN'),
        departmentGrant('CUSTOMER_READ'),
      ],
      contextMemberships: [sameTeamMembership, otherTeamMembership],
      contextTeams: [
        { id: 'team-a', name: '团队甲', status: 'ACTIVE' },
        { id: 'team-b', name: '团队乙', status: 'ACTIVE' },
      ],
      contextRoles: [
        {
          id: 'role-a',
          name: '运营',
          active: true,
          grants: [{ action: 'CUSTOMER_READ', scope: 'SELF' }],
        },
      ],
    });

    const result = await fixture.service.getManagementContext(actor);

    expect(result.users.map((user) => user.id)).toEqual([
      'same-team-user',
      'other-team-user',
    ]);
    expect(result.teams.map((team) => team.id)).toEqual(['team-a', 'team-b']);
    expect(result.roles.map((role) => role.id)).toEqual(['role-a']);
    expect(result.capabilities).toEqual({
      createUser: true,
      manageUsers: true,
      createTeam: true,
      manageTeams: true,
      assignDepartmentRoles: true,
      assignTeamRoles: false,
    });
  });

  it('constrains TEAM-scoped management reads to the active actor Team', async () => {
    const fixture = createFixture({
      actorTeamId: 'team-a',
      actorGrants: [
        { action: 'USER_READ', scope: 'TEAM' },
        { action: 'TEAM_READ', scope: 'TEAM' },
        { action: 'ROLE_READ', scope: 'TEAM' },
        { action: 'ROLE_ASSIGN', scope: 'TEAM' },
        { action: 'CUSTOMER_READ', scope: 'TEAM' },
      ],
      contextMemberships: [sameTeamMembership],
      contextTeams: [{ id: 'team-a', name: '团队甲', status: 'ACTIVE' }],
      contextRoles: [
        {
          id: 'role-team',
          name: '组内运营',
          active: true,
          grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
        },
        {
          id: 'role-self',
          name: '本人运营',
          active: true,
          grants: [{ action: 'CUSTOMER_READ', scope: 'SELF' }],
        },
      ],
    });

    const result = await fixture.service.getManagementContext(actor);

    expect(result.users.map((user) => user.id)).toEqual(['same-team-user']);
    expect(result.teams.map((team) => team.id)).toEqual(['team-a']);
    expect(result.roles.map((role) => role.id)).toEqual(['role-team']);
    expect(result.capabilities.assignTeamRoles).toBe(true);
    expect(
      fixture.transaction.departmentMembership.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ teamId: 'team-a' }),
      }),
    );
  });
});

describe('OrganizationService personnel creation', () => {
  it('creates account, credential, membership, assignment, and audit in one transaction', async () => {
    const fixture = createFixture({
      actorGrants: [
        departmentGrant('USER_MANAGE'),
        departmentGrant('ROLE_ASSIGN'),
        departmentGrant('CUSTOMER_READ'),
      ],
    });

    await expect(
      fixture.service.createUser(actor, {
        displayName: ' 运营乙 ',
        username: ' Operator.B ',
        password: 'temporary-pass-123',
        teamId: null,
        roleTemplateId: 'target-role',
      }),
    ).resolves.toMatchObject({
      id: 'user-new',
      displayName: '运营乙',
      username: 'operator.b',
      accountActive: true,
      membership: { id: 'membership-new', active: true, teamId: null },
      assignment: { id: 'assignment-new', active: true },
    });

    expect(fixture.database.$transaction).toHaveBeenCalledTimes(1);
    expect(fixture.transaction.userAccount.create).toHaveBeenCalledTimes(1);
    expect(fixture.transaction.localCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-new',
        username: 'operator.b',
        passwordHash: expect.stringMatching(/^scrypt\$v2\$/),
      }),
    });
    expect(
      fixture.transaction.departmentMembership.create,
    ).toHaveBeenCalledTimes(1);
    expect(fixture.transaction.roleAssignment.create).toHaveBeenCalledTimes(1);
    expect(fixture.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'user.created',
        resourceId: 'user-new',
      }),
    });
  });

  it('does not create an account without department-scoped user.manage', async () => {
    const fixture = createFixture({
      actorGrants: [
        { action: 'USER_MANAGE', scope: 'TEAM' },
        departmentGrant('ROLE_ASSIGN'),
        departmentGrant('CUSTOMER_READ'),
      ],
    });

    await expect(
      fixture.service.createUser(actor, {
        displayName: '运营乙',
        username: 'operator.b',
        password: 'temporary-pass-123',
        teamId: null,
        roleTemplateId: 'target-role',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(fixture.transaction.userAccount.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent username conflict without exposing Prisma details', async () => {
    const fixture = createFixture({
      actorGrants: [
        departmentGrant('USER_MANAGE'),
        departmentGrant('ROLE_ASSIGN'),
        departmentGrant('CUSTOMER_READ'),
      ],
    });
    fixture.database.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('unique constraint metadata'), { code: 'P2002' }),
    );

    await expect(
      fixture.service.createUser(actor, {
        displayName: '运营乙',
        username: 'operator.b',
        password: 'temporary-pass-123',
        teamId: null,
        roleTemplateId: 'target-role',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'USERNAME_ALREADY_EXISTS',
        message: '用户名已存在',
      },
    });
  });
});

describe('OrganizationService account lifecycle', () => {
  it('deactivates a single-department account and revokes every session atomically', async () => {
    const fixture = createFixture({
      actorGrants: [departmentGrant('USER_MANAGE')],
    });

    await expect(
      fixture.service.setUserStatus(actor, 'target-user', {
        active: false,
        reason: '离职停用',
      }),
    ).resolves.toMatchObject({ id: 'target-user', active: false });

    expect(fixture.transaction.userAccount.update).toHaveBeenCalledWith({
      where: { id: 'target-user' },
      data: {
        active: false,
        authorizationRevision: { increment: 1 },
      },
      select: { id: true, active: true, authorizationRevision: true },
    });
    expect(fixture.transaction.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'target-user', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(fixture.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'user.status-changed',
        details: { from: true, to: false, reason: '离职停用' },
      }),
    });
    expect(fixture.database.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects global account changes for a multi-department target', async () => {
    const fixture = createFixture({
      actorGrants: [departmentGrant('USER_MANAGE')],
      targetActiveMemberships: [
        { id: 'membership-a', departmentId: actor.departmentId },
        { id: 'membership-b', departmentId: 'department-b' },
      ],
    });

    await expect(
      fixture.service.setUserStatus(actor, 'target-user', {
        active: false,
        reason: '离职停用',
      }),
    ).rejects.toMatchObject({
      response: { code: 'GLOBAL_ACCOUNT_MANAGEMENT_REQUIRED' },
    });
    expect(fixture.transaction.userAccount.update).not.toHaveBeenCalled();
  });

  it('forbids changing the current actor account', async () => {
    const fixture = createFixture({
      actorGrants: [departmentGrant('USER_MANAGE')],
    });

    await expect(
      fixture.service.setUserStatus(actor, actor.userId, {
        active: false,
        reason: '错误操作',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('OrganizationService password reset', () => {
  it('requires actor reauthentication and revokes target sessions', async () => {
    const fixture = createFixture({
      actorGrants: [departmentGrant('USER_MANAGE')],
    });

    await expect(
      fixture.service.resetUserPassword(actor, 'target-user', {
        currentPassword: 'legacy passphrase value',
        newPassword: 'replacement-pass-123',
        reason: '本人无法登录',
      }),
    ).resolves.toEqual({ id: 'target-user', passwordReset: true });

    expect(fixture.transaction.localCredential.update).toHaveBeenCalledWith({
      where: { userId: 'target-user' },
      data: {
        passwordHash: expect.stringMatching(/^scrypt\$v2\$/),
        passwordChangedAt: expect.any(Date),
      },
    });
    expect(fixture.transaction.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'target-user', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(fixture.transaction.userAccount.update).toHaveBeenCalledWith({
      where: { id: 'target-user' },
      data: { authorizationRevision: { increment: 1 } },
    });
    expect(fixture.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'user.password-reset',
        details: { reason: '本人无法登录' },
      }),
    });
    expect(
      JSON.stringify(fixture.transaction.auditEvent.create.mock.calls),
    ).not.toContain('replacement-pass-123');
  });

  it('rejects an incorrect actor password before opening a write transaction', async () => {
    const fixture = createFixture({
      actorGrants: [departmentGrant('USER_MANAGE')],
    });

    await expect(
      fixture.service.resetUserPassword(actor, 'target-user', {
        currentPassword: 'incorrect password value',
        newPassword: 'replacement-pass-123',
        reason: '本人无法登录',
      }),
    ).rejects.toMatchObject({
      response: { code: 'REAUTHENTICATION_FAILED' },
    });
    expect(fixture.database.$transaction).not.toHaveBeenCalled();
    expect(fixture.transaction.localCredential.update).not.toHaveBeenCalled();
  });
});

describe('OrganizationService membership lifecycle', () => {
  it('deactivates a department membership and revokes its sessions', async () => {
    const fixture = createFixture({
      actorGrants: [departmentGrant('USER_MANAGE')],
    });
    fixture.transaction.departmentMembership.update.mockResolvedValueOnce({
      id: 'membership-target',
      active: false,
      teamId: null,
    });

    await expect(
      fixture.service.updateMembership(actor, 'target-user', {
        active: false,
        reason: '调离当前部门',
      }),
    ).resolves.toMatchObject({ id: 'membership-target', active: false });

    expect(
      fixture.transaction.departmentMembership.update,
    ).toHaveBeenCalledWith({
      where: { id: 'membership-target' },
      data: { active: false },
      select: { id: true, active: true, teamId: true },
    });
    expect(fixture.transaction.authSession.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'target-user',
        departmentId: actor.departmentId,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(fixture.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'department-membership.status-changed',
        details: {
          from: true,
          to: false,
          reason: '调离当前部门',
        },
      }),
    });
  });

  it('keeps the active Team-assignment conflict for explicit Team changes', async () => {
    const fixture = createFixture({
      targetTeamId: 'team-old',
      actorGrants: [departmentGrant('USER_MANAGE')],
    });
    fixture.transaction.roleAssignment.findFirst.mockResolvedValueOnce({
      id: 'team-assignment',
    });

    await expect(
      fixture.service.updateMembership(actor, 'target-user', {
        teamId: 'team-a',
        reason: '调岗到团队甲',
      }),
    ).rejects.toMatchObject({
      response: { code: 'ACTIVE_TEAM_ROLE_ASSIGNMENT_EXISTS' },
    });
    expect(
      fixture.transaction.departmentMembership.update,
    ).not.toHaveBeenCalled();
  });
});

describe('OrganizationService role lifecycle', () => {
  it('revokes an active role assignment and invalidates authorization', async () => {
    const fixture = createFixture({
      actorGrants: [
        departmentGrant('ROLE_ASSIGN'),
        departmentGrant('CUSTOMER_READ'),
      ],
    });
    fixture.transaction.roleAssignment.update.mockResolvedValueOnce({
      id: 'assignment-existing',
      active: false,
      teamId: null,
      version: 2,
    });

    await expect(
      fixture.service.setRoleAssignmentStatus(
        actor,
        'target-user',
        'assignment-existing',
        { active: false, reason: '撤销客户访问' },
      ),
    ).resolves.toMatchObject({
      id: 'assignment-existing',
      active: false,
      version: 2,
    });

    expect(fixture.transaction.roleAssignment.update).toHaveBeenCalledWith({
      where: { id: 'assignment-existing' },
      data: { active: false, version: { increment: 1 } },
      select: { id: true, active: true, teamId: true, version: true },
    });
    expect(fixture.transaction.userAccount.update).toHaveBeenCalledWith({
      where: { id: 'target-user' },
      data: { authorizationRevision: { increment: 1 } },
    });
    expect(fixture.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'role-assignment.revoked',
        details: expect.objectContaining({ reason: '撤销客户访问' }),
      }),
    });
  });

  it('restores an inactive assignment through the current Grant Boundary', async () => {
    const fixture = createFixture({
      targetAssignmentActive: false,
      existingAssignments: [
        {
          id: 'assignment-existing',
          active: false,
          teamId: null,
          version: 1,
        },
      ],
      actorGrants: [
        departmentGrant('ROLE_ASSIGN'),
        departmentGrant('CUSTOMER_READ'),
      ],
    });

    await expect(
      fixture.service.setRoleAssignmentStatus(
        actor,
        'target-user',
        'assignment-existing',
        { active: true, reason: '恢复客户访问' },
      ),
    ).resolves.toMatchObject({
      id: 'assignment-existing',
      active: true,
      version: 2,
    });
    expect(fixture.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'role-assignment.restored-or-rebound',
        details: expect.objectContaining({ reason: '恢复客户访问' }),
      }),
    });
  });
});

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
