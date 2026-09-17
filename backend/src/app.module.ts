import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { validateEnvironment } from './common/environment';
import { AccessControlModule } from './access-control/access-control.module';
import { CustomerModule } from './modules/customers/customer.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validate: validateEnvironment,
    }),
    AccessControlModule,
    CustomerModule,
    HealthModule,
  ],
})
export class AppModule {}
