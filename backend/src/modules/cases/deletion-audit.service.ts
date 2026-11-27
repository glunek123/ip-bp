import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';

export type DeletionAuditEntityType = 'CASE' | 'LEAD' | 'NOTARY_MATTER' | 'CUSTOMER';

export type DeletionAuditRecord = {
  entityType: DeletionAuditEntityType;
  entityId: string;
  businessNo?: string | null;
  entityTitle?: string | null;
  deleteReason?: string | null;
  snapshot: Prisma.InputJsonValue;
};

export type DeletionAuditListItem = {
  id: string;
  entityType: string;
  entityId: string;
  businessNo: string | null;
  entityTitle: string | null;
  actorUserId: string;
  actorUsername: string;
  actorDisplayName: string;
  actorRoles: string[];
  deleteReason: string | null;
  snapshot: Prisma.JsonValue;
  deletedAt: string;
};

export type DeletionAuditListQuery = {
  entityType?: DeletionAuditEntityType;
  page?: number;
  pageSize?: number;
};

/**
 * 删除留痕：与业务删除在同一事务内落库，记录操作人账号、姓名、所属角色、
 * 删除时间与被删数据摘要。留痕只追加，不随业务记录一起删除。
 */
@Injectable()
export class DeletionAuditService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService,
  ) {}

  async record(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    record: DeletionAuditRecord,
  ): Promise<void> {
    const identity = await this.actorIdentity(tx, actor);
    await tx.deletionAuditLog.create({
      data: {
        departmentId: actor.departmentId,
        entityType: record.entityType,
        entityId: record.entityId,
        businessNo: record.businessNo ?? null,
        entityTitle: record.entityTitle ?? null,
        actorUserId: actor.userId,
        actorUsername: identity.username,
        actorDisplayName: identity.displayName,
        actorRoles: identity.roles,
        deleteReason: record.deleteReason ?? null,
        snapshot: record.snapshot,
      },
    });
  }

  async list(
    actor: ActorContext,
    query: DeletionAuditListQuery,
  ): Promise<{ items: DeletionAuditListItem[]; total: number }> {
    await this.access.authorizeDepartmentAction(actor, 'deletion.audit.read');
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(query.pageSize ?? 20)));
    const where: Prisma.DeletionAuditLogWhereInput = {
      departmentId: actor.departmentId,
      ...(query.entityType ? { entityType: query.entityType } : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.deletionAuditLog.count({ where }),
      this.db.deletionAuditLog.findMany({
        where,
        orderBy: { deletedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        businessNo: row.businessNo,
        entityTitle: row.entityTitle,
        actorUserId: row.actorUserId,
        actorUsername: row.actorUsername,
        actorDisplayName: row.actorDisplayName,
        actorRoles: row.actorRoles,
        deleteReason: row.deleteReason,
        snapshot: row.snapshot,
        deletedAt: row.deletedAt.toISOString(),
      })),
    };
  }

  /** 操作人身份：登录名、显示名与当前部门下的角色名称。 */
  private async actorIdentity(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
  ): Promise<{ username: string; displayName: string; roles: string[] }> {
    const account = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: {
        displayName: true,
        localCredential: { select: { username: true } },
      },
    });
    if (!account) throw new Error('删除留痕缺少操作人账号');
    const assignments = await tx.roleAssignment.findMany({
      where: {
        userId: actor.userId,
        departmentId: actor.departmentId,
        active: true,
      },
      select: { roleTemplate: { select: { name: true } } },
    });
    const roles = [
      ...new Set(assignments.map((item) => item.roleTemplate.name)),
    ].sort();
    return {
      username: account.localCredential?.username ?? account.displayName,
      displayName: account.displayName,
      roles,
    };
  }
}
