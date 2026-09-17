import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { DatabaseModule } from '../../database/database.module';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { RightsHolderController } from './rights-holder.controller';
import { RightsHolderService } from './rights-holder.service';

@Module({
  imports: [AccessControlModule, DatabaseModule],
  controllers: [CustomerController, RightsHolderController],
  providers: [CustomerService, RightsHolderService],
  exports: [CustomerService, RightsHolderService],
})
export class CustomerModule {}
