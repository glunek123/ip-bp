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

@Module({
  imports: [AccessControlModule, AuthModule, DatabaseModule, MaterialModule],
  controllers: [CaseReadController],
  providers: [
    CaseReadService,
    CaseCreationService,
    CaseMatchService,
    CaseComplaintService,
    CaseComplaintConfirmationService,
  ],
  exports: [CaseCreationService],
})
export class CaseModule {}
