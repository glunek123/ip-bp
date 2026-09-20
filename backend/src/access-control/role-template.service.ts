import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PermissionAction, PermissionScope } from '../generated/prisma/enums';
import { ActorContext } from './actor-context';
import { OrganizationService } from './organization.service';

export type RoleTemplateImpact = {
  roleTemplateId: string;
  version: number;
  activeAssignmentCount: number;
  affectedUsers: Array<{ id: string; displayName: string }>;
};

export type RoleGrantInput = {
  action: PermissionAction;
  scope: PermissionScope;
};

export type CopyRoleTemplateInput = {
  sourceRoleTemplateId: string;
  name: string;
  grants: RoleGrantInput[];
};

export type UpdateRoleTemplateInput = {
  name: string;
  grants: RoleGrantInput[];
  expectedVersion: number;
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

  async copy(actor: ActorContext, input: CopyRoleTemplateInput) {
    const name = input.name.trim();
    if (name.length === 0 || Array.from(name).length > 100) {
      throw new BadRequestException({
        code: 'ROLE_TEMPLATE_NAME_INVALID',
        message: '角色模板名称不能为空且不得超过100个字符',
      });
    }
    const grants = this.normalizeGrants(input.grants);

    try {
      return await this.database.$transaction(
        async (transaction) => {
          await this.organization.lockDepartment(
            transaction,
            actor.departmentId,
          );
          const actorGrants = await this.organization.loadCurrentActorGrants(
            transaction,
            actor,
          );
          if (
            !actorGrants.some(
              (grant) =>
                grant.action === 'ROLE_MANAGE' && grant.scope === 'DEPARTMENT',
            )
          ) {
            throw this.forbidden();
          }
          for (const grant of grants) {
            if (
              !actorGrants.some(
                (actorGrant) =>
                  actorGrant.action === grant.action &&
                  actorGrant.scope === 'DEPARTMENT',
              )
            ) {
              throw new ForbiddenException({
                code: 'ROLE_TEMPLATE_GRANT_NOT_COVERED',
                message: '不能配置超出本人部门权限的授权',
              });
            }
          }

          await this.organization.lockRoleTemplate(
            transaction,
            actor.departmentId,
            input.sourceRoleTemplateId,
            'SHARE',
          );
          const source = await transaction.roleTemplate.findFirst({
            where: {
              id: input.sourceRoleTemplateId,
              departmentId: actor.departmentId,
              active: true,
            },
            select: { id: true },
          });
          if (source === null) {
            throw new ForbiddenException({
              code: 'ROLE_TEMPLATE_SOURCE_UNAVAILABLE',
              message: '来源角色模板不可用',
            });
          }

          const role = await transaction.roleTemplate.create({
            data: { departmentId: actor.departmentId, name },
            select: { id: true, name: true, version: true },
          });
          await transaction.roleGrant.createMany({
            data: grants.map((grant) => ({
              roleTemplateId: role.id,
              ...grant,
            })),
          });
          await transaction.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              resourceType: 'role-template',
              resourceId: role.id,
              action: 'role-template.created',
              details: {
                sourceRoleTemplateId: source.id,
                version: role.version,
                grants,
              },
            },
          });

          return {
            ...role,
            activeAssignmentCount: 0,
            grants,
          };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'ROLE_TEMPLATE_NAME_ALREADY_EXISTS',
          message: '角色模板名称已存在',
        });
      }
      throw error;
    }
  }

  async update(
    actor: ActorContext,
    roleTemplateId: string,
    input: UpdateRoleTemplateInput,
  ) {
    const name = input.name.trim();
    if (name.length === 0 || Array.from(name).length > 100) {
      throw new BadRequestException({
        code: 'ROLE_TEMPLATE_NAME_INVALID',
        message: '角色模板名称不能为空且不得超过100个字符',
      });
    }
    const grants = this.normalizeGrants(input.grants);

    try {
      return await this.database.$transaction(
        async (transaction) => {
          await this.organization.lockDepartment(
            transaction,
            actor.departmentId,
          );
          const actorGrants = await this.organization.loadCurrentActorGrants(
            transaction,
            actor,
          );
          if (
            !actorGrants.some(
              (grant) =>
                grant.action === 'ROLE_MANAGE' && grant.scope === 'DEPARTMENT',
            )
          ) {
            throw this.forbidden();
          }
          for (const grant of grants) {
            if (
              !actorGrants.some(
                (actorGrant) =>
                  actorGrant.action === grant.action &&
                  actorGrant.scope === 'DEPARTMENT',
              )
            ) {
              throw new ForbiddenException({
                code: 'ROLE_TEMPLATE_GRANT_NOT_COVERED',
                message: '不能配置超出本人部门权限的授权',
              });
            }
          }

          await this.organization.lockRoleTemplate(
            transaction,
            actor.departmentId,
            roleTemplateId,
            'UPDATE',
          );
          const role = await transaction.roleTemplate.findFirst({
            where: {
              id: roleTemplateId,
              departmentId: actor.departmentId,
              active: true,
            },
            select: {
              id: true,
              departmentId: true,
              name: true,
              version: true,
              grants: { select: { action: true, scope: true } },
            },
          });
          if (role === null) throw this.forbidden();
          if (role.version !== input.expectedVersion) {
            throw new ConflictException({
              code: 'ROLE_TEMPLATE_VERSION_CONFLICT',
              message: '角色模板已被他人修改，请刷新后重试',
            });
          }

          await this.organization.lockRoleTemplateAssignmentsAndUsers(
            transaction,
            actor.departmentId,
            roleTemplateId,
          );
          const assignments = await transaction.roleAssignment.findMany({
            where: {
              roleTemplateId,
              departmentId: actor.departmentId,
              active: true,
            },
            select: { userId: true },
            orderBy: { userId: 'asc' },
          });
          const affectedUserIds = Array.from(
            new Set(assignments.map((assignment) => assignment.userId)),
          );

          await transaction.roleGrant.deleteMany({
            where: { roleTemplateId },
          });
          await transaction.roleGrant.createMany({
            data: grants.map((grant) => ({ roleTemplateId, ...grant })),
          });
          const updated = await transaction.roleTemplate.update({
            where: { id: roleTemplateId },
            data: { name, version: { increment: 1 } },
            select: { id: true, name: true, version: true },
          });
          if (affectedUserIds.length > 0) {
            await transaction.userAccount.updateMany({
              where: { id: { in: affectedUserIds } },
              data: { authorizationRevision: { increment: 1 } },
            });
          }
          await transaction.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              resourceType: 'role-template',
              resourceId: roleTemplateId,
              action: 'role-template.updated',
              details: {
                from: {
                  name: role.name,
                  version: role.version,
                  grants: this.sortGrants(role.grants),
                },
                to: {
                  name: updated.name,
                  version: updated.version,
                  grants,
                },
                affectedUserCount: affectedUserIds.length,
              },
            },
          });

          return {
            ...updated,
            activeAssignmentCount: affectedUserIds.length,
            grants,
          };
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'ROLE_TEMPLATE_NAME_ALREADY_EXISTS',
          message: '角色模板名称已存在',
        });
      }
      throw error;
    }
  }

  private normalizeGrants(grants: RoleGrantInput[]): RoleGrantInput[] {
    if (grants.length === 0) {
      throw new BadRequestException({
        code: 'ROLE_TEMPLATE_GRANTS_REQUIRED',
        message: '至少选择一项授权',
      });
    }
    const normalized = this.sortGrants(grants);
    const keys = normalized.map((grant) => `${grant.action}:${grant.scope}`);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException({
        code: 'ROLE_TEMPLATE_DUPLICATE_GRANT',
        message: '不能重复选择同一授权',
      });
    }
    return normalized;
  }

  private sortGrants(grants: RoleGrantInput[]): RoleGrantInput[] {
    return grants
      .map((grant) => ({ action: grant.action, scope: grant.scope }))
      .sort((left, right) =>
        `${left.action}:${left.scope}`.localeCompare(
          `${right.action}:${right.scope}`,
        ),
      );
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'MANAGEMENT_ACTION_FORBIDDEN',
      message: '无权执行此管理操作',
    });
  }
}
