import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { validateEnvironment } from './common/environment';
import { AccessControlModule } from './access-control/access-control.module';
import { CustomerModule } from './modules/customers/customer.module';
import { AuthModule } from './auth/auth.module';
import { MaterialModule } from './modules/materials/material.module';
import { LeadModule } from './modules/leads/lead.module';

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
    HealthModule,
  ],
})
export class AppModule {}
