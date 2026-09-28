import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MaterialModule } from '../materials';
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
import { NotaryListController } from './notary-list.controller';
import { NotaryListService } from './notary-list.service';
import { NotaryOfficeAccountService } from './notary-office-account.service';

@Module({
  imports: [AccessControlModule, AuthModule, DatabaseModule, MaterialModule],
  controllers: [
    LeadController,
    ClientLeadController,
    ClientNotaryOpeningReviewController,
    ClientNotaryController,
    LeadNotaryController,
    NotaryListController,
    NotaryOfficeController,
  ],
  providers: [
    LeadService,
    ClientLeadService,
    ClientNotaryService,
    LeadNotaryService,
    NotaryOpeningService,
    NotaryOpeningReviewService,
    NotaryListService,
    NotaryOfficeAccountService,
  ],
  exports: [LeadService, ClientLeadService, LeadNotaryService],
})
export class LeadModule {}
