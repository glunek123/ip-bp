import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { ActorContext } from './actor-context';

export const ACCESS_CONTROL_STORE = Symbol('ACCESS_CONTROL_STORE');

export type PermissionAction =
  | 'evidence.read'
  | 'evidence.edit'
  | 'evidence.bulk-status'
  | 'evidence.export'
  | 'settlement.read'
  | 'settlement.terms.update'
  | 'settlement.launch'
  | 'settlement.bill.create'
  | 'settlement.bill.cancel'
  | 'fee.read'
  | 'fee.create'
  | 'fee.update'
  | 'fee.launch'
  | 'fee.delete'
  | 'customer.read'
  | 'customer.create-draft'
  | 'customer.edit-routine'
  | 'customer.delete-draft'
  | 'customer.restore-draft'
  | 'customer.responsible.transfer'
  | 'customer.cooperation.pause'
  | 'customer.cooperation.terminate'
  | 'customer.cooperation.resume'
  | 'customer.right-asset.withdraw'
  | 'customer.agreement.read'
  | 'customer.agreement.edit'
  | 'customer.invoice.read'
  | 'customer.invoice.edit'
  | 'customer.settlement.read'
  | 'customer.settlement.register'
  | 'customer.settlement.correct'
  | 'customer.admit'
  | 'customer.account.create'
  | 'lead.read'
  | 'lead.create'
  | 'lead.edit'
  | 'lead.push'
  | 'lead.withdraw.apply'
  | 'lead.evidence.decide'
  | 'lead.review.proxy'
  | 'lead.withdraw.confirm.proxy'
  | 'notary.evidence.record'
  | 'notary.record.correct'
  | 'notary.unbox.record'
  | 'notary.opening.review'
  | 'notary.issuance.decide'
  | 'notary.certificate.issue.proxy'
  | 'notary.return.archive'
  | 'notary.list.export'
  | 'case.read'
  | 'case.export'
  | 'report.amount.read'
  | 'report.export'
  | 'case.group.create'
  | 'case.group.dissolve'
  | 'case.external-entry.create'
  | 'case.external-entry.archive'
  | 'case.match'
  | 'case.complaint.submit'
  | 'case.complaint.confirm'
  | 'case.complaint.mail'
  | 'case.filing.submit'
  | 'case.acceptance.register'
  | 'case.acceptance.correct'
  | 'case.defendant-contact.update'
  | 'case.hearing.schedule'
  | 'case.hearing.correct'
  | 'case.judgment.register'
  | 'case.refund.application.record'
  | 'case.judgment.correct'
  | 'case.judgment.next_step'
  | 'case.judgment.next_step.revoke'
  | 'case.second_instance.save'
  | 'case.second_instance.result'
  | 'case.second_instance.result.revoke'
  | 'case.second-instance-acceptance.update'
  | 'case.execution.submit'
  | 'case.execution.confirm'
  | 'case.execution.mail'
  | 'case.execution.filing.submit'
  | 'case.execution.feedback.record'
  | 'case.execution.feedback.correct'
  | 'case.execution.supplement.submit'
  | 'case.execution.supplement.correct'
  | 'case.closure.record'
  | 'case.closure.correct'
  | 'case.archive'
  | 'case.archive.correct'
  | 'case.execution.mailing.correct'
  | 'case.execution.filing.correct'
  | 'case.execution.finish.correct'
  | 'case.execution.finish'
  | 'client.case.read'
  | 'client.case.complaint.mail'
  | 'client.case.execution.mail'
  | 'notary.office.manage'
  | 'client.lead.read'
  | 'client.lead.review'
  | 'client.lead.withdraw.confirm'
  | 'user.read'
  | 'user.manage'
  | 'lawyer.account.manage'
  | 'team.read'
  | 'team.manage'
  | 'role.read'
  | 'role.assign'
  | 'role.manage';
export type CustomerAction = Extract<PermissionAction, `customer.${string}`>;
export type PermissionScope = 'self' | 'team' | 'department';
export type ReportView = 'mine' | 'department';
export type ReportAccessViews = {
  views: ReportView[];
  exportViews: ReportView[];
};
export type ReportReadScope = {
  view: ReportView;
  availableViews: ReportView[];
  where: { departmentId: string; responsibleUserId?: string };
};
export type CustomerScope = PermissionScope;
export type LeadAction =
  | Extract<PermissionAction, `lead.${string}`>
  | 'notary.evidence.record'
  | 'notary.record.correct'
  | 'notary.unbox.record'
  | 'notary.opening.review'
  | 'notary.issuance.decide'
  | 'notary.certificate.issue.proxy'
  | 'notary.return.archive'
  | 'notary.list.export'
  | 'case.read'
  | 'case.group.create'
  | 'case.group.dissolve';

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

export type CaseResourceFacts = LeadResourceFacts;

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

  async authorizeDepartmentAction(
    actor: ActorContext,
    action: PermissionAction,
    reader?: AccessControlSnapshotReader,
  ): Promise<void> {
    const snapshot = await this.loadCurrentSnapshot(actor, reader);
    if (
      !snapshot.grants.some(
        (grant) => grant.action === action && grant.scope === 'department',
      )
    )
      throw this.forbidden();
  }

  async reportAccessViews(
    actor: ActorContext,
    reader?: AccessControlSnapshotReader,
  ): Promise<ReportAccessViews> {
    const denied = () =>
      new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权读取此范围的报表',
      });
    if (
      actor.clientCustomerId !== undefined ||
      actor.lawyerAccountId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw denied();
    let snapshot: AccessControlSnapshot;
    try {
      snapshot = await this.loadCurrentSnapshot(actor, reader);
    } catch (error) {
      if (error instanceof ForbiddenException) throw denied();
      throw error;
    }
    if (
      !snapshot.grants.some(
        (grant) => grant.action === 'case.read' && grant.scope === 'department',
      )
    )
      throw denied();
    const covers = (
      action: 'report.amount.read' | 'report.export',
      view: ReportView,
    ) =>
      snapshot.grants.some(
        (grant) =>
          grant.action === action &&
          (grant.scope === 'department' ||
            (grant.scope === 'self' && view === 'mine')),
      );
    const views = (['mine', 'department'] as const).filter((view) =>
      covers('report.amount.read', view),
    );
    return {
      views,
      exportViews: views.filter((view) => covers('report.export', view)),
    };
  }

  // Both page and future export must use this same intersection. Export never
  // broadens the readable/money cohort, even when a different role grants it.
  async buildReportScope(
    actor: ActorContext,
    requestedView: ReportView | undefined,
    operation: 'read' | 'export' = 'read',
    reader?: AccessControlSnapshotReader,
  ): Promise<ReportReadScope> {
    const access = await this.reportAccessViews(actor, reader);
    const view =
      requestedView ??
      (access.views.includes('department') ? 'department' : access.views[0]);
    if (
      view === undefined ||
      !(operation === 'export' ? access.exportViews : access.views).includes(
        view,
      )
    )
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '无权读取此范围的报表',
      });
    return {
      view,
      availableViews: access.views,
      where: {
        departmentId: actor.departmentId,
        ...(view === 'mine' ? { responsibleUserId: actor.userId } : {}),
      },
    };
  }

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

  async authorizeCase(
    actor: ActorContext,
    action:
      | 'case.group.create'
      | 'case.group.dissolve'
      | 'case.match'
      | 'case.complaint.submit'
      | 'case.complaint.confirm'
      | 'case.complaint.mail'
      | 'case.filing.submit'
      | 'case.acceptance.register'
      | 'case.acceptance.correct'
      | 'case.defendant-contact.update'
      | 'case.hearing.schedule'
      | 'case.hearing.correct'
      | 'case.judgment.register'
      | 'case.refund.application.record'
      | 'case.judgment.correct'
      | 'case.judgment.next_step'
      | 'case.judgment.next_step.revoke'
      | 'case.second_instance.save'
      | 'case.second_instance.result'
      | 'case.second_instance.result.revoke'
      | 'case.second-instance-acceptance.update'
      | 'case.execution.submit'
      | 'case.execution.confirm'
      | 'case.execution.mail'
      | 'case.execution.filing.submit'
      | 'case.execution.feedback.record'
      | 'case.execution.feedback.correct'
      | 'case.execution.supplement.submit'
      | 'case.execution.supplement.correct'
      | 'case.closure.record'
      | 'case.closure.correct'
      | 'case.archive'
      | 'case.archive.correct'
      | 'case.external-entry.create'
      | 'case.external-entry.archive'
      | 'case.execution.mailing.correct'
      | 'case.execution.filing.correct'
      | 'case.execution.finish.correct'
      | 'case.execution.finish',
    facts: CaseResourceFacts,
    reader?: AccessControlSnapshotReader,
  ): Promise<void> {
    if (facts.departmentId !== actor.departmentId) throw this.caseForbidden();
    const snapshot = await this.loadCurrentSnapshot(actor, reader);
    if (
      !snapshot.grants.some(
        (grant) =>
          grant.action === action && this.scopeCovers(grant, actor, facts),
      )
    )
      throw this.caseForbidden();
  }

  async canAuthorizeCase(
    actor: ActorContext,
    action:
      | 'case.group.create'
      | 'case.group.dissolve'
      | 'case.match'
      | 'case.complaint.submit'
      | 'case.complaint.confirm'
      | 'case.complaint.mail'
      | 'case.filing.submit'
      | 'case.acceptance.register'
      | 'case.acceptance.correct'
      | 'case.defendant-contact.update'
      | 'case.hearing.schedule'
      | 'case.hearing.correct'
      | 'case.judgment.register'
      | 'case.refund.application.record'
      | 'case.judgment.correct'
      | 'case.judgment.next_step'
      | 'case.judgment.next_step.revoke'
      | 'case.second_instance.save'
      | 'case.second_instance.result'
      | 'case.second_instance.result.revoke'
      | 'case.second-instance-acceptance.update'
      | 'case.execution.submit'
      | 'case.execution.confirm'
      | 'case.execution.mail'
      | 'case.execution.filing.submit'
      | 'case.execution.feedback.record'
      | 'case.execution.feedback.correct'
      | 'case.execution.supplement.submit'
      | 'case.execution.supplement.correct'
      | 'case.closure.record'
      | 'case.closure.correct'
      | 'case.archive'
      | 'case.archive.correct'
      | 'case.external-entry.create'
      | 'case.external-entry.archive'
      | 'case.execution.mailing.correct'
      | 'case.execution.filing.correct'
      | 'case.execution.finish.correct'
      | 'case.execution.finish',
    facts: CaseResourceFacts,
    reader?: AccessControlSnapshotReader,
  ): Promise<boolean> {
    try {
      await this.authorizeCase(actor, action, facts, reader);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) return false;
      throw error;
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

  private caseForbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'CASE_ACTION_FORBIDDEN',
      message: '无权执行此案件操作',
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
