import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  AccessControlSnapshot,
  AccessControlStore,
  CustomerAction,
  CustomerScope,
} from './access-control.service';

const actionMap = {
  CUSTOMER_READ: 'customer.read',
  CUSTOMER_CREATE_DRAFT: 'customer.create-draft',
  CUSTOMER_EDIT_ROUTINE: 'customer.edit-routine',
} as const satisfies Record<string, CustomerAction>;

const scopeMap = {
  SELF: 'self',
  TEAM: 'team',
  DEPARTMENT: 'department',
} as const satisfies Record<string, CustomerScope>;

@Injectable()
export class PrismaAccessControlStore implements AccessControlStore {
  constructor(private readonly database: DatabaseService) {}

  async loadSnapshot(
    userId: string,
    departmentId: string,
  ): Promise<AccessControlSnapshot | null> {
    const user = await this.database.userAccount.findUnique({
      where: { id: userId },
      select: {
        active: true,
        authorizationRevision: true,
        memberships: {
          where: { departmentId, active: true },
          select: { id: true, teamId: true },
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

    if (user === null || user.memberships.length === 0) {
      return null;
    }

    return {
      active: user.active,
      authorizationRevision: user.authorizationRevision,
      ...(user.memberships[0]?.teamId === null ||
      user.memberships[0]?.teamId === undefined
        ? {}
        : { membershipTeamId: user.memberships[0].teamId }),
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
