import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { DeletionAuditController } from './deletion-audit.controller';
import { DeletionAuditService } from './deletion-audit.service';

@Module({
  imports: [AccessControlModule, AuthModule, DatabaseModule],
  controllers: [DeletionAuditController],
  providers: [DeletionAuditService],
  exports: [DeletionAuditService],
})
export class DeletionAuditModule {}
