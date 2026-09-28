import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MaterialModule } from '../materials';
import { CaseModule } from '../cases';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';
import {
  ClientLeadController,
  ClientNotaryOpeningReviewController,
} from './client-lead.controller';
import { ClientLeadService } from './client-lead.service';
import { ClientNotaryController } from './client-notary.controller';
import { ClientNotaryService } from './client-notary.service';
import {
  LeadNotaryController,
  NotaryOfficeController,
} from './lead-notary.controller';
import { LeadNotaryService } from './lead-notary.service';
import { NotaryOpeningService } from './notary-opening.service';
import { NotaryOpeningReviewService } from './notary-opening-review.service';
import { NotaryIssuanceDecisionService } from './notary-issuance-decision.service';
import { NotaryListController } from './notary-list.controller';
import { NotaryListService } from './notary-list.service';
import { NotaryOfficeAccountService } from './notary-office-account.service';
import { NotaryPortalController } from './notary-portal.controller';
import { NotaryPortalService } from './notary-portal.service';
import { NotaryCertificateService } from './notary-certificate.service';

@Module({
  imports: [
    AccessControlModule,
    AuthModule,
    DatabaseModule,
    MaterialModule,
    CaseModule,
  ],
  controllers: [
    LeadController,
    ClientLeadController,
    ClientNotaryOpeningReviewController,
    ClientNotaryController,
    LeadNotaryController,
    NotaryListController,
    NotaryOfficeController,
    NotaryPortalController,
  ],
  providers: [
    LeadService,
    ClientLeadService,
    ClientNotaryService,
    LeadNotaryService,
    NotaryOpeningService,
    NotaryOpeningReviewService,
    NotaryIssuanceDecisionService,
    NotaryListService,
    NotaryOfficeAccountService,
    NotaryPortalService,
    NotaryCertificateService,
  ],
  exports: [LeadService, ClientLeadService, LeadNotaryService],
})
export class LeadModule {}
