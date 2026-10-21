import { CaseArchiveService } from './case-archive.service';
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
    CaseExecutionFilingFollowupController,
    LawyerCaseExecutionFilingFollowupController,
    CaseReadController,
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
    CaseExecutionFilingFollowupService,
    CaseCalendarSourceService,
    CaseReadService,
    CaseListPreferenceService,
    CaseListExportService,
    CaseHandlingGroupRead,
    CaseHandlingGroupResourceRead,
    CaseHandlingGroupService,
    CaseCreationService,
    CaseExternalEntryService,
    CaseMatchService,
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
    CaseHearingSchedulerService,
    CaseHearingSignal,
    { provide: CASE_HEARING_CLOCK, useClass: SystemCaseHearingClock },
    FilingCourtService,
    ClientCaseService,
    LawyerAccountService,
  ],
  exports: [CaseCreationService, CaseCalendarSourceService],
})
export class CaseModule {}
