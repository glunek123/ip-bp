import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { ActorContext } from './actor-context';

export const ACCESS_CONTROL_STORE = Symbol('ACCESS_CONTROL_STORE');

export type PermissionAction =
  | 'customer.read'
  | 'customer.create-draft'
  | 'customer.edit-routine'
  | 'customer.admit'
  | 'lead.read'
  | 'lead.create'
  | 'lead.edit'
  | 'lead.push'
  | 'lead.withdraw.apply'
  | 'client.lead.read'
  | 'client.lead.review'
  | 'client.lead.withdraw.confirm'
  | 'user.read'
  | 'user.manage'
  | 'team.read'
  | 'team.manage'
  | 'role.read'
  | 'role.assign'
  | 'role.manage';
export type CustomerAction = Extract<PermissionAction, `customer.${string}`>;
export type PermissionScope = 'self' | 'team' | 'department';
export type CustomerScope = PermissionScope;
export type LeadAction = Extract<PermissionAction, `lead.${string}`>;

export type CustomerResourceFacts = {
  departmentId: string;
  responsibleUserId?: string;
  teamId?: string;
};

export type CustomerScopePredicate = {
  departmentId: string;
  responsibleUserId?: string;
  OR?: Array<{ responsibleUserId: string } | { teamId: { in: string[] } }>;
  teamId?: { in: string[] };
};

export type LeadResourceFacts = {
  departmentId: string;
  responsibleUserId?: string;
  teamId?: string;
};

export type LeadScopePredicate = {
  departmentId: string;
  responsibleUserId?: string;
  OR?: Array<{ responsibleUserId: string } | { teamId: { in: string[] } }>;
  teamId?: { in: string[] };
};

export type AccessControlSnapshot = {
  active: boolean;
  authorizationRevision: number;
  membershipTeamId?: string;
  membershipTeamActive?: boolean;
  grants: Array<{
    action: PermissionAction;
    scope: PermissionScope;
    teamId?: string;
  }>;
};

export type AccessControlSnapshotReader = Pick<
  Prisma.TransactionClient,
  'userAccount'
>;

export interface AccessControlStore {
  loadSnapshot(
    userId: string,
    departmentId: string,
    reader?: AccessControlSnapshotReader,
  ): Promise<AccessControlSnapshot | null>;
}

@Injectable()
export class AccessControlService {
  constructor(
    @Inject(ACCESS_CONTROL_STORE)
    private readonly store: AccessControlStore,
  ) {}

  async authorizeCustomer(
    actor: ActorContext,
    action: CustomerAction,
    facts: CustomerResourceFacts,
    reader?: AccessControlSnapshotReader,
  ): Promise<void> {
    if (facts.departmentId !== actor.departmentId) {
      throw this.forbidden();
    }

    const snapshot = await this.loadCurrentSnapshot(actor, reader);
    const allowed = snapshot.grants.some(
      (grant) =>
        grant.action === action && this.scopeCovers(grant, actor, facts),
    );
    if (!allowed) {
      throw this.forbidden();
    }
  }

  async authorizeNewCustomer(
    actor: ActorContext,
    reader?: AccessControlSnapshotReader,
  ): Promise<CustomerResourceFacts> {
    const snapshot = await this.loadCurrentSnapshot(actor, reader);
    const facts: CustomerResourceFacts = {
      departmentId: actor.departmentId,
      responsibleUserId: actor.userId,
      ...(snapshot.membershipTeamId === undefined ||
      snapshot.membershipTeamActive === false
        ? {}
        : { teamId: snapshot.membershipTeamId }),
    };
    const allowed = snapshot.grants.some(
      (grant) =>
        grant.action === 'customer.create-draft' &&
        this.scopeCovers(grant, actor, facts),
    );
    if (!allowed) throw this.forbidden();
    return facts;
  }

  async canAuthorizeNewCustomer(
    actor: ActorContext,
    reader?: AccessControlSnapshotReader,
  ): Promise<boolean> {
    try {
      await this.authorizeNewCustomer(actor, reader);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  async canAuthorizeCustomer(
    actor: ActorContext,
    action: CustomerAction,
    facts: CustomerResourceFacts,
    reader?: AccessControlSnapshotReader,
  ): Promise<boolean> {
    try {
      await this.authorizeCustomer(actor, action, facts, reader);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        return false;
      }
      throw error;
    }
  }

  async buildCustomerScope(
    actor: ActorContext,
    action: CustomerAction,
    reader?: AccessControlSnapshotReader,
  ): Promise<CustomerScopePredicate> {
    const snapshot = await this.loadCurrentSnapshot(actor, reader);
    const grants = snapshot.grants.filter((grant) => grant.action === action);

    if (grants.some((grant) => grant.scope === 'department')) {
      return { departmentId: actor.departmentId };
    }

    const teamIds = [
      ...new Set(
        grants
          .filter(
            (grant): grant is typeof grant & { teamId: string } =>
              grant.scope === 'team' && typeof grant.teamId === 'string',
          )
          .map((grant) => grant.teamId),
      ),
    ];
    const hasSelf = grants.some((grant) => grant.scope === 'self');

    if (teamIds.length > 0 && hasSelf) {
      return {
        departmentId: actor.departmentId,
        OR: [{ responsibleUserId: actor.userId }, { teamId: { in: teamIds } }],
      };
    }
    if (teamIds.length > 0) {
      return {
        departmentId: actor.departmentId,
        teamId: { in: teamIds },
      };
    }
    if (hasSelf) {
      return {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      };
    }

    throw this.forbidden();
  }

  async tryBuildCustomerScope(
    actor: ActorContext,
    action: CustomerAction,
    reader?: AccessControlSnapshotReader,
  ): Promise<CustomerScopePredicate | null> {
    try {
      return await this.buildCustomerScope(actor, action, reader);
    } catch (error) {
      if (error instanceof ForbiddenException) return null;
      throw error;
    }
  }

  async authorizeLead(
    actor: ActorContext,
    action: LeadAction,
    facts: LeadResourceFacts,
    reader?: AccessControlSnapshotReader,
  ): Promise<void> {
    if (facts.departmentId !== actor.departmentId) {
      throw this.leadForbidden();
    }

    const snapshot = await this.loadCurrentSnapshot(actor, reader);
    const allowed = snapshot.grants.some(
      (grant) =>
        grant.action === action && this.scopeCovers(grant, actor, facts),
    );
    if (!allowed) {
      throw this.leadForbidden();
    }
  }

  async buildLeadScope(
    actor: ActorContext,
    action: LeadAction,
    reader?: AccessControlSnapshotReader,
  ): Promise<LeadScopePredicate> {
    const snapshot = await this.loadCurrentSnapshot(actor, reader);
    const grants = snapshot.grants.filter((grant) => grant.action === action);

    if (grants.some((grant) => grant.scope === 'department')) {
      return { departmentId: actor.departmentId };
    }

    const teamIds = [
      ...new Set(
        grants
          .filter(
            (grant): grant is typeof grant & { teamId: string } =>
              grant.scope === 'team' && typeof grant.teamId === 'string',
          )
          .map((grant) => grant.teamId),
      ),
    ];
    const hasSelf = grants.some((grant) => grant.scope === 'self');

    if (teamIds.length > 0 && hasSelf) {
      return {
        departmentId: actor.departmentId,
        OR: [{ responsibleUserId: actor.userId }, { teamId: { in: teamIds } }],
      };
    }
    if (teamIds.length > 0) {
      return {
        departmentId: actor.departmentId,
        teamId: { in: teamIds },
      };
    }
    if (hasSelf) {
      return {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
      };
    }

    throw this.leadForbidden();
  }

  async canAuthorizeNewLead(
    actor: ActorContext,
    reader?: AccessControlSnapshotReader,
  ): Promise<boolean> {
    try {
      const snapshot = await this.loadCurrentSnapshot(actor, reader);
      const facts: LeadResourceFacts = {
        departmentId: actor.departmentId,
        responsibleUserId: actor.userId,
        ...(snapshot.membershipTeamId === undefined ||
        snapshot.membershipTeamActive === false
          ? {}
          : { teamId: snapshot.membershipTeamId }),
      };
      return snapshot.grants.some(
        (grant) =>
          grant.action === 'lead.create' &&
          this.scopeCovers(grant, actor, facts),
      );
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
    }
  }

  private async loadCurrentSnapshot(
    actor: ActorContext,
    reader?: AccessControlSnapshotReader,
  ): Promise<AccessControlSnapshot> {
    const snapshot = await this.store.loadSnapshot(
      actor.userId,
      actor.departmentId,
      reader,
    );
    if (
      snapshot === null ||
      !snapshot.active ||
      snapshot.authorizationRevision !== actor.authorizationRevision
    ) {
      throw this.forbidden();
    }
    return snapshot;
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'CUSTOMER_ACTION_FORBIDDEN',
      message: '无权执行此客户操作',
    });
  }

  private leadForbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'LEAD_ACTION_FORBIDDEN',
      message: '无权执行此线索操作',
    });
  }

  private scopeCovers(
    grant: AccessControlSnapshot['grants'][number],
    actor: ActorContext,
    facts: CustomerResourceFacts | LeadResourceFacts,
  ): boolean {
    if (grant.scope === 'department') {
      return true;
    }
    if (grant.scope === 'team') {
      return typeof grant.teamId === 'string' && grant.teamId === facts.teamId;
    }
    return facts.responsibleUserId === actor.userId;
  }
}
