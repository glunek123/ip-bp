import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MaterialModule } from '../materials';
import { CaseCreationService } from './case-creation.service';
import { CaseReadController } from './case-read.controller';
import { CaseReadService } from './case-read.service';
import { CaseMatchService } from './case-match.service';
import { CaseComplaintService } from './case-complaint.service';
import { CaseComplaintConfirmationService } from './case-complaint-confirmation.service';
import { CaseComplaintMailingService } from './case-complaint-mailing.service';
import { CaseFilingService } from './case-filing.service';
import { CaseAcceptanceService } from './case-acceptance.service';
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
    CaseReadService,
    CaseCreationService,
    CaseMatchService,
    CaseComplaintService,
    CaseComplaintConfirmationService,
    CaseComplaintMailingService,
    CaseFilingService,
    CaseAcceptanceService,
    FilingCourtService,
    ClientCaseService,
    LawyerAccountService,
  ],
  exports: [CaseCreationService],
})
export class CaseModule {}
