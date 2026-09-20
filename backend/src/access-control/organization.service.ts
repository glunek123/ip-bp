import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { prepareLocalCredential } from '../auth/password';
import { DatabaseService } from '../database/database.service';
import { Prisma } from '../generated/prisma/client';
import { PermissionAction, PermissionScope } from '../generated/prisma/enums';
import { ActorContext } from './actor-context';

type AssignRoleCommand = {
  targetUserId: string;
  roleTemplateId: string;
  teamId: string | null;
};

type CreateUserCommand = {
  displayName: string;
  username: string;
  password: string;
  teamId: string | null;
  roleTemplateId: string;
};

type EffectiveGrant = {
  action: PermissionAction;
  scope: PermissionScope;
  teamId: string | null;
};

type RoleGrant = { action: PermissionAction; scope: PermissionScope };

export type ManagementContext = {
  capabilities: {
    createUser: boolean;
    manageUsers: boolean;
    createTeam: boolean;
    manageTeams: boolean;
    assignDepartmentRoles: boolean;
    assignTeamRoles: boolean;
  };
  users: Array<{
    id: string;
    displayName: string;
    username: string;
    accountActive: boolean;
    membership: {
      id: string;
      active: boolean;
      teamId: string | null;
    };
    assignments: Array<{
      id: string;
      roleTemplateId: string;
      roleName: string;
      teamId: string | null;
      active: boolean;
      version: number;
    }>;
  }>;
  teams: Array<{
    id: string;
    name: string;
    status: 'ACTIVE' | 'INACTIVE';
  }>;
  roles: Array<{
    id: string;
    name: string;
    grants: RoleGrant[];
  }>;
};

@Injectable()
export class OrganizationService {
  constructor(private readonly database: DatabaseService) {}

  async getManagementContext(actor: ActorContext): Promise<ManagementContext> {
    return this.database.$transaction(async (transaction) => {
      const grants = await this.loadCurrentActorGrants(transaction, actor);
      const hasDepartmentGrant = (action: PermissionAction) =>
        grants.some(
          (grant) => grant.action === action && grant.scope === 'DEPARTMENT',
        );
      const teamGrant = (action: PermissionAction) =>
        grants.find(
          (grant) =>
            grant.action === action &&
            grant.scope === 'TEAM' &&
            grant.teamId !== null,
        );
      const hasSelfGrant = (action: PermissionAction) =>
        grants.some(
          (grant) => grant.action === action && grant.scope === 'SELF',
        );

      const userReadTeamId = teamGrant('USER_READ')?.teamId ?? null;
      const teamReadTeamId = teamGrant('TEAM_READ')?.teamId ?? null;
      const userWhere = hasDepartmentGrant('USER_READ')
        ? { departmentId: actor.departmentId }
        : userReadTeamId !== null
          ? {
              departmentId: actor.departmentId,
              teamId: userReadTeamId,
              team: { status: 'ACTIVE' as const },
            }
          : hasSelfGrant('USER_READ')
            ? { departmentId: actor.departmentId, userId: actor.userId }
            : null;
      const teamWhere = hasDepartmentGrant('TEAM_READ')
        ? { departmentId: actor.departmentId }
        : teamReadTeamId !== null
          ? {
              departmentId: actor.departmentId,
              id: teamReadTeamId,
              status: 'ACTIVE' as const,
            }
          : null;
      const canReadRoles = grants.some((grant) => grant.action === 'ROLE_READ');

      const [memberships, teams, roles] = await Promise.all([
        userWhere === null
          ? Promise.resolve([])
          : transaction.departmentMembership.findMany({
              where: userWhere,
              select: {
                id: true,
                active: true,
                teamId: true,
                user: {
                  select: {
                    id: true,
                    displayName: true,
                    active: true,
                    localCredential: { select: { username: true } },
                    roleAssignments: {
                      where: { departmentId: actor.departmentId },
                      select: {
                        id: true,
                        roleTemplateId: true,
                        teamId: true,
                        active: true,
                        version: true,
                        roleTemplate: { select: { name: true } },
                      },
                      orderBy: { createdAt: 'asc' },
                    },
                  },
                },
              },
              orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
            }),
        teamWhere === null
          ? Promise.resolve([])
          : transaction.team.findMany({
              where: teamWhere,
              select: { id: true, name: true, status: true },
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
            }),
        canReadRoles
          ? transaction.roleTemplate.findMany({
              where: { departmentId: actor.departmentId, active: true },
              select: {
                id: true,
                name: true,
                active: true,
                grants: { select: { action: true, scope: true } },
              },
              orderBy: [{ name: 'asc' }, { id: 'asc' }],
            })
          : Promise.resolve([]),
      ]);

      const roleAssignmentTeamId = teamGrant('ROLE_ASSIGN')?.teamId ?? null;
      const rolesActorCanAssign = roles.filter(
        (role) =>
          this.coversManagementTarget(
            grants,
            'ROLE_ASSIGN',
            actor.userId,
            '__management-target__',
            roleAssignmentTeamId,
          ) &&
          role.grants.every((roleGrant) =>
            grants.some((actorGrant) =>
              this.coversAssignedGrant(
                actorGrant,
                roleGrant,
                actor.userId,
                '__management-target__',
                roleAssignmentTeamId,
              ),
            ),
          ),
      );

      const canManageUsers = hasDepartmentGrant('USER_MANAGE');
      const canAssignDepartmentRoles = hasDepartmentGrant('ROLE_ASSIGN');
      const canAssignTeamRoles = teamGrant('ROLE_ASSIGN') !== undefined;
      const canManageTeams = hasDepartmentGrant('TEAM_MANAGE');

      return {
        capabilities: {
          createUser: canManageUsers && canAssignDepartmentRoles,
          manageUsers: canManageUsers,
          createTeam: canManageTeams,
          manageTeams: canManageTeams,
          assignDepartmentRoles: canAssignDepartmentRoles,
          assignTeamRoles: canAssignTeamRoles,
        },
        users: memberships.flatMap((membership) => {
          if (membership.user.localCredential === null) return [];
          return [
            {
              id: membership.user.id,
              displayName: membership.user.displayName,
              username: membership.user.localCredential.username,
              accountActive: membership.user.active,
              membership: {
                id: membership.id,
                active: membership.active,
                teamId: membership.teamId,
              },
              assignments: membership.user.roleAssignments.map(
                (assignment) => ({
                  id: assignment.id,
                  roleTemplateId: assignment.roleTemplateId,
                  roleName: assignment.roleTemplate.name,
                  teamId: assignment.teamId,
                  active: assignment.active,
                  version: assignment.version,
                }),
              ),
            },
          ];
        }),
        teams,
        roles: rolesActorCanAssign.map((role) => ({
          id: role.id,
          name: role.name,
          grants: role.grants,
        })),
      };
    });
  }

  async createUser(actor: ActorContext, command: CreateUserCommand) {
    const displayName = command.displayName.trim();
    if (displayName.length === 0 || Array.from(displayName).length > 100) {
      throw new BadRequestException({
        code: 'DISPLAY_NAME_INVALID',
        message: '姓名不能为空且不得超过100个字符',
      });
    }
    let credential: ReturnType<typeof prepareLocalCredential>;
    try {
      credential = prepareLocalCredential(command.username, command.password);
    } catch (error) {
      const code =
        error instanceof Error && error.message === 'USERNAME_INVALID'
          ? 'USERNAME_INVALID'
          : 'PASSWORD_INVALID';
      throw new BadRequestException({
        code,
        message:
          code === 'USERNAME_INVALID'
            ? '用户名格式不正确'
            : '密码长度必须为12至128个字符',
      });
    }
    let passwordHash: string;
    try {
      passwordHash = await credential.passwordHash;
    } catch (error) {
      if (error instanceof Error && error.message === 'PASSWORD_INVALID') {
        throw new BadRequestException({
          code: 'PASSWORD_INVALID',
          message: '密码长度必须为12至128个字符',
        });
      }
      throw error;
    }

    try {
      return await this.database.$transaction(
        async (transaction) => {
          await this.lockDepartment(transaction, actor.departmentId);
          const actorGrants = await this.loadCurrentActorGrants(
            transaction,
            actor,
          );
          if (
            !actorGrants.some(
              (grant) =>
                grant.action === 'USER_MANAGE' && grant.scope === 'DEPARTMENT',
            )
          ) {
            throw this.forbidden();
          }

          const user = await transaction.userAccount.create({
            data: {
              externalSubject: `local:${randomUUID()}`,
              displayName,
            },
            select: { id: true, displayName: true, active: true },
          });
          await transaction.localCredential.create({
            data: {
              userId: user.id,
              username: credential.username,
              passwordHash,
            },
          });
          const membership = await transaction.departmentMembership.create({
            data: {
              userId: user.id,
              departmentId: actor.departmentId,
              teamId: command.teamId,
            },
            select: { id: true, active: true, teamId: true },
          });
          const assignment = await this.assignRoleInTransaction(
            transaction,
            actor,
            {
              targetUserId: user.id,
              roleTemplateId: command.roleTemplateId,
              teamId: command.teamId,
            },
            actorGrants,
          );
          await transaction.auditEvent.create({
            data: {
              departmentId: actor.departmentId,
              actorUserId: actor.userId,
              resourceType: 'user-account',
              resourceId: user.id,
              action: 'user.created',
              details: {
                membershipId: membership.id,
                roleAssignmentId: assignment.id,
                teamId: membership.teamId,
              },
            },
          });
          return {
            id: user.id,
            displayName: user.displayName,
            username: credential.username,
            accountActive: user.active,
            membership,
            assignment,
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
          code: 'USERNAME_ALREADY_EXISTS',
          message: '用户名已存在',
        });
      }
      throw error;
    }
  }

  async createTeam(actor: ActorContext, input: { name: string }) {
    const name = input.name.trim();
    if (name.length === 0 || Array.from(name).length > 100) {
      throw new BadRequestException({
        code: 'TEAM_NAME_INVALID',
        message: '团队名称不能为空且不得超过100个字符',
      });
    }
    return this.database.$transaction(
      async (transaction) => {
        await this.lockDepartment(transaction, actor.departmentId);
        const grants = await this.loadCurrentActorGrants(transaction, actor);
        if (
          !grants.some(
            (grant) =>
              grant.action === 'TEAM_MANAGE' && grant.scope === 'DEPARTMENT',
          )
        ) {
          throw this.forbidden();
        }
        const team = await transaction.team.create({
          data: { departmentId: actor.departmentId, name },
          select: {
            id: true,
            departmentId: true,
            name: true,
            status: true,
          },
        });
        await transaction.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            resourceType: 'team',
            resourceId: team.id,
            action: 'team.created',
            details: { name },
          },
        });
        return team;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async setTeamStatus(
    actor: ActorContext,
    teamId: string,
    status: 'ACTIVE' | 'INACTIVE',
  ) {
    return this.database.$transaction(
      async (transaction) => {
        await this.lockDepartment(transaction, actor.departmentId);
        const grants = await this.loadCurrentActorGrants(transaction, actor);
        await this.lockTeam(transaction, actor.departmentId, teamId, 'UPDATE');
        const team = await transaction.team.findUnique({
          where: {
            id_departmentId: { id: teamId, departmentId: actor.departmentId },
          },
          select: { id: true, departmentId: true, name: true, status: true },
        });
        if (
          team === null ||
          !grants.some(
            (grant) =>
              grant.action === 'TEAM_MANAGE' && grant.scope === 'DEPARTMENT',
          )
        ) {
          throw this.forbidden();
        }
        if (team.status === status) return team;
        const updated = await transaction.team.update({
          where: { id: team.id },
          data: { status },
          select: {
            id: true,
            departmentId: true,
            name: true,
            status: true,
          },
        });
        await transaction.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            resourceType: 'team',
            resourceId: team.id,
            action: 'team.status-changed',
            details: { from: team.status, to: status },
          },
        });
        return updated;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async changeMembershipTeam(
    actor: ActorContext,
    command: { targetUserId: string; teamId: string | null },
  ) {
    if (command.targetUserId === actor.userId) throw this.forbidden();
    return this.database.$transaction(
      async (transaction) => {
        await this.lockDepartment(transaction, actor.departmentId);
        const grants = await this.loadCurrentActorGrants(transaction, actor);
        if (
          !grants.some(
            (grant) =>
              grant.action === 'USER_MANAGE' && grant.scope === 'DEPARTMENT',
          )
        ) {
          throw this.forbidden();
        }
        await this.lockMembership(
          transaction,
          actor.departmentId,
          command.targetUserId,
        );
        const membership = await transaction.departmentMembership.findUnique({
          where: {
            userId_departmentId: {
              userId: command.targetUserId,
              departmentId: actor.departmentId,
            },
          },
          select: {
            id: true,
            active: true,
            departmentId: true,
            teamId: true,
            team: { select: { status: true } },
          },
        });
        if (membership === null || !membership.active) throw this.forbidden();
        if (membership.teamId === command.teamId) return membership;

        if (command.teamId !== null) {
          await this.lockTeam(
            transaction,
            actor.departmentId,
            command.teamId,
            'SHARE',
          );
          const team = await transaction.team.findUnique({
            where: {
              id_departmentId: {
                id: command.teamId,
                departmentId: actor.departmentId,
              },
            },
            select: { id: true, departmentId: true, status: true },
          });
          if (team === null || team.status !== 'ACTIVE') {
            throw this.forbidden();
          }
        }
        const activeTeamAssignment = await transaction.roleAssignment.findFirst(
          {
            where: {
              userId: command.targetUserId,
              departmentId: actor.departmentId,
              active: true,
              teamId: { not: null },
            },
            select: { id: true },
          },
        );
        if (activeTeamAssignment !== null) {
          throw new ConflictException({
            code: 'ACTIVE_TEAM_ROLE_ASSIGNMENT_EXISTS',
            message: '请先停用成员现有的团队范围角色分配',
          });
        }
        const updated = await transaction.departmentMembership.update({
          where: { id: membership.id },
          data: { teamId: command.teamId },
          select: { id: true, departmentId: true, teamId: true, active: true },
        });
        await transaction.auditEvent.create({
          data: {
            departmentId: actor.departmentId,
            actorUserId: actor.userId,
            resourceType: 'department-membership',
            resourceId: membership.id,
            action: 'department-membership.team-changed',
            details: {
              fromTeamId: membership.teamId,
              toTeamId: command.teamId,
            },
          },
        });
        await transaction.userAccount.update({
          where: { id: command.targetUserId },
          data: { authorizationRevision: { increment: 1 } },
        });
        return updated;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async assignRole(actor: ActorContext, command: AssignRoleCommand) {
    if (command.targetUserId === actor.userId) throw this.forbidden();

    return this.database.$transaction(
      async (transaction) => {
        await this.lockDepartment(transaction, actor.departmentId);
        const actorGrants = await this.loadCurrentActorGrants(
          transaction,
          actor,
        );
        return this.assignRoleInTransaction(
          transaction,
          actor,
          command,
          actorGrants,
        );
      },
      { isolationLevel: 'Serializable' },
    );
  }

  private async assignRoleInTransaction(
    transaction: Prisma.TransactionClient,
    actor: ActorContext,
    command: AssignRoleCommand,
    actorGrants: EffectiveGrant[],
  ) {
    if (command.targetUserId === actor.userId) throw this.forbidden();
    await this.lockMembership(
      transaction,
      actor.departmentId,
      command.targetUserId,
    );
    const targetMembership = await transaction.departmentMembership.findUnique({
      where: {
        userId_departmentId: {
          userId: command.targetUserId,
          departmentId: actor.departmentId,
        },
      },
      select: {
        id: true,
        active: true,
        departmentId: true,
        teamId: true,
        team: { select: { status: true } },
      },
    });
    if (targetMembership === null || !targetMembership.active) {
      throw this.forbidden();
    }
    if (
      !this.coversManagementTarget(
        actorGrants,
        'ROLE_ASSIGN',
        actor.userId,
        command.targetUserId,
        targetMembership.team?.status === 'ACTIVE'
          ? targetMembership.teamId
          : null,
      )
    ) {
      throw this.forbidden();
    }

    await this.lockRoleTemplate(
      transaction,
      actor.departmentId,
      command.roleTemplateId,
    );
    const role = await transaction.roleTemplate.findUnique({
      where: {
        id_departmentId: {
          id: command.roleTemplateId,
          departmentId: actor.departmentId,
        },
      },
      select: {
        id: true,
        departmentId: true,
        active: true,
        grants: { select: { action: true, scope: true } },
      },
    });
    if (role === null || !role.active) throw this.forbidden();

    if (command.teamId !== null) {
      await this.lockTeam(
        transaction,
        actor.departmentId,
        command.teamId,
        'SHARE',
      );
      const team = await transaction.team.findUnique({
        where: {
          id_departmentId: {
            id: command.teamId,
            departmentId: actor.departmentId,
          },
        },
        select: { id: true, departmentId: true, status: true },
      });
      if (
        team === null ||
        team.status !== 'ACTIVE' ||
        targetMembership.teamId !== team.id ||
        targetMembership.team?.status !== 'ACTIVE'
      ) {
        throw this.forbidden();
      }
    }
    if (
      role.grants.some(
        (grant) => grant.scope === 'TEAM' && command.teamId === null,
      )
    ) {
      throw new BadRequestException({
        code: 'ROLE_ASSIGNMENT_TEAM_REQUIRED',
        message: '团队范围角色必须绑定有效团队',
      });
    }

    for (const grant of role.grants) {
      if (
        !actorGrants.some((actorGrant) =>
          this.coversAssignedGrant(
            actorGrant,
            grant,
            actor.userId,
            command.targetUserId,
            command.teamId,
          ),
        )
      ) {
        throw this.forbidden();
      }
    }

    await this.lockRoleAssignments(
      transaction,
      actor.departmentId,
      command.targetUserId,
    );
    const existingAssignments = await transaction.roleAssignment.findMany({
      where: {
        userId: command.targetUserId,
        departmentId: actor.departmentId,
        roleTemplateId: command.roleTemplateId,
      },
      select: { id: true, active: true, teamId: true, version: true },
      take: 2,
    });
    if (existingAssignments.length > 1) {
      throw new ConflictException({
        code: 'ROLE_ASSIGNMENT_AMBIGUOUS',
        message: '存在多个历史角色分配，需先人工收口',
      });
    }
    const existing = existingAssignments[0];
    if (
      existing !== undefined &&
      existing.active &&
      existing.teamId === command.teamId
    ) {
      throw new ConflictException({
        code: 'ROLE_ASSIGNMENT_ALREADY_ACTIVE',
        message: '该角色分配已生效',
      });
    }

    const assignment =
      existing === undefined
        ? await transaction.roleAssignment.create({
            data: {
              userId: command.targetUserId,
              departmentId: actor.departmentId,
              roleTemplateId: command.roleTemplateId,
              teamId: command.teamId,
            },
            select: { id: true, active: true, teamId: true, version: true },
          })
        : await transaction.roleAssignment.update({
            where: { id: existing.id },
            data: {
              active: true,
              teamId: command.teamId,
              version: { increment: 1 },
            },
            select: { id: true, active: true, teamId: true, version: true },
          });

    await transaction.auditEvent.create({
      data: {
        departmentId: actor.departmentId,
        actorUserId: actor.userId,
        resourceType: 'role-assignment',
        resourceId: assignment.id,
        action:
          existing === undefined
            ? 'role-assignment.created'
            : 'role-assignment.restored-or-rebound',
        details: {
          targetUserId: command.targetUserId,
          roleTemplateId: command.roleTemplateId,
          teamId: command.teamId,
        },
      },
    });
    await transaction.userAccount.update({
      where: { id: command.targetUserId },
      data: { authorizationRevision: { increment: 1 } },
    });
    return assignment;
  }

  private async loadCurrentActorGrants(
    transaction: Prisma.TransactionClient,
    actor: ActorContext,
  ): Promise<EffectiveGrant[]> {
    await this.lockActorAuthorization(transaction, actor);
    const account = await transaction.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, authorizationRevision: true },
    });
    const membership = await transaction.departmentMembership.findUnique({
      where: {
        userId_departmentId: {
          userId: actor.userId,
          departmentId: actor.departmentId,
        },
      },
      select: {
        active: true,
        departmentId: true,
        teamId: true,
        team: { select: { status: true } },
      },
    });
    const assignments = await transaction.roleAssignment.findMany({
      where: {
        userId: actor.userId,
        departmentId: actor.departmentId,
        active: true,
      },
      select: {
        teamId: true,
        roleTemplate: {
          select: {
            active: true,
            grants: { select: { action: true, scope: true } },
          },
        },
      },
    });
    if (
      account === null ||
      !account.active ||
      account.authorizationRevision !== actor.authorizationRevision ||
      membership === null ||
      !membership.active
    ) {
      throw this.forbidden();
    }
    return assignments.flatMap((assignment) =>
      assignment.roleTemplate.active
        ? assignment.roleTemplate.grants.flatMap((grant) =>
            grant.scope !== 'TEAM' ||
            (membership.teamId !== null &&
              membership.team?.status === 'ACTIVE' &&
              assignment.teamId === membership.teamId)
              ? [
                  {
                    action: grant.action,
                    scope: grant.scope,
                    teamId: assignment.teamId,
                  },
                ]
              : [],
          )
        : [],
    );
  }

  private async lockActorAuthorization(
    transaction: Prisma.TransactionClient,
    actor: ActorContext,
  ): Promise<void> {
    await transaction.$queryRawUnsafe(
      'SELECT "id" FROM "user_accounts" WHERE "id" = $1::uuid FOR UPDATE',
      actor.userId,
    );
    await this.lockMembership(transaction, actor.departmentId, actor.userId);
    await this.lockRoleAssignments(
      transaction,
      actor.departmentId,
      actor.userId,
    );
    await transaction.$queryRawUnsafe(
      `SELECT "grant"."id"
       FROM "role_grants" AS "grant"
       JOIN "role_templates" AS "role"
         ON "role"."id" = "grant"."role_template_id"
       JOIN "role_assignments" AS "assignment"
         ON "assignment"."role_template_id" = "role"."id"
        AND "assignment"."department_id" = "role"."department_id"
       WHERE "assignment"."user_id" = $1::uuid
         AND "assignment"."department_id" = $2::uuid
         AND "assignment"."active" = true
       FOR SHARE OF "grant", "role"`,
      actor.userId,
      actor.departmentId,
    );
  }

  private async lockMembership(
    transaction: Prisma.TransactionClient,
    departmentId: string,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRawUnsafe(
      `SELECT "id" FROM "department_memberships"
       WHERE "user_id" = $1::uuid AND "department_id" = $2::uuid
       FOR UPDATE`,
      userId,
      departmentId,
    );
  }

  private async lockRoleAssignments(
    transaction: Prisma.TransactionClient,
    departmentId: string,
    userId: string,
  ): Promise<void> {
    await transaction.$queryRawUnsafe(
      `SELECT "assignment"."id"
       FROM "role_assignments" AS "assignment"
       JOIN "role_templates" AS "role"
         ON "role"."id" = "assignment"."role_template_id"
        AND "role"."department_id" = "assignment"."department_id"
       WHERE "assignment"."user_id" = $1::uuid
         AND "assignment"."department_id" = $2::uuid
       FOR UPDATE OF "assignment", "role"`,
      userId,
      departmentId,
    );
  }

  private async lockRoleTemplate(
    transaction: Prisma.TransactionClient,
    departmentId: string,
    roleTemplateId: string,
  ): Promise<void> {
    await transaction.$queryRawUnsafe(
      `SELECT "id" FROM "role_templates"
       WHERE "id" = $1::uuid AND "department_id" = $2::uuid
       FOR SHARE`,
      roleTemplateId,
      departmentId,
    );
    await transaction.$queryRawUnsafe(
      `SELECT "id" FROM "role_grants"
       WHERE "role_template_id" = $1::uuid
       FOR SHARE`,
      roleTemplateId,
    );
  }

  private async lockTeam(
    transaction: Prisma.TransactionClient,
    departmentId: string,
    teamId: string,
    mode: 'SHARE' | 'UPDATE',
  ): Promise<void> {
    await transaction.$queryRawUnsafe(
      `SELECT "id" FROM "teams"
       WHERE "id" = $1::uuid AND "department_id" = $2::uuid
       FOR ${mode}`,
      teamId,
      departmentId,
    );
  }

  private async lockDepartment(
    transaction: Prisma.TransactionClient,
    departmentId: string,
  ): Promise<void> {
    await transaction.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      `organization:${departmentId}`,
    );
  }

  private coversManagementTarget(
    grants: EffectiveGrant[],
    action: PermissionAction,
    actorUserId: string,
    targetUserId: string,
    targetTeamId: string | null,
  ): boolean {
    return grants.some((grant) => {
      if (grant.action !== action) return false;
      if (grant.scope === 'DEPARTMENT') return true;
      if (grant.scope === 'TEAM') {
        return grant.teamId !== null && grant.teamId === targetTeamId;
      }
      return targetUserId === actorUserId;
    });
  }

  private coversAssignedGrant(
    actorGrant: EffectiveGrant,
    targetGrant: RoleGrant,
    actorUserId: string,
    targetUserId: string,
    targetTeamId: string | null,
  ): boolean {
    if (actorGrant.action !== targetGrant.action) return false;
    if (actorGrant.scope === 'DEPARTMENT') return true;
    if (actorGrant.scope === 'TEAM') {
      return (
        targetGrant.scope === 'TEAM' &&
        actorGrant.teamId !== null &&
        actorGrant.teamId === targetTeamId
      );
    }
    return targetGrant.scope === 'SELF' && actorUserId === targetUserId;
  }

  private forbidden(): ForbiddenException {
    return new ForbiddenException({
      code: 'MANAGEMENT_ACTION_FORBIDDEN',
      message: '无权执行此管理操作',
    });
  }
}
