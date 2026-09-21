import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessControlModule } from '../../access-control/access-control.module';
import { AuthModule } from '../../auth/auth.module';
import { Environment } from '../../common/environment';
import { DatabaseModule } from '../../database/database.module';
import { LocalPrivateBlobStorage } from './local-private-blob-storage';
import { MaterialCleanupService } from './material-cleanup.service';
import { MaterialController } from './material.controller';
import { MaterialService } from './material.service';
import {
  PRIVATE_BLOB_STORAGE,
  UnavailablePrivateBlobStorage,
} from './private-blob-storage';

@Module({
  imports: [AccessControlModule, AuthModule, DatabaseModule],
  controllers: [MaterialController],
  providers: [
    {
      provide: PRIVATE_BLOB_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment>) => {
        if (config.getOrThrow('NODE_ENV') === 'production') {
          return new UnavailablePrivateBlobStorage();
        }
        return new LocalPrivateBlobStorage(
          config.getOrThrow<string>('PRIVATE_FILE_ROOT'),
        );
      },
    },
    MaterialService,
    MaterialCleanupService,
  ],
  exports: [PRIVATE_BLOB_STORAGE, MaterialService],
})
export class MaterialModule {}
