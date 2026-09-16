import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  ACCESS_CONTROL_STORE,
  AccessControlService,
} from './access-control.service';
import { PrismaAccessControlStore } from './prisma-access-control.store';

@Module({
  imports: [DatabaseModule],
  providers: [
    AccessControlService,
    PrismaAccessControlStore,
    {
      provide: ACCESS_CONTROL_STORE,
      useExisting: PrismaAccessControlStore,
    },
  ],
  exports: [AccessControlService],
})
export class AccessControlModule {}
