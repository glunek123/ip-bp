import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { DatabaseModule } from '../../database/database.module';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';
import { RightsHolderController } from './rights-holder.controller';
import { RightsHolderService } from './rights-holder.service';
import { AuthModule } from '../../auth/auth.module';
import { MaterialModule } from '../materials';
import { CustomerAdmissionService } from './customer-admission.service';

@Module({
  imports: [AccessControlModule, AuthModule, DatabaseModule, MaterialModule],
  controllers: [CustomerController, RightsHolderController],
  providers: [CustomerService, CustomerAdmissionService, RightsHolderService],
  exports: [CustomerService, CustomerAdmissionService, RightsHolderService],
})
export class CustomerModule {}
