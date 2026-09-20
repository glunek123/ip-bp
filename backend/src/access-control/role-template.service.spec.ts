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
    },
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
    loadCurrentActorGrants: jest
      .fn()
      .mockResolvedValue(
        options?.actorGrants ?? [
          { action: 'ROLE_MANAGE', scope: 'DEPARTMENT', teamId: null },
        ],
      ),
  };

  return {
    service: new RoleTemplateService(
      database as never,
      organization as unknown as OrganizationService,
    ),
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
