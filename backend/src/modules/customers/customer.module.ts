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
import { CustomerAccountService } from './customer-account.service';
import { RightAssetController } from './right-asset.controller';
import { RightAssetService } from './right-asset.service';

@Module({
  imports: [AccessControlModule, AuthModule, DatabaseModule, MaterialModule],
  controllers: [
    CustomerController,
    RightsHolderController,
    RightAssetController,
  ],
  providers: [
    CustomerService,
    CustomerAdmissionService,
    CustomerAccountService,
    RightsHolderService,
    RightAssetService,
  ],
  exports: [
    CustomerService,
    CustomerAdmissionService,
    CustomerAccountService,
    RightsHolderService,
  ],
})
export class CustomerModule {}
