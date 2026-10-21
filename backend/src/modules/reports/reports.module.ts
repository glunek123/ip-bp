import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AccessControlModule } from '../../access-control/access-control.module';
import { CaseModule } from '../cases';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [AuthModule, AccessControlModule, CaseModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
