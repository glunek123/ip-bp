import { CasePaymentCorrectionService } from './case-payment-correction.service';
import { LitigationRefundsController } from './litigation-refunds.controller';
import { LitigationRefundsService } from './litigation-refunds.service';
import { CaseSupplementController } from './case-supplement.controller';
import { CaseSupplementService } from './case-supplement.service';
import { CaseFileCatalogController } from './case-file-catalog.controller';
import { CaseFileCatalogService } from './case-file-catalog.service';
import { CaseClosurePaymentPrismaDraft } from './case-closure-payment-prisma-draft';
import { MaterialService } from '../materials';
import { SettlementAssessmentPostgresDraft } from '../settlements';
import { CaseRefundInventoryPrismaDraft } from './case-refund-inventory-prisma-draft';
import { CaseClosureCommandController } from './case-closure-command.controller';
import { CaseClosureAmountUpdateDraftService } from './case-closure-amount-update-draft.service';
import { CaseEarlyClosureTransactionDraftService } from './case-early-closure-transaction-draft.service';
import { CaseClosureSettlementUpdateTransactionDraftService } from './case-closure-settlement-update-transaction-draft.service';
import { CasePaymentProofSupplementTransactionDraftService } from './case-payment-proof-supplement-transaction-draft.service';
import { DatabaseService } from '../../database/database.service';
import { AccessControlService } from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import { ClosureActualAggregateReadDraft } from '../settlements';
import { CaseClosureWorkspaceReadDraft } from './case-closure-workspace-read-draft';
import { CaseClosureWorkspaceController } from './case-closure-workspace.controller';
import { CaseArchiveService } from './case-archive.service';
import { CaseArchiveReadinessService } from './case-archive-readiness.service';
import {
  CaseArchiveReadinessController,
  LawyerCaseArchiveReadinessController,
} from './case-archive-readiness.controller';
import { CaseRoutineEditController } from './case-routine-edit.controller';
import { CaseRoutineEditService } from './case-routine-edit.service';
import { CaseEarlyArchiveService } from './case-early-archive.service';
import { CaseCsvImportController } from './case-csv-import.controller';
import { CaseCsvImportService } from './case-csv-import.service';
import { CaseBatchArchiveController } from './case-batch-archive.controller';
import { CaseBatchArchiveService } from './case-batch-archive.service';
import { CaseExecutionRecordEditService } from './case-execution-record-edit.service';
import { CaseHistoricalRecordEditService } from './case-historical-record-edit.service';
import { CaseClosureService } from './case-closure.service';
import { CaseExecutionFinishService } from './case-execution-finish.service';
import { CaseExecutionMailingService } from './case-execution-mailing.service';
import { CaseExecutionFilingService } from './case-execution-filing.service';
import { CaseExecutionFilingFollowupService } from './case-execution-filing-followup.service';
import {
  CaseExecutionFilingFollowupController,
  LawyerCaseExecutionFilingFollowupController,
} from './case-execution-filing-followup.controller';
import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { CustomerModule } from '../customers';
import { MaterialModule } from '../materials';
import { CaseCreationService } from './case-creation.service';
import { CaseExternalEntryService } from './case-external-entry.service';
import { CaseCalendarSourceService } from './case-calendar-source.service';
import { CaseReportsSourceService } from './case-reports-source.service';
import { CaseReadController } from './case-read.controller';
import { CaseReadService } from './case-read.service';
import { CaseListPreferenceController } from './case-list-preference.controller';
import { CaseListPreferenceService } from './case-list-preference.service';
import { CaseListExportController } from './case-list-export.controller';
import { CaseListExportService } from './case-list-export.service';
import { CaseHandlingGroupController } from './case-handling-group.controller';
import { CaseHandlingGroupRead } from './case-handling-group.read';
import { CaseHandlingGroupResourceController } from './case-handling-group-resource.controller';
import { CaseHandlingGroupResourceRead } from './case-handling-group-resource.read';
import { CaseHandlingGroupService } from './case-handling-group.service';
import { CaseMatchService } from './case-match.service';
import { CaseLawyerAssignmentController } from './case-lawyer-assignment.controller';
import { CaseLawyerAssignmentService } from './case-lawyer-assignment.service';
import { CaseComplaintExportController } from './case-complaint-export.controller';
import { CaseComplaintExportService } from './case-complaint-export.service';
import { CaseConsolidationController } from './case-consolidation.controller';
import { CaseConsolidationService } from './case-consolidation.service';
import { CaseComplaintService } from './case-complaint.service';
import { CaseComplaintConfirmationService } from './case-complaint-confirmation.service';
import { CaseComplaintMailingService } from './case-complaint-mailing.service';
import { CaseFilingService } from './case-filing.service';
import { CaseAcceptanceService } from './case-acceptance.service';
import { CaseRecordEditService } from './case-record-edit.service';
import { CaseHearingService } from './case-hearing.service';
import { CaseJudgmentService } from './case-judgment.service';
import { CaseJudgmentNextStepService } from './case-judgment-next-step.service';
import { CaseSecondInstanceService } from './case-second-instance.service';
import { CaseExecutionSubmissionService } from './case-execution-submission.service';
import { CaseExecutionConfirmationService } from './case-execution-confirmation.service';
import { CaseHearingSchedulerService } from './case-hearing-scheduler.service';
import {
  CASE_HEARING_CLOCK,
  CaseHearingSignal,
  SystemCaseHearingClock,
} from './case-hearing-signal';
import { FilingCourtService } from './filing-court.service';
import { ClientCaseController } from './client-case.controller';
import { ClientCaseService } from './client-case.service';
import { LawyerAccountService } from './lawyer-account.service';
import {
  LawyerAccountController,
  CaseLawyerCandidatesController,
} from './lawyer-account.controller';
import { LawyerCaseController } from './lawyer-case.controller';

@Module({
  imports: [
    AccessControlModule,
    AuthModule,
    DatabaseModule,
    CustomerModule,
    MaterialModule,
  ],
  controllers: [
    LitigationRefundsController,
    CaseSupplementController,
    CaseFileCatalogController,
    CaseArchiveReadinessController,
    LawyerCaseArchiveReadinessController,
    CaseClosureCommandController,
    CaseClosureWorkspaceController,
    CaseRoutineEditController,
    CaseCsvImportController,
    CaseBatchArchiveController,
    CaseExecutionFilingFollowupController,
    LawyerCaseExecutionFilingFollowupController,
    CaseReadController,
    CaseLawyerAssignmentController,
    CaseComplaintExportController,
    CaseConsolidationController,
    CaseListPreferenceController,
    CaseListExportController,
    CaseHandlingGroupController,
    CaseHandlingGroupResourceController,
    ClientCaseController,
    LawyerAccountController,
    CaseLawyerCandidatesController,
    LawyerCaseController,
  ],
  providers: [
    LitigationRefundsService,
    CaseSupplementService,
    CaseFileCatalogService,
    {
      provide: CaseClosurePaymentPrismaDraft,
      inject: [DatabaseService, AccessControlService, OrganizationService],
      useFactory: (
        db: DatabaseService,
        access: AccessControlService,
        org: OrganizationService,
      ) => new CaseClosurePaymentPrismaDraft(db, access, org),
    },
    {
      provide: CasePaymentCorrectionService,
      inject: [CaseClosurePaymentPrismaDraft],
      useFactory: (payments: CaseClosurePaymentPrismaDraft) =>
        new CasePaymentCorrectionService(payments),
    },
    {
      provide: CaseClosureAmountUpdateDraftService,
      inject: [
        DatabaseService,
        AccessControlService,
        OrganizationService,
        SettlementAssessmentPostgresDraft,
      ],
      useFactory: (
        db: DatabaseService,
        access: AccessControlService,
        org: OrganizationService,
        assessments: SettlementAssessmentPostgresDraft,
      ) =>
        new CaseClosureAmountUpdateDraftService(db, access, org, assessments),
    },
    {
      provide: CaseRefundInventoryPrismaDraft,
      inject: [DatabaseService, OrganizationService, AccessControlService],
      useFactory: (
        db: DatabaseService,
        org: OrganizationService,
        access: AccessControlService,
      ) => new CaseRefundInventoryPrismaDraft(db, org, access),
    },
    {
      provide: SettlementAssessmentPostgresDraft,
      inject: [DatabaseService, AccessControlService, OrganizationService],
      useFactory: (
        db: DatabaseService,
        access: AccessControlService,
        org: OrganizationService,
      ) => new SettlementAssessmentPostgresDraft(db, access, org),
    },
    {
      provide: CaseEarlyClosureTransactionDraftService,
      inject: [
        DatabaseService,
        AccessControlService,
        MaterialService,
        OrganizationService,
      ],
      useFactory: (
        db: DatabaseService,
        access: AccessControlService,
        materials: MaterialService,
        org: OrganizationService,
      ) =>
        new CaseEarlyClosureTransactionDraftService(db, access, materials, org),
    },
    {
      provide: CasePaymentProofSupplementTransactionDraftService,
      inject: [
        DatabaseService,
        AccessControlService,
        OrganizationService,
        MaterialService,
      ],
      useFactory: (
        db: DatabaseService,
        access: AccessControlService,
        org: OrganizationService,
        materials: MaterialService,
      ) =>
        new CasePaymentProofSupplementTransactionDraftService(
          db,
          access,
          org,
          materials,
        ),
    },
    {
      provide: CaseClosureSettlementUpdateTransactionDraftService,
      inject: [
        DatabaseService,
        AccessControlService,
        OrganizationService,
        MaterialService,
        CaseRefundInventoryPrismaDraft,
        SettlementAssessmentPostgresDraft,
      ],
      useFactory: (
        db: DatabaseService,
        access: AccessControlService,
        org: OrganizationService,
        materials: MaterialService,
        refunds: CaseRefundInventoryPrismaDraft,
        assessments: SettlementAssessmentPostgresDraft,
      ) =>
        new CaseClosureSettlementUpdateTransactionDraftService(
          db,
          access,
          org,
          materials,
          refunds,
          assessments,
        ),
    },
    ClosureActualAggregateReadDraft,
    {
      provide: CaseClosureWorkspaceReadDraft,
      inject: [
        DatabaseService,
        AccessControlService,
        OrganizationService,
        ClosureActualAggregateReadDraft,
      ],
      useFactory: (
        database: DatabaseService,
        access: AccessControlService,
        organization: OrganizationService,
        actual: ClosureActualAggregateReadDraft,
      ) =>
        new CaseClosureWorkspaceReadDraft(
          database,
          access,
          organization,
          actual,
        ),
    },
    CaseRoutineEditService,
    CaseCsvImportService,
    CaseBatchArchiveService,
    CaseExecutionFilingFollowupService,
    CaseCalendarSourceService,
    CaseReportsSourceService,
    CaseReadService,
    CaseListPreferenceService,
    CaseListExportService,
    CaseHandlingGroupRead,
    CaseHandlingGroupResourceRead,
    CaseHandlingGroupService,
    CaseCreationService,
    CaseExternalEntryService,
    CaseMatchService,
    CaseLawyerAssignmentService,
    CaseComplaintExportService,
    CaseConsolidationService,
    CaseComplaintService,
    CaseComplaintConfirmationService,
    CaseComplaintMailingService,
    CaseFilingService,
    CaseAcceptanceService,
    CaseRecordEditService,
    CaseExecutionRecordEditService,
    CaseHistoricalRecordEditService,
    CaseHearingService,
    CaseJudgmentService,
    CaseJudgmentNextStepService,
    CaseSecondInstanceService,
    CaseExecutionSubmissionService,
    CaseExecutionConfirmationService,
    CaseExecutionMailingService,
    CaseExecutionFilingService,
    CaseExecutionFinishService,
    CaseClosureService,
    CaseArchiveService,
    CaseArchiveReadinessService,
    CaseEarlyArchiveService,
    CaseHearingSchedulerService,
    CaseHearingSignal,
    { provide: CASE_HEARING_CLOCK, useClass: SystemCaseHearingClock },
    FilingCourtService,
    ClientCaseService,
    LawyerAccountService,
  ],
  exports: [
    CaseCreationService,
    CaseCalendarSourceService,
    CaseReportsSourceService,
  ],
})
export class CaseModule {}
