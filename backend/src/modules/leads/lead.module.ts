import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MaterialModule } from '../materials';
import { LeadController } from './lead.controller';
import { LeadService } from './lead.service';
import { ClientLeadController } from './client-lead.controller';
import { ClientLeadService } from './client-lead.service';
import {
  LeadNotaryController,
  NotaryOfficeController,
} from './lead-notary.controller';
import { LeadNotaryService } from './lead-notary.service';

@Module({
  imports: [AccessControlModule, AuthModule, DatabaseModule, MaterialModule],
  controllers: [
    LeadController,
    ClientLeadController,
    LeadNotaryController,
    NotaryOfficeController,
  ],
  providers: [LeadService, ClientLeadService, LeadNotaryService],
  exports: [LeadService, ClientLeadService, LeadNotaryService],
})
export class LeadModule {}
