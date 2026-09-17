import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import {
  ACCESS_CONTROL_STORE,
  AccessControlService,
} from './access-control.service';
import { PrismaAccessControlStore } from './prisma-access-control.store';
import { ActorContextGuard } from './actor-context.guard';
import { IDENTITY_ADAPTER } from './identity.adapter';
import { createIdentityAdapterFromEnvironment } from './identity-adapter.factory';

@Module({
  imports: [DatabaseModule],
  providers: [
    AccessControlService,
    ActorContextGuard,
    PrismaAccessControlStore,
    {
      provide: ACCESS_CONTROL_STORE,
      useExisting: PrismaAccessControlStore,
    },
    {
      provide: IDENTITY_ADAPTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createIdentityAdapterFromEnvironment({
          NODE_ENV: config.get<string>('NODE_ENV'),
          E2E_IDENTITY_FIXTURES: config.get<string>('E2E_IDENTITY_FIXTURES'),
        }),
    },
  ],
  exports: [AccessControlService, ActorContextGuard, IDENTITY_ADAPTER],
})
export class AccessControlModule {}
