import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ActorContext } from './actor-context';

export const ACCESS_CONTROL_STORE = Symbol('ACCESS_CONTROL_STORE');

export type CustomerAction = 'customer.read' | 'customer.create-draft';
export type CustomerScope = 'self' | 'team' | 'department';

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

export type AccessControlSnapshot = {
  active: boolean;
  authorizationRevision: number;
  grants: Array<{
    action: CustomerAction;
    scope: CustomerScope;
    teamId?: string;
  }>;
};

export interface AccessControlStore {
  loadSnapshot(
    userId: string,
    departmentId: string,
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
  ): Promise<void> {
    if (facts.departmentId !== actor.departmentId) {
      throw new ForbiddenException('CUSTOMER_ACCESS_DENIED');
    }

    const snapshot = await this.loadCurrentSnapshot(actor);
    const allowed = snapshot.grants.some(
      (grant) =>
        grant.action === action && this.scopeCovers(grant, actor, facts),
    );
    if (!allowed) {
      throw new ForbiddenException('CUSTOMER_ACCESS_DENIED');
    }
  }

  async buildCustomerScope(
    actor: ActorContext,
    action: CustomerAction,
  ): Promise<CustomerScopePredicate> {
    const snapshot = await this.loadCurrentSnapshot(actor);
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

    throw new ForbiddenException('CUSTOMER_ACCESS_DENIED');
  }

  private async loadCurrentSnapshot(
    actor: ActorContext,
  ): Promise<AccessControlSnapshot> {
    const snapshot = await this.store.loadSnapshot(
      actor.userId,
      actor.departmentId,
    );
    if (
      snapshot === null ||
      !snapshot.active ||
      snapshot.authorizationRevision !== actor.authorizationRevision
    ) {
      throw new ForbiddenException('CUSTOMER_ACCESS_DENIED');
    }
    return snapshot;
  }

  private scopeCovers(
    grant: AccessControlSnapshot['grants'][number],
    actor: ActorContext,
    facts: CustomerResourceFacts,
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
