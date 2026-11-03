import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MaterialModule } from '../materials';
import { CaseModule } from '../cases';
import { LeadController } from './lead.controller';
import { LeadBatchPushController } from './lead-batch-push.controller';
import { LeadNoEvidenceBatchController } from './lead-no-evidence-batch.controller';
import { LeadCsvImportController } from './lead-csv-import.controller';
import { LeadImageImportController } from './lead-image-import.controller';
import {
  LEAD_IMAGE_DOWNLOADER,
  LeadImageImportService,
} from './lead-image-import.service';
import { downloadLeadImage } from './lead-remote-image';
import { LeadService } from './lead.service';
import { NotaryReportsSourceService } from './notary-reports-source.service';
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
import { NotaryOpeningImportController } from './notary-opening-import.controller';
import { NotaryOpeningImportService } from './notary-opening-import.service';
import {
  NOTARY_OPENING_RECOGNITION,
  NotaryOpeningRecognition,
} from './notary-opening-recognition';
import { NotaryOpeningReviewService } from './notary-opening-review.service';
import { NotaryIssuanceDecisionService } from './notary-issuance-decision.service';
import { NotaryReturnArchiveService } from './notary-return-archive.service';
import { NotaryReturnArchiveBatchController } from './notary-return-archive-batch.controller';
import { NotaryReturnArchiveBatchService } from './notary-return-archive-batch.service';
import { NotaryListController } from './notary-list.controller';
import { NotaryListService } from './notary-list.service';
import { NotaryListPreferenceService } from './notary-list-preference.service';
import { NotaryListExportController } from './notary-list-export.controller';
import { NotaryListExportService } from './notary-list-export.service';
import { NotaryOfficeAccountService } from './notary-office-account.service';
import { NotaryPortalController } from './notary-portal.controller';
import { NotaryPortalService } from './notary-portal.service';
import { NotaryCertificateService } from './notary-certificate.service';
import { NotaryRecordEditController } from './notary-record-edit.controller';
import { NotaryRecordEditService } from './notary-record-edit.service';
import { NotaryRoutineEditController } from './notary-routine-edit.controller';
import { NotaryRoutineEditService } from './notary-routine-edit.service';
import { LeadRoutineEditController } from './lead-routine-edit.controller';
import { LeadRoutineEditService } from './lead-routine-edit.service';

@Module({
  imports: [
    AccessControlModule,
    AuthModule,
    DatabaseModule,
    MaterialModule,
    CaseModule,
  ],
  controllers: [
    // Static import routes must precede LeadController's GET /:id.
    LeadCsvImportController,
    LeadController,
    LeadRoutineEditController,
    LeadBatchPushController,
    LeadNoEvidenceBatchController,
    LeadImageImportController,
    ClientLeadController,
    ClientNotaryOpeningReviewController,
    ClientNotaryController,
    NotaryListController,
    NotaryListExportController,
    NotaryReturnArchiveBatchController,
    NotaryOpeningImportController,
    LeadNotaryController,
    NotaryOfficeController,
    NotaryPortalController,
    NotaryRecordEditController,
    NotaryRoutineEditController,
  ],
  providers: [
    NotaryReportsSourceService,
    LeadService,
    LeadRoutineEditService,
    LeadImageImportService,
    { provide: LEAD_IMAGE_DOWNLOADER, useValue: downloadLeadImage },
    ClientLeadService,
    ClientNotaryService,
    LeadNotaryService,
    NotaryOpeningService,
    NotaryOpeningImportService,
    { provide: NOTARY_OPENING_RECOGNITION, useClass: NotaryOpeningRecognition },
    NotaryOpeningReviewService,
    NotaryIssuanceDecisionService,
    NotaryReturnArchiveService,
    NotaryReturnArchiveBatchService,
    NotaryListService,
    NotaryListPreferenceService,
    NotaryListExportService,
    NotaryOfficeAccountService,
    NotaryPortalService,
    NotaryCertificateService,
    NotaryRecordEditService,
    NotaryRoutineEditService,
  ],
  exports: [
    LeadService,
    ClientLeadService,
    LeadNotaryService,
    NotaryReportsSourceService,
  ],
})
export class LeadModule {}
