import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AccessControlModule } from '../../access-control/access-control.module';
import { CaseModule } from '../cases';
import { CustomerModule } from '../customers';
import { LeadModule } from '../leads';
import { DatabaseModule } from '../../database/database.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [
    AuthModule,
    AccessControlModule,
    DatabaseModule,
    CaseModule,
    CustomerModule,
    LeadModule,
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
