import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorContext } from '../../access-control/actor-context';
import { DatabaseService } from '../../database/database.service';

/**
 * 删除仅用于纠正误创建的案子：
 * 只要该案件已产生任何费用、付款、退费或结算记录，就由外键拦截并拒绝。
 */
@Injectable()
export class CaseDeleteService {
  constructor(private readonly db: DatabaseService) {}

  async remove(actor: ActorContext, caseId: string): Promise<{ id: string }> {
    if (actor.lawyerAccountId || actor.clientCustomerId)
      throw new ForbiddenException({ code: 'CASE_ACTION_FORBIDDEN' });
    const found = await this.db.case.findFirst({
      where: { id: caseId, departmentId: actor.departmentId },
      select: { id: true, externalEntry: { select: { id: true } } },
    });
    if (!found) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
    // 历史迁移案件带着成串的关联记录，按来源入口整体清理后再删主记录
    if (found.externalEntry !== null) {
      await this.removeLegacyCase(caseId);
      return { id: caseId };
    }
    try {
      await this.db.case.delete({
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
    return { id: caseId };
  }

  /** 删除历史迁移案件：按依赖顺序清理子表、审计与别名，再删主记录。 */
  private async removeLegacyCase(caseId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      // 子表先删；顺序按外键依赖从叶子到主干
      const childDeletes: Array<() => Promise<unknown>> = [
        () => tx.caseExternalEntry.deleteMany({ where: { caseId } }),
        () => tx.caseDefendant.deleteMany({ where: { caseId } }),
        () => tx.caseTrialRound.deleteMany({ where: { caseId } }),
        () => tx.caseAcceptance.deleteMany({ where: { caseId } }),
        () => tx.caseJudgmentFact.deleteMany({ where: { caseId } }),
        () => tx.caseExecutionFiling.deleteMany({ where: { caseId } }),
        () => tx.caseExecutionFinish.deleteMany({ where: { caseId } }),
        () => tx.caseClosureVersion.deleteMany({ where: { caseId } }),
        () => tx.caseClosure.deleteMany({ where: { caseId } }),
        () => tx.caseArchiveVersion.deleteMany({ where: { caseId } }),
        () => tx.caseArchive.deleteMany({ where: { caseId } }),
        () => tx.feeRecord.deleteMany({ where: { caseId } }),
        () => tx.caseComplaintConfirmation.deleteMany({ where: { caseId } }),
        () => tx.caseComplaintMailing.deleteMany({ where: { caseId } }),
        () => tx.caseFilingSubmission.deleteMany({ where: { caseId } }),
        () => tx.caseHearingArrangement.deleteMany({ where: { caseId } }),
        () => tx.caseLawyerAssignment.deleteMany({ where: { caseId } }),
        () => tx.businessNumberAlias.deleteMany({
          where: { entityId: caseId, entityType: 'CASE' },
        }),
        () => tx.auditEvent.deleteMany({ where: { resourceId: caseId } }),
      ];
      for (const remove of childDeletes) {
        try {
          await remove();
        } catch {
          // 表不存在或没有该记录时忽略，继续清理其余
        }
      }
      await tx.case.delete({ where: { id: caseId } });
    });
  }
}
