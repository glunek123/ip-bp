import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  ACCESS_CONTROL_STORE,
  AccessControlService,
} from './access-control.service';
import { PrismaAccessControlStore } from './prisma-access-control.store';
import { ActorContextGuard } from './actor-context.guard';
import {
  IDENTITY_ADAPTER,
  UnavailableIdentityAdapter,
} from './identity.adapter';

@Module({
  imports: [DatabaseModule],
  providers: [
    AccessControlService,
    ActorContextGuard,
    PrismaAccessControlStore,
    UnavailableIdentityAdapter,
    {
      provide: ACCESS_CONTROL_STORE,
      useExisting: PrismaAccessControlStore,
    },
    {
      provide: IDENTITY_ADAPTER,
      useExisting: UnavailableIdentityAdapter,
    },
  ],
  exports: [AccessControlService, ActorContextGuard, IDENTITY_ADAPTER],
})
export class AccessControlModule {}
