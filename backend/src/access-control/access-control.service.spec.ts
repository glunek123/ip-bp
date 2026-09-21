import { ForbiddenException } from '@nestjs/common';
import {
  AccessControlService,
  AccessControlSnapshot,
  AccessControlStore,
} from './access-control.service';
import { ActorContext } from './actor-context';

const actor: ActorContext = {
  userId: 'user-a',
  departmentId: 'department-a',
  authorizationRevision: 4,
};

function createStore(
  snapshot: AccessControlSnapshot | null,
): AccessControlStore {
  return {
    loadSnapshot: jest.fn().mockResolvedValue(snapshot),
  };
}

describe('AccessControlService', () => {
  it('does not combine a department read grant with a self create grant', async () => {
    const service = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        grants: [
          { action: 'customer.read', scope: 'department' },
          { action: 'customer.create-draft', scope: 'self' },
        ],
      }),
    );

    await expect(
      service.authorizeCustomer(actor, 'customer.create-draft', {
        departmentId: 'department-a',
        responsibleUserId: 'user-b',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.authorizeCustomer(actor, 'customer.create-draft', {
        departmentId: 'department-a',
        responsibleUserId: 'user-a',
      }),
    ).resolves.toBeUndefined();
  });

  it('does not combine a department read grant with a self edit grant', async () => {
    const service = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        grants: [
          { action: 'customer.read', scope: 'department' },
          { action: 'customer.edit-routine', scope: 'self' },
        ],
      }),
    );

    await expect(
      service.authorizeCustomer(actor, 'customer.edit-routine', {
        departmentId: 'department-a',
        responsibleUserId: 'user-b',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('derives the active membership team for a TEAM-scoped customer create', async () => {
    const service = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        membershipTeamId: 'team-a',
        grants: [
          {
            action: 'customer.create-draft',
            scope: 'team',
            teamId: 'team-a',
          },
        ],
      }),
    );

    await expect(service.authorizeNewCustomer(actor)).resolves.toEqual({
      departmentId: 'department-a',
      responsibleUserId: 'user-a',
      teamId: 'team-a',
    });
  });

  it('denies a TEAM-only customer create when the membership Team is inactive', async () => {
    const service = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        membershipTeamId: 'team-a',
        membershipTeamActive: false,
        grants: [
          {
            action: 'customer.create-draft',
            scope: 'team',
            teamId: 'team-a',
          },
        ],
      }),
    );

    await expect(service.authorizeNewCustomer(actor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('creates an unbound customer through SELF scope when the membership Team is inactive', async () => {
    const service = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        membershipTeamId: 'team-a',
        membershipTeamActive: false,
        grants: [
          { action: 'customer.create-draft', scope: 'self' },
          {
            action: 'customer.create-draft',
            scope: 'team',
            teamId: 'team-a',
          },
        ],
      }),
    );

    await expect(service.authorizeNewCustomer(actor)).resolves.toEqual({
      departmentId: 'department-a',
      responsibleUserId: 'user-a',
    });
  });

  it('denies a foreign department even when the action has department scope', async () => {
    const service = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        grants: [{ action: 'customer.read', scope: 'department' }],
      }),
    );

    await expect(
      service.authorizeCustomer(actor, 'customer.read', {
        departmentId: 'department-b',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CUSTOMER_ACTION_FORBIDDEN',
        message: '无权执行此客户操作',
      },
    });
  });

  it.each([
    {
      name: 'disabled assignment',
      snapshot: {
        active: false,
        authorizationRevision: 4,
        grants: [
          { action: 'customer.read' as const, scope: 'department' as const },
        ],
      },
    },
    {
      name: 'stale authorization revision',
      snapshot: {
        active: true,
        authorizationRevision: 5,
        grants: [
          { action: 'customer.read' as const, scope: 'department' as const },
        ],
      },
    },
  ])('denies a $name on the next authorization call', async ({ snapshot }) => {
    const service = new AccessControlService(createStore(snapshot));

    await expect(
      service.authorizeCustomer(actor, 'customer.read', {
        departmentId: 'department-a',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('builds a database-ready self scope from a matching grant', async () => {
    const service = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        grants: [{ action: 'customer.read', scope: 'self' }],
      }),
    );

    await expect(
      service.buildCustomerScope(actor, 'customer.read'),
    ).resolves.toEqual({
      departmentId: 'department-a',
      responsibleUserId: 'user-a',
    });
  });

  it('builds DEPARTMENT, TEAM and SELF Lead scopes from matching grants', async () => {
    const departmentService = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        grants: [{ action: 'lead.read', scope: 'department' }],
      }),
    );
    await expect(
      departmentService.buildLeadScope(actor, 'lead.read'),
    ).resolves.toEqual({ departmentId: 'department-a' });

    const teamService = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        grants: [{ action: 'lead.read', scope: 'team', teamId: 'team-a' }],
      }),
    );
    await expect(
      teamService.buildLeadScope(actor, 'lead.read'),
    ).resolves.toEqual({
      departmentId: 'department-a',
      teamId: { in: ['team-a'] },
    });

    const selfService = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        grants: [{ action: 'lead.read', scope: 'self' }],
      }),
    );
    await expect(
      selfService.buildLeadScope(actor, 'lead.read'),
    ).resolves.toEqual({
      departmentId: 'department-a',
      responsibleUserId: 'user-a',
    });
  });

  it('rejects Lead authorization without the requested action', async () => {
    const service = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        grants: [{ action: 'lead.read', scope: 'department' }],
      }),
    );

    await expect(
      service.authorizeLead(actor, 'lead.edit', {
        departmentId: 'department-a',
        responsibleUserId: 'user-a',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.canAuthorizeNewLead(actor)).resolves.toBe(false);
  });

  it('rejects a foreign Lead department even with department scope', async () => {
    const service = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        grants: [{ action: 'lead.read', scope: 'department' }],
      }),
    );

    await expect(
      service.authorizeLead(actor, 'lead.read', {
        departmentId: 'department-b',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses the active membership Team when checking new Lead authorization', async () => {
    const service = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        membershipTeamId: 'team-a',
        membershipTeamActive: true,
        grants: [
          {
            action: 'lead.create',
            scope: 'team',
            teamId: 'team-a',
          },
        ],
      }),
    );

    await expect(service.canAuthorizeNewLead(actor)).resolves.toBe(true);
  });

  it('does not let Lead grants change an existing Customer scope result', async () => {
    const service = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        grants: [
          { action: 'customer.read', scope: 'self' },
          { action: 'lead.read', scope: 'department' },
        ],
      }),
    );

    await expect(
      service.buildCustomerScope(actor, 'customer.read'),
    ).resolves.toEqual({
      departmentId: 'department-a',
      responsibleUserId: 'user-a',
    });
  });

  it('reports a denied action as a capability without hiding store failures', async () => {
    const denied = new AccessControlService(
      createStore({
        active: true,
        authorizationRevision: 4,
        grants: [{ action: 'customer.read', scope: 'self' }],
      }),
    );
    await expect(
      denied.canAuthorizeCustomer(actor, 'customer.create-draft', {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      }),
    ).resolves.toBe(false);

    const failed = new AccessControlService({
      loadSnapshot: jest.fn().mockRejectedValue(new Error('database failed')),
    });
    await expect(
      failed.canAuthorizeCustomer(actor, 'customer.create-draft', {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      }),
    ).rejects.toThrow('database failed');
  });
});
