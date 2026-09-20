import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ActorContext } from './actor-context';
import { OrganizationService } from './organization.service';

export type RoleTemplateImpact = {
  roleTemplateId: string;
  version: number;
  activeAssignmentCount: number;
  affectedUsers: Array<{ id: string; displayName: string }>;
};

@Injectable()
export class RoleTemplateService {
  constructor(
    private readonly database: DatabaseService,
    private readonly organization: OrganizationService,
  ) {}

  async getImpact(
    actor: ActorContext,
    roleTemplateId: string,
  ): Promise<RoleTemplateImpact> {
    return this.database.$transaction(async (transaction) => {
      const grants = await this.organization.loadCurrentActorGrants(
        transaction,
        actor,
      );
      if (
        !grants.some(
          (grant) =>
            grant.action === 'ROLE_MANAGE' && grant.scope === 'DEPARTMENT',
        )
      ) {
        throw this.forbidden();
      }

      const role = await transaction.roleTemplate.findFirst({
        where: {
          id: roleTemplateId,
          departmentId: actor.departmentId,
          active: true,
        },
        select: { id: true, departmentId: true, version: true },
      });
      if (role === null) throw this.forbidden();

      const assignments = await transaction.roleAssignment.findMany({
        where: {
          roleTemplateId,
          departmentId: actor.departmentId,
          active: true,
        },
        select: { userId: true, user: { select: { displayName: true } } },
        orderBy: [{ user: { displayName: 'asc' } }, { userId: 'asc' }],
      });
      const affectedUsers = Array.from(
        new Map(
          assignments.map((assignment) => [
            assignment.userId,
            { id: assignment.userId, displayName: assignment.user.displayName },
          ]),
        ).values(),
      );

      return {
        roleTemplateId: role.id,
        version: role.version,
        activeAssignmentCount: affectedUsers.length,
        affectedUsers,
      };
    });
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'MANAGEMENT_ACTION_FORBIDDEN',
      message: '无权执行此管理操作',
    });
  }
}
