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

  /** 删除历史迁移案件：逐表清理（每条独立提交，个别失败不阻断），最后删主记录。 */
  private async removeLegacyCase(caseId: string): Promise<void> {
    const deletes: Array<() => Promise<unknown>> = [
      () => this.db.caseClosureVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseClosure.deleteMany({ where: { caseId } }),
      () => this.db.caseArchiveVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseArchive.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFinish.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFiling.deleteMany({ where: { caseId } }),
      () => this.db.caseAcceptance.deleteMany({ where: { caseId } }),
      () => this.db.caseJudgmentFact.deleteMany({ where: { caseId } }),
      () => this.db.caseHearingArrangement.deleteMany({ where: { caseId } }),
      () => this.db.caseSecondInstanceProgress.deleteMany({ where: { caseId } }),
      () => this.db.caseSecondInstanceResult.deleteMany({ where: { caseId } }),
      () => this.db.caseTrialRound.deleteMany({ where: { caseId } }),
      () => this.db.caseComplaintConfirmation.deleteMany({ where: { caseId } }),
      () => this.db.caseComplaintMailing.deleteMany({ where: { caseId } }),
      () => this.db.caseFilingSubmission.deleteMany({ where: { caseId } }),
      () => this.db.caseLawyerAssignment.deleteMany({ where: { caseId } }),
      () => this.db.feeRecord.deleteMany({ where: { caseId } }),
      () => this.db.caseDefendant.deleteMany({ where: { caseId } }),
      () => this.db.caseExternalEntry.deleteMany({ where: { caseId } }),
      () =>
        this.db.businessNumberAlias.deleteMany({
          where: { entityId: caseId, entityType: 'CASE' },
        }),
      () => this.db.auditEvent.deleteMany({ where: { resourceId: caseId } }),
    ];
    for (const remove of deletes) {
      try {
        await remove();
      } catch {
        // 该表无记录或暂不可删，继续处理其余表
      }
    }
    await this.db.case.delete({ where: { id: caseId } });
  }
}
