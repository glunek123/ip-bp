import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessControlModule } from '../../access-control/access-control.module';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { MaterialCleanupService } from './material-cleanup.service';
import { MaterialController } from './material.controller';
import { CaseSectionRecordUploadController } from './case-section-record-upload.controller';
import {
  ExecutionSupplementUploadController,
  LawyerExecutionSupplementUploadController,
} from './execution-supplement-upload.controller';
import { MaterialService } from './material.service';
import { MaterialStorageKeyCoordinator } from './material-storage-key-coordinator';
import { PRIVATE_BLOB_STORAGE } from './private-blob-storage';
import { createPrivateBlobStorage } from './private-blob-storage.provider';

@Module({
  imports: [AccessControlModule, AuthModule, DatabaseModule],
  controllers: [
    MaterialController,
    CaseSectionRecordUploadController,
    ExecutionSupplementUploadController,
    LawyerExecutionSupplementUploadController,
  ],
  providers: [
    {
      provide: PRIVATE_BLOB_STORAGE,
      inject: [ConfigService],
      useFactory: createPrivateBlobStorage,
    },
    MaterialStorageKeyCoordinator,
    MaterialService,
    MaterialCleanupService,
  ],
  exports: [PRIVATE_BLOB_STORAGE, MaterialService],
})
export class MaterialModule {}
