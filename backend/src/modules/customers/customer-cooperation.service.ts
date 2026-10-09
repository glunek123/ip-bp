import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import {
  AccessControlService,
  type CustomerAction,
} from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { OrganizationService } from '../../access-control/organization.service';
import { DatabaseService } from '../../database/database.service';
import {
  CustomerCooperationDto,
  CustomerResponsibleTransferDto,
} from './customer-cooperation.dto';

export type CooperationAction = 'pause' | 'terminate' | 'resume';
export type CustomerMaintenanceResult = {
  customerId: string;
  action: CooperationAction | 'responsible-transfer';
  resultVersion: number;
  occurredAt: string;
  canReadAfter: boolean;
};
export type EligibleOperator = {
  id: string;
  displayName: string;
  teamName: string | null;
};

type MaintenanceAction = 'TRANSFER' | 'PAUSE' | 'TERMINATE' | 'RESUME';
type CooperationStatus = 'COOPERATING' | 'PAUSED' | 'TERMINATED';
type CustomerFacts = {
  id: string;
  departmentId: string;
  responsibleUserId: string;
  teamId: string | null;
  version: number;
  deletedAt: Date | null;
  cooperationStatus: CooperationStatus;
};

const actionPermissions: Record<MaintenanceAction, CustomerAction> = {
  TRANSFER: 'customer.responsible.transfer',
  PAUSE: 'customer.cooperation.pause',
  TERMINATE: 'customer.cooperation.terminate',
  RESUME: 'customer.cooperation.resume',
};
const publicActions: Record<
  MaintenanceAction,
  CustomerMaintenanceResult['action']
> = {
  TRANSFER: 'responsible-transfer',
  PAUSE: 'pause',
  TERMINATE: 'terminate',
  RESUME: 'resume',
};
const toStatuses: Record<
  Exclude<MaintenanceAction, 'TRANSFER'>,
  CooperationStatus
> = {
  PAUSE: 'PAUSED',
  TERMINATE: 'TERMINATED',
  RESUME: 'COOPERATING',
};
const maxAttempts = 6;

@Injectable()
export class CustomerCooperationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}

  async eligibleOperators(
    actor: ActorContext,
    customerId: string,
    page: number,
    pageSize: number,
  ): Promise<{
    items: EligibleOperator[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const customer = await this.visibleCustomer(
      this.database,
      actor,
      customerId,
      'customer.responsible.transfer',
    );
    const where = {
      id: { not: customer.responsibleUserId },
      active: true,
      accountType: 'INTERNAL' as const,
      memberships: {
        some: {
          departmentId: actor.departmentId,
          active: true,
          OR: [{ teamId: null }, { team: { status: 'ACTIVE' as const } }],
        },
      },
    };
    const [users, total] = await this.database.$transaction([
      this.database.userAccount.findMany({
        where,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          displayName: true,
          memberships: {
            where: { departmentId: actor.departmentId, active: true },
            select: { team: { select: { name: true } } },
            take: 1,
          },
        },
      }),
      this.database.userAccount.count({ where }),
    ]);
    return {
      items: users.map((user) => ({
        id: user.id,
        displayName: user.displayName,
        teamName: user.memberships[0]?.team?.name ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  transferResponsible(
    actor: ActorContext,
    customerId: string,
    key: string,
    input: CustomerResponsibleTransferDto,
  ): Promise<CustomerMaintenanceResult> {
    return this.command(actor, customerId, key, 'TRANSFER', input);
  }

  changeCooperation(
    actor: ActorContext,
    customerId: string,
    key: string,
    input: CustomerCooperationDto,
  ): Promise<CustomerMaintenanceResult> {
    const action = input.action.toUpperCase() as MaintenanceAction;
    return this.command(actor, customerId, key, action, input);
  }

  private async command(
    actor: ActorContext,
    customerId: string,
    key: string,
    action: MaintenanceAction,
    input: CustomerResponsibleTransferDto | CustomerCooperationDto,
  ): Promise<CustomerMaintenanceResult> {
    const reason = input.reason?.trim() ?? null;
    if (
      (action !== 'RESUME' && reason === null) ||
      (reason !== null && (reason.length < 1 || reason.length > 500))
    )
      throw this.invalid();
    const targetUserId = 'targetUserId' in input ? input.targetUserId : null;
    if (action === 'TRANSFER' && targetUserId === null) throw this.invalid();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          action,
          customerId,
          expectedVersion: input.expectedVersion,
          targetUserId,
          reason,
        }),
      )
      .digest('hex');

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            await this.organization.lockDepartment(tx, actor.departmentId);
            await this.lockAuthorizationFacts(
              tx,
              actor,
              action === 'TRANSFER' ? targetUserId : null,
            );
            // This preliminary authorization precedes the receipt lookup. The
            // customer row is checked again after it is locked below.
            await this.visibleCustomer(
              tx,
              actor,
              customerId,
              actionPermissions[action],
            );
            const prior = await tx.customerMaintenanceReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey: key,
                },
              },
              include: { fact: true },
            });
            if (prior === null && action === 'TRANSFER') {
              await this.assertEligibleTarget(
                tx,
                actor.departmentId,
                targetUserId!,
              );
            }
            const locked = await tx.$queryRaw<Array<{ id: string }>>`
              SELECT id FROM customers
              WHERE id = ${customerId}::uuid AND department_id = ${actor.departmentId}::uuid
              FOR UPDATE`;
            if (locked.length !== 1) throw this.notFound();
            const current = await this.visibleCustomer(
              tx,
              actor,
              customerId,
              actionPermissions[action],
            );
            if (prior !== null) {
              if (
                prior.action !== action ||
                prior.customerId !== customerId ||
                prior.requestFingerprint !== fingerprint
              )
                throw this.conflict(
                  'CUSTOMER_IDEMPOTENCY_CONFLICT',
                  '幂等键已用于不同请求',
                );
              return this.result(
                actor,
                tx,
                current,
                action,
                prior.fact.toVersion,
                prior.fact.occurredAt,
              );
            }
            if (current.version !== input.expectedVersion) {
              throw this.versionConflict();
            }
            if (
              action === 'TRANSFER' &&
              current.responsibleUserId === targetUserId
            ) {
              throw this.conflict(
                'CUSTOMER_RESPONSIBLE_CONFLICT',
                '目标已是当前负责运营',
              );
            }
            if (
              action !== 'TRANSFER' &&
              !this.allowedTransition(current.cooperationStatus, action)
            ) {
              throw this.conflict(
                'CUSTOMER_COOPERATION_STATE_CONFLICT',
                '当前合作状态不允许此操作',
              );
            }
            const nextStatus =
              action === 'TRANSFER'
                ? current.cooperationStatus
                : toStatuses[action];
            const changed = await tx.customer.updateMany({
              where: {
                id: customerId,
                departmentId: actor.departmentId,
                version: input.expectedVersion,
                deletedAt: null,
                ...(action === 'TRANSFER'
                  ? { responsibleUserId: current.responsibleUserId }
                  : { cooperationStatus: current.cooperationStatus }),
              },
              data: {
                ...(action === 'TRANSFER'
                  ? { responsibleUserId: targetUserId! }
                  : { cooperationStatus: nextStatus }),
                version: { increment: 1 },
              },
            });
            if (changed.count !== 1) throw this.versionConflict();
            const audit = await tx.auditEvent.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                resourceType: 'customer',
                resourceId: customerId,
                action:
                  action === 'TRANSFER'
                    ? 'customer.responsible-transferred'
                    : `customer.cooperation-${publicActions[action]}`,
                details: {
                  fromVersion: input.expectedVersion,
                  toVersion: input.expectedVersion + 1,
                  ...(action === 'TRANSFER'
                    ? {
                        fromResponsibleUserId: current.responsibleUserId,
                        toResponsibleUserId: targetUserId,
                      }
                    : {
                        fromStatus: current.cooperationStatus,
                        toStatus: nextStatus,
                      }),
                  reason,
                },
              },
            });
            const fact = await tx.customerMaintenanceFact.create({
              data: {
                customerId,
                departmentId: actor.departmentId,
                action,
                actorUserId: actor.userId,
                fromVersion: input.expectedVersion,
                toVersion: input.expectedVersion + 1,
                fromCooperationStatus:
                  action === 'TRANSFER' ? null : current.cooperationStatus,
                toCooperationStatus: action === 'TRANSFER' ? null : nextStatus,
                fromResponsibleUserId:
                  action === 'TRANSFER' ? current.responsibleUserId : null,
                toResponsibleUserId:
                  action === 'TRANSFER' ? targetUserId : null,
                reason,
                auditEventId: audit.id,
              },
            });
            await tx.customerMaintenanceReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey: key,
                requestFingerprint: fingerprint,
                action,
                customerId,
                factId: fact.id,
              },
            });
            return this.result(
              actor,
              tx,
              {
                ...current,
                responsibleUserId:
                  action === 'TRANSFER'
                    ? targetUserId!
                    : current.responsibleUserId,
                cooperationStatus: nextStatus,
              },
              action,
              fact.toVersion,
              fact.occurredAt,
            );
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (this.isRetryableLockConflict(error)) {
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 15));
            continue;
          }
          throw this.conflict(
            'CUSTOMER_MAINTENANCE_BUSY',
            '客户正在被维护，请稍后按原请求重试',
          );
        }
        if (this.isUniqueConflict(error)) {
          if (attempt < maxAttempts) continue;
          throw this.conflict(
            'CUSTOMER_IDEMPOTENCY_CONFLICT',
            '维护请求已被提交',
          );
        }
        throw error;
      }
    }
    throw this.versionConflict();
  }

  private async visibleCustomer(
    tx: Prisma.TransactionClient | DatabaseService,
    actor: ActorContext,
    customerId: string,
    action: CustomerAction,
  ): Promise<CustomerFacts> {
    try {
      const [read, write] = await Promise.all([
        this.access.buildCustomerScope(actor, 'customer.read', tx),
        this.access.buildCustomerScope(actor, action, tx),
      ]);
      const customer = await tx.customer.findFirst({
        where: {
          id: customerId,
          departmentId: actor.departmentId,
          deletedAt: null,
          AND: [read, write],
        },
      });
      if (customer === null) throw this.notFound();
      return customer;
    } catch (error) {
      if (error instanceof ForbiddenException) throw this.notFound();
      throw error;
    }
  }

  private async assertEligibleTarget(
    tx: Prisma.TransactionClient,
    departmentId: string,
    targetUserId: string,
  ): Promise<void> {
    const membership = await tx.departmentMembership.findUnique({
      where: { userId_departmentId: { userId: targetUserId, departmentId } },
      select: {
        active: true,
        teamId: true,
        team: { select: { status: true } },
        user: { select: { active: true, accountType: true } },
      },
    });
    if (
      membership === null ||
      !membership.active ||
      !membership.user.active ||
      membership.user.accountType !== 'INTERNAL' ||
      (membership.teamId !== null && membership.team?.status !== 'ACTIVE')
    )
      throw this.targetIneligible();
  }

  private async lockAuthorizationFacts(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    targetUserId: string | null,
  ): Promise<void> {
    // The department advisory lock serializes same-department organization
    // writes. NOWAIT also avoids cycles with another department that shares a
    // global account. FOR SHARE coexists with customer/audit FK KEY SHARE.
    const userIds = [
      ...new Set([
        actor.userId,
        ...(targetUserId === null ? [] : [targetUserId]),
      ]),
    ].sort();
    for (const userId of userIds) {
      await tx.$queryRaw`SELECT id FROM user_accounts
        WHERE id = ${userId}::uuid FOR SHARE NOWAIT`;
    }
    const teamIds = new Set<string>();
    for (const userId of userIds) {
      const memberships = await tx.$queryRaw<Array<{ team_id: string | null }>>`
        SELECT team_id FROM department_memberships
        WHERE user_id = ${userId}::uuid
          AND department_id = ${actor.departmentId}::uuid FOR SHARE NOWAIT`;
      if (memberships[0]?.team_id) teamIds.add(memberships[0].team_id);
    }
    const assignments = await tx.$queryRaw<
      Array<{ role_template_id: string; team_id: string | null }>
    >`
      SELECT role_template_id, team_id FROM role_assignments
      WHERE user_id = ${actor.userId}::uuid
        AND department_id = ${actor.departmentId}::uuid
      ORDER BY id FOR SHARE NOWAIT`;
    const roleIds = [
      ...new Set(
        assignments.map((row) => row.role_template_id).filter(Boolean),
      ),
    ].sort();
    for (const assignment of assignments) {
      if (assignment.team_id) teamIds.add(assignment.team_id);
    }
    for (const roleId of roleIds) {
      await tx.$queryRaw`SELECT id FROM role_templates
        WHERE id = ${roleId}::uuid FOR SHARE NOWAIT`;
      await tx.$queryRaw`SELECT id FROM role_grants
        WHERE role_template_id = ${roleId}::uuid ORDER BY id FOR SHARE NOWAIT`;
    }
    for (const teamId of [...teamIds].sort()) {
      await tx.$queryRaw`SELECT id FROM teams
        WHERE id = ${teamId}::uuid FOR SHARE NOWAIT`;
    }
  }

  private allowedTransition(
    current: CooperationStatus,
    action: MaintenanceAction,
  ): boolean {
    if (action === 'PAUSE') return current === 'COOPERATING';
    if (action === 'TERMINATE')
      return current === 'COOPERATING' || current === 'PAUSED';
    if (action === 'RESUME')
      return current === 'PAUSED' || current === 'TERMINATED';
    return true;
  }

  private async result(
    actor: ActorContext,
    tx: Prisma.TransactionClient,
    customer: CustomerFacts,
    action: MaintenanceAction,
    resultVersion: number,
    occurredAt: Date,
  ): Promise<CustomerMaintenanceResult> {
    const canReadAfter = await this.access.canAuthorizeCustomer(
      actor,
      'customer.read',
      {
        departmentId: customer.departmentId,
        responsibleUserId: customer.responsibleUserId,
        ...(customer.teamId === null ? {} : { teamId: customer.teamId }),
      },
      tx,
    );
    return {
      customerId: customer.id,
      action: publicActions[action],
      resultVersion,
      occurredAt: occurredAt.toISOString(),
      canReadAfter,
    };
  }

  private isRetryableLockConflict(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const value = error as { code?: unknown; cause?: unknown; meta?: unknown };
    if (value.code === 'P2034') return true;
    if (['55P03', '40001', '40P01'].includes(String(value.code))) return true;
    if (value.meta && typeof value.meta === 'object') {
      const meta = value.meta as {
        databaseErrorCode?: unknown;
        code?: unknown;
      };
      if (
        [meta.databaseErrorCode, meta.code].some((code) =>
          ['55P03', '40001', '40P01'].includes(String(code)),
        )
      )
        return true;
      const adapter = (value.meta as { driverAdapterError?: unknown })
        .driverAdapterError;
      const cause =
        adapter && typeof adapter === 'object'
          ? (adapter as { cause?: unknown }).cause
          : undefined;
      if (cause && typeof cause === 'object') {
        const details = cause as { originalCode?: unknown; sqlState?: unknown };
        if (
          [details.originalCode, details.sqlState].some((code) =>
            ['55P03', '40001', '40P01'].includes(String(code)),
          )
        )
          return true;
      }
    }
    return this.isRetryableLockConflict(value.cause);
  }

  private isUniqueConflict(error: unknown): boolean {
    if (error === null || typeof error !== 'object') return false;
    const value = error as { code?: unknown; cause?: unknown };
    return value.code === 'P2002' || this.isUniqueConflict(value.cause);
  }

  private invalid() {
    return new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '请求字段不符合接口要求',
    });
  }

  private notFound() {
    return new NotFoundException({
      code: 'CUSTOMER_NOT_FOUND',
      message: '客户不存在或不可访问',
    });
  }

  private targetIneligible() {
    return new NotFoundException({
      code: 'CUSTOMER_OPERATOR_NOT_ELIGIBLE',
      message: '目标负责运营不可用',
    });
  }

  private versionConflict() {
    return this.conflict(
      'CUSTOMER_VERSION_CONFLICT',
      '客户资料已被他人更新，请刷新后再提交',
    );
  }

  private conflict(code: string, message: string) {
    return new ConflictException({ code, message });
  }
}
