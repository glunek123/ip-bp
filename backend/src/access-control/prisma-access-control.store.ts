import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  AccessControlSnapshot,
  AccessControlSnapshotReader,
  AccessControlStore,
  PermissionAction,
  PermissionScope,
} from './access-control.service';
import {
  PermissionAction as PrismaPermissionAction,
  PermissionScope as PrismaPermissionScope,
} from '../generated/prisma/enums';

const actionMap = {
  CUSTOMER_READ: 'customer.read',
  CUSTOMER_CREATE_DRAFT: 'customer.create-draft',
  CUSTOMER_EDIT_ROUTINE: 'customer.edit-routine',
  CUSTOMER_ADMIT: 'customer.admit',
  LEAD_READ: 'lead.read',
  LEAD_CREATE: 'lead.create',
  LEAD_EDIT: 'lead.edit',
  LEAD_PUSH: 'lead.push',
  LEAD_WITHDRAW_APPLY: 'lead.withdraw.apply',
  LEAD_EVIDENCE_DECIDE: 'lead.evidence.decide',
  NOTARY_EVIDENCE_RECORD: 'notary.evidence.record',
  NOTARY_UNBOX_RECORD: 'notary.unbox.record',
  NOTARY_OPENING_REVIEW: 'notary.opening.review',
  NOTARY_ISSUANCE_DECIDE: 'notary.issuance.decide',
  NOTARY_RETURN_ARCHIVE: 'notary.return.archive',
  NOTARY_LIST_EXPORT: 'notary.list.export',
  CASE_READ: 'case.read',
  CASE_MATCH: 'case.match',
  CASE_COMPLAINT_SUBMIT: 'case.complaint.submit',
  CASE_COMPLAINT_CONFIRM: 'case.complaint.confirm',
  CASE_COMPLAINT_MAIL: 'case.complaint.mail',
  CASE_FILING_SUBMIT: 'case.filing.submit',
  CASE_ACCEPTANCE_REGISTER: 'case.acceptance.register',
  CLIENT_CASE_READ: 'client.case.read',
  CLIENT_CASE_COMPLAINT_MAIL: 'client.case.complaint.mail',
  NOTARY_OFFICE_MANAGE: 'notary.office.manage',
  CLIENT_LEAD_READ: 'client.lead.read',
  CLIENT_LEAD_REVIEW: 'client.lead.review',
  CLIENT_LEAD_WITHDRAW_CONFIRM: 'client.lead.withdraw.confirm',
  USER_READ: 'user.read',
  USER_MANAGE: 'user.manage',
  LAWYER_ACCOUNT_MANAGE: 'lawyer.account.manage',
  TEAM_READ: 'team.read',
  TEAM_MANAGE: 'team.manage',
  ROLE_READ: 'role.read',
  ROLE_ASSIGN: 'role.assign',
  ROLE_MANAGE: 'role.manage',
} as const satisfies Record<PrismaPermissionAction, PermissionAction>;

const scopeMap = {
  SELF: 'self',
  TEAM: 'team',
  DEPARTMENT: 'department',
} as const satisfies Record<PrismaPermissionScope, PermissionScope>;

@Injectable()
export class PrismaAccessControlStore implements AccessControlStore {
  constructor(private readonly database: DatabaseService) {}

  async loadSnapshot(
    userId: string,
    departmentId: string,
    reader?: AccessControlSnapshotReader,
  ): Promise<AccessControlSnapshot | null> {
    const user = await (reader ?? this.database).userAccount.findUnique({
      where: { id: userId },
      select: {
        active: true,
        accountType: true,
        authorizationRevision: true,
        memberships: {
          where: { departmentId, active: true },
          select: {
            id: true,
            teamId: true,
            team: { select: { status: true } },
          },
        },
        roleAssignments: {
          where: { departmentId, active: true },
          select: {
            teamId: true,
            roleTemplate: {
              select: {
                active: true,
                grants: { select: { action: true, scope: true } },
              },
            },
          },
        },
      },
    });

    if (
      user === null ||
      user.accountType !== 'INTERNAL' ||
      user.memberships.length === 0
    ) {
      return null;
    }

    return {
      active: user.active,
      authorizationRevision: user.authorizationRevision,
      ...(user.memberships[0]?.teamId === null ||
      user.memberships[0]?.teamId === undefined
        ? {}
        : {
            membershipTeamId: user.memberships[0].teamId,
            membershipTeamActive: user.memberships[0].team?.status === 'ACTIVE',
          }),
      grants: user.roleAssignments.flatMap((assignment) =>
        assignment.roleTemplate.active
          ? assignment.roleTemplate.grants.map((grant) => ({
              action: actionMap[grant.action],
              scope: scopeMap[grant.scope],
              ...(assignment.teamId === null
                ? {}
                : { teamId: assignment.teamId }),
            }))
          : [],
      ),
    };
  }
}
