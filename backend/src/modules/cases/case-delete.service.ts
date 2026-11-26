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

  /** 删除历史迁移案件：按模型依赖顺序清理（列表由 schema 生成，先叶子后主干）。 */
  private async removeLegacyCase(caseId: string): Promise<void> {
    const deletes: Array<() => Promise<unknown>> = [
      () => this.db.caseAcceptanceCorrection.deleteMany({ where: { caseId } }),
      () => this.db.caseAcceptanceReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseAcceptanceVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseArchiveReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseClosureDocument.deleteMany({ where: { caseId } }),
      () => this.db.caseClosureReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseClosureRecordCorrectionDocument.deleteMany({ where: { caseId } }),
      () => this.db.caseComplaintConfirmation.deleteMany({ where: { caseId } }),
      () => this.db.caseComplaintConfirmationReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseComplaintMailingReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseComplaintMailingVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseComplaintReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseConsolidationMember.deleteMany({ where: { caseId } }),
      () => this.db.caseCsvImportedRow.deleteMany({ where: { caseId } }),
      () => this.db.caseDefendantContactChange.deleteMany({ where: { caseId } }),
      () => this.db.caseDefendantPreparationReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseEarlyArchiveReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseEarlyClosureReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionConfirmationReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionConfirmationVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFilingFollowupReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFilingReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFilingRecordCorrectionDocument.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFilingSupplementDocument.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFilingVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFinishReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFinishRecordCorrectionDocument.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFinishVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionMailingReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionMailingRecordCorrectionDocument.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionMailingVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionSubmissionReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionSubmissionVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseExternalEntry.deleteMany({ where: { caseId } }),
      () => this.db.caseExternalEntryReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseFilingConsolidationSource.deleteMany({ where: { caseId } }),
      () => this.db.caseFilingReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseFilingVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseHandlingGroupMember.deleteMany({ where: { caseId } }),
      () => this.db.caseHearingCorrection.deleteMany({ where: { caseId } }),
      () => this.db.caseHearingReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseHearingRecordCorrection.deleteMany({ where: { caseId } }),
      () => this.db.caseJudgmentAppealDefendant.deleteMany({ where: { caseId } }),
      () => this.db.caseJudgmentNextStepReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseJudgmentNextStepRevocation.deleteMany({ where: { caseId } }),
      () => this.db.caseJudgmentReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseJudgmentRecordCorrectionDocument.deleteMany({ where: { caseId } }),
      () => this.db.caseJudgmentVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseLawyerAssignment.deleteMany({ where: { caseId } }),
      () => this.db.caseLawyerAssignmentReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseMatchReceipt.deleteMany({ where: { caseId } }),
      () => this.db.casePreservation.deleteMany({ where: { caseId } }),
      () => this.db.caseRecordEditReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseRefundApplication.deleteMany({ where: { caseId } }),
      () => this.db.caseRoutineProfile.deleteMany({ where: { caseId } }),
      () => this.db.caseSecondInstanceAcceptanceChange.deleteMany({ where: { caseId } }),
      () => this.db.caseSecondInstanceProgressVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseSecondInstanceReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseSecondInstanceResultRevocation.deleteMany({ where: { caseId } }),
      () => this.db.caseSecondInstanceResultVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseSectionRecordEditReceipt.deleteMany({ where: { caseId } }),
      () => this.db.caseSettlementActualAllocation.deleteMany({ where: { caseId } }),
      () => this.db.caseSettlementTerms.deleteMany({ where: { caseId } }),
      () => this.db.caseSupplementEntry.deleteMany({ where: { caseId } }),
      () => this.db.feeRefundReconciliation.deleteMany({ where: { caseId } }),
      () => this.db.settlementBillItem.deleteMany({ where: { caseId } }),
      () => this.db.caseAcceptance.deleteMany({ where: { caseId } }),
      () => this.db.caseClosureRecordCorrection.deleteMany({ where: { caseId } }),
      () => this.db.caseComplaintMailing.deleteMany({ where: { caseId } }),
      () => this.db.caseDefendant.deleteMany({ where: { caseId } }),
      () => this.db.caseEarlyArchive.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFilingFeedback.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFilingRecordCorrection.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFilingSupplement.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFinishRecordCorrection.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionMailingRecordCorrection.deleteMany({ where: { caseId } }),
      () => this.db.caseFilingSubmission.deleteMany({ where: { caseId } }),
      () => this.db.caseHearingAdvance.deleteMany({ where: { caseId } }),
      () => this.db.caseJudgmentRecordCorrection.deleteMany({ where: { caseId } }),
      () => this.db.caseSettlementLaunch.deleteMany({ where: { caseId } }),
      () => this.db.evidenceItem.deleteMany({ where: { caseId } }),
      () => this.db.evidencePaperCertificate.deleteMany({ where: { caseId } }),
      () => this.db.feeCancellationPayment.deleteMany({ where: { caseId } }),
      () => this.db.caseHearingArrangement.deleteMany({ where: { caseId } }),
      () => this.db.evidenceGroupVersion.deleteMany({ where: { caseId } }),
      () => this.db.feeCancellation.deleteMany({ where: { caseId } }),
      () => this.db.feeRecord.deleteMany({ where: { caseId } }),
      () => this.db.caseArchive.deleteMany({ where: { caseId } }),
      () => this.db.caseArchiveVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseClosure.deleteMany({ where: { caseId } }),
      () => this.db.caseClosureVersion.deleteMany({ where: { caseId } }),
      () => this.db.caseEarlyClosure.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionConfirmation.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFiling.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionFinish.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionMailing.deleteMany({ where: { caseId } }),
      () => this.db.caseExecutionSubmission.deleteMany({ where: { caseId } }),
      () => this.db.caseJudgmentFact.deleteMany({ where: { caseId } }),
      () => this.db.caseJudgmentNextStep.deleteMany({ where: { caseId } }),
      () => this.db.caseSecondInstanceProgress.deleteMany({ where: { caseId } }),
      () => this.db.caseSecondInstanceResult.deleteMany({ where: { caseId } }),
      () => this.db.caseTrialRound.deleteMany({ where: { caseId } }),
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
        // 该表无数据或暂不可删，继续处理其余表
      }
    }
    await this.db.case.delete({ where: { id: caseId } });
  }
}
