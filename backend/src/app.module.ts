import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { validateEnvironment } from './common/environment';
import { AccessControlModule } from './access-control/access-control.module';
import { CustomerModule } from './modules/customers/customer.module';
import { AuthModule } from './auth/auth.module';
import { MaterialModule } from './modules/materials/material.module';
import { LeadModule } from './modules/leads/lead.module';
import { CaseModule } from './modules/cases/case.module';
import { CalendarModule } from './modules/calendar';
import { SettlementModule } from './modules/settlements/settlement.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { ReportsModule } from './modules/reports';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnvironment,
    }),
    AuthModule,
    AccessControlModule,
    CustomerModule,
    MaterialModule,
    LeadModule,
    CaseModule,
    CalendarModule,
    SettlementModule,
    EvidenceModule,
    ReportsModule,
    HealthModule,
  ],
})
export class AppModule {}
