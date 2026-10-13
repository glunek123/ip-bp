import { CaseClosureService } from './case-closure.service';
import { CaseExecutionFinishService } from './case-execution-finish.service';
import { CaseExecutionMailingService } from './case-execution-mailing.service';
import { CaseExecutionFilingService } from './case-execution-filing.service';
import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MaterialModule } from '../materials';
import { CaseCreationService } from './case-creation.service';
import { CaseCalendarSourceService } from './case-calendar-source.service';
import { CaseReadController } from './case-read.controller';
import { CaseReadService } from './case-read.service';
import { CaseMatchService } from './case-match.service';
import { CaseComplaintService } from './case-complaint.service';
import { CaseComplaintConfirmationService } from './case-complaint-confirmation.service';
import { CaseComplaintMailingService } from './case-complaint-mailing.service';
import { CaseFilingService } from './case-filing.service';
import { CaseAcceptanceService } from './case-acceptance.service';
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
  imports: [AccessControlModule, AuthModule, DatabaseModule, MaterialModule],
  controllers: [
    CaseReadController,
    ClientCaseController,
    LawyerAccountController,
    CaseLawyerCandidatesController,
    LawyerCaseController,
  ],
  providers: [
    CaseCalendarSourceService,
    CaseReadService,
    CaseCreationService,
    CaseMatchService,
    CaseComplaintService,
    CaseComplaintConfirmationService,
    CaseComplaintMailingService,
    CaseFilingService,
    CaseAcceptanceService,
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
