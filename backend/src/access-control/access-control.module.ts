import { Module } from '@nestjs/common';
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
      useFactory: () => createIdentityAdapterFromEnvironment(process.env),
    },
  ],
  exports: [AccessControlService, ActorContextGuard, IDENTITY_ADAPTER],
})
export class AccessControlModule {}
