import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { AuthModule } from '../../auth/auth.module';
import { DatabaseModule } from '../../database/database.module';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';
import { FeeController } from './fee.controller';
import { FeeService } from './fee.service';
import { MaterialModule } from '../materials';
import { CaseFeeEntryController } from './case-fee-entry.controller';
import { CaseFeeEntryService } from './case-fee-entry.service';

@Module({
  imports: [AccessControlModule, AuthModule, DatabaseModule, MaterialModule],
  controllers: [SettlementController, FeeController, CaseFeeEntryController],
  providers: [SettlementService, FeeService, CaseFeeEntryService],
})
export class SettlementModule {}
