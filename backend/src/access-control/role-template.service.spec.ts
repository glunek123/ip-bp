import { ForbiddenException } from '@nestjs/common';
import { ActorContext } from './actor-context';
import { OrganizationService } from './organization.service';
import { RoleTemplateService } from './role-template.service';

const actor: ActorContext = {
  userId: 'actor-user',
  departmentId: 'department-a',
  authorizationRevision: 4,
};

function createFixture(options?: {
  actorGrants?: Array<{ action: string; scope: string; teamId: string | null }>;
  role?: { id: string; departmentId: string; version: number } | null;
  assignments?: Array<{
    userId: string;
    user: { displayName: string };
  }>;
}) {
  const transaction = {
    roleTemplate: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options?.role === undefined
            ? { id: 'role-a', departmentId: actor.departmentId, version: 2 }
            : options.role,
        ),
      create: jest.fn().mockResolvedValue({
        id: 'role-copy',
        name: '复制角色',
        version: 1,
      }),
    },
    roleGrant: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    roleAssignment: {
      findMany: jest.fn().mockResolvedValue(
        options?.assignments ?? [
          { userId: 'user-b', user: { displayName: '运营乙' } },
          { userId: 'user-b', user: { displayName: '运营乙' } },
          { userId: 'user-c', user: { displayName: '运营丙' } },
        ],
      ),
    },
  };
  const database = {
    $transaction: jest.fn(
      async (callback: (value: typeof transaction) => unknown) =>
        callback(transaction),
    ),
  };
  const organization = {
    lockDepartment: jest.fn().mockResolvedValue(undefined),
    lockRoleTemplate: jest.fn().mockResolvedValue(undefined),
    loadCurrentActorGrants: jest.fn().mockResolvedValue(
      options?.actorGrants ?? [
        { action: 'ROLE_MANAGE', scope: 'DEPARTMENT', teamId: null },
        { action: 'CUSTOMER_READ', scope: 'DEPARTMENT', teamId: null },
      ],
    ),
  };

  return {
    service: new RoleTemplateService(
      database as never,
      organization as unknown as OrganizationService,
    ),
    database,
    transaction,
    organization,
  };
}

describe('RoleTemplateService impact preview', () => {
  it('returns distinct active affected users from the current department', async () => {
    const fixture = createFixture();

    await expect(fixture.service.getImpact(actor, 'role-a')).resolves.toEqual({
      roleTemplateId: 'role-a',
      version: 2,
      activeAssignmentCount: 2,
      affectedUsers: [
        { id: 'user-b', displayName: '运营乙' },
        { id: 'user-c', displayName: '运营丙' },
      ],
    });

    expect(fixture.transaction.roleTemplate.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'role-a',
        departmentId: actor.departmentId,
        active: true,
      },
      select: { id: true, departmentId: true, version: true },
    });
    expect(fixture.transaction.roleAssignment.findMany).toHaveBeenCalledWith({
      where: {
        roleTemplateId: 'role-a',
        departmentId: actor.departmentId,
        active: true,
      },
      select: { userId: true, user: { select: { displayName: true } } },
      orderBy: [{ user: { displayName: 'asc' } }, { userId: 'asc' }],
    });
  });

  it.each(['TEAM', 'SELF'])(
    'rejects ROLE_MANAGE at %s scope',
    async (scope) => {
      const fixture = createFixture({
        actorGrants: [{ action: 'ROLE_MANAGE', scope, teamId: 'team-a' }],
      });

      await expect(
        fixture.service.getImpact(actor, 'role-a'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(fixture.transaction.roleTemplate.findFirst).not.toHaveBeenCalled();
    },
  );

  it('conceals a known template from another department', async () => {
    const fixture = createFixture({ role: null });

    await expect(
      fixture.service.getImpact(actor, 'foreign-role'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.transaction.roleAssignment.findMany).not.toHaveBeenCalled();
  });
});

describe('RoleTemplateService copy', () => {
  const input = {
    sourceRoleTemplateId: 'role-a',
    name: ' 复制角色 ',
    grants: [{ action: 'CUSTOMER_READ' as const, scope: 'TEAM' as const }],
  };

  it('creates the complete copied template and audit atomically', async () => {
    const fixture = createFixture();

    await expect(fixture.service.copy(actor, input)).resolves.toEqual({
      id: 'role-copy',
      name: '复制角色',
      version: 1,
      activeAssignmentCount: 0,
      grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
    });

    expect(fixture.organization.lockDepartment).toHaveBeenCalledWith(
      fixture.transaction,
      actor.departmentId,
    );
    expect(fixture.organization.lockRoleTemplate).toHaveBeenCalledWith(
      fixture.transaction,
      actor.departmentId,
      'role-a',
      'SHARE',
    );
    expect(fixture.transaction.roleTemplate.create).toHaveBeenCalledWith({
      data: { departmentId: actor.departmentId, name: '复制角色' },
      select: { id: true, name: true, version: true },
    });
    expect(fixture.transaction.roleGrant.createMany).toHaveBeenCalledWith({
      data: [
        {
          roleTemplateId: 'role-copy',
          action: 'CUSTOMER_READ',
          scope: 'TEAM',
        },
      ],
    });
    expect(fixture.transaction.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'role-template.created',
        resourceId: 'role-copy',
        details: {
          sourceRoleTemplateId: 'role-a',
          version: 1,
          grants: [{ action: 'CUSTOMER_READ', scope: 'TEAM' }],
        },
      }),
    });
    expect(fixture.database.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
  });

  it('rejects an empty or duplicate Grant set before opening a transaction', async () => {
    const fixture = createFixture();

    await expect(
      fixture.service.copy(actor, { ...input, grants: [] }),
    ).rejects.toMatchObject({
      response: { code: 'ROLE_TEMPLATE_GRANTS_REQUIRED' },
    });
    await expect(
      fixture.service.copy(actor, {
        ...input,
        grants: [input.grants[0], input.grants[0]],
      }),
    ).rejects.toMatchObject({
      response: { code: 'ROLE_TEMPLATE_DUPLICATE_GRANT' },
    });
    expect(fixture.database.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a Grant action the actor does not cover at department scope', async () => {
    const fixture = createFixture({
      actorGrants: [
        { action: 'ROLE_MANAGE', scope: 'DEPARTMENT', teamId: null },
        { action: 'CUSTOMER_READ', scope: 'TEAM', teamId: 'team-a' },
      ],
    });

    await expect(fixture.service.copy(actor, input)).rejects.toMatchObject({
      response: { code: 'ROLE_TEMPLATE_GRANT_NOT_COVERED' },
    });
    expect(fixture.transaction.roleTemplate.create).not.toHaveBeenCalled();
  });

  it('conceals an unavailable source template', async () => {
    const fixture = createFixture({ role: null });

    await expect(fixture.service.copy(actor, input)).rejects.toMatchObject({
      response: { code: 'ROLE_TEMPLATE_SOURCE_UNAVAILABLE' },
    });
    expect(fixture.transaction.roleTemplate.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent duplicate name without exposing Prisma details', async () => {
    const fixture = createFixture();
    fixture.database.$transaction.mockRejectedValueOnce(
      Object.assign(new Error('unique metadata'), { code: 'P2002' }),
    );

    await expect(fixture.service.copy(actor, input)).rejects.toMatchObject({
      response: { code: 'ROLE_TEMPLATE_NAME_ALREADY_EXISTS' },
    });
  });

  it('does not report success when the transaction audit write fails', async () => {
    const fixture = createFixture();
    fixture.transaction.auditEvent.create.mockRejectedValueOnce(
      new Error('audit unavailable'),
    );

    await expect(fixture.service.copy(actor, input)).rejects.toThrow(
      'audit unavailable',
    );
  });
});
