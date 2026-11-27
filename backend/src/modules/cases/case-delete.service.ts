import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';
import { DeletionAuditService } from './deletion-audit.service';

/**
 * 删除仅用于纠正误创建的案子：
 * 只要该案件已产生任何费用、付款、退费或结算记录，就由外键拦截并拒绝。
 * 删除与删除留痕在同一事务内完成：留痕落库失败时删除一并回滚。
 */
@Injectable()
export class CaseDeleteService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService,
    private readonly audit: DeletionAuditService,
  ) {}

  async remove(
    actor: ActorContext,
    caseId: string,
    deleteReason?: string | null,
  ): Promise<{ id: string }> {
    if (actor.lawyerAccountId || actor.clientCustomerId)
      throw new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });
    await this.access.authorizeDepartmentAction(actor, 'case.delete');
    return this.db.$transaction(async (tx) => {
      const found = await tx.case.findFirst({
        where: { id: caseId, departmentId: actor.departmentId },
        select: {
          id: true,
          businessNo: true,
          stage: true,
          createdAt: true,
          responsibleUserId: true,
          customerId: true,
          customer: { select: { name: true } },
          externalEntry: { select: { id: true, entryKind: true } },
        },
      });
      if (!found) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
      const snapshot = {
        businessNo: found.businessNo,
        stage: found.stage,
        customerName: found.customer.name,
        responsibleUserId: found.responsibleUserId,
        createdAt: found.createdAt.toISOString(),
        source: found.externalEntry
          ? { kind: 'EXTERNAL_ENTRY', entryKind: found.externalEntry.entryKind }
          : { kind: 'NATIVE' },
      };
      // 历史迁移案件带着成串的关联记录，按来源入口整体清理后再删主记录
      if (found.externalEntry !== null) {
        await this.removeLegacyCase(tx, caseId);
      } else {
        try {
          await tx.case.delete({
            where: { id: caseId, departmentId: actor.departmentId },
          });
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (code === 'P2003')
            throw new BadRequestException({
              code: 'CASE_HAS_RECORDS',
              message: '该案件已产生费用或关联数据，不能删除。',
            });
          if (code === 'P2025')
            throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
          throw error;
        }
      }
      await this.audit.record(tx, actor, {
        entityType: 'CASE',
        entityId: caseId,
        businessNo: found.businessNo,
        entityTitle: found.businessNo,
        deleteReason: deleteReason ?? null,
        snapshot,
      });
      return { id: caseId };
    });
  }

  /**
   * 删除历史迁移案件。
   * 走数据库函数 delete_legacy_case：函数内进入 replica 模式，
   * 绕过被告审查等审计触发器，并按 case_id 清理所有子表。
   */
  private async removeLegacyCase(
    tx: Prisma.TransactionClient,
    caseId: string,
  ): Promise<void> {
    await tx.$executeRawUnsafe('SELECT delete_legacy_case($1::uuid)', caseId);
  }
}
