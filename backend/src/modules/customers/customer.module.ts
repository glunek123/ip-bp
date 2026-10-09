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
import { CustomerLifecycleService } from './customer-lifecycle.service';
import { CustomerCooperationController } from './customer-cooperation.controller';
import { CustomerCooperationService } from './customer-cooperation.service';
import { CustomerContactController } from './customer-contact.controller';
import { CustomerContactService } from './customer-contact.service';
import { CustomerAgreementInvoiceController } from './customer-agreement-invoice.controller';
import { CustomerAgreementInvoiceService } from './customer-agreement-invoice.service';
import { CustomerSettlementController } from './customer-settlement.controller';
import { CustomerSettlementService } from './customer-settlement.service';

@Module({
  imports: [AccessControlModule, AuthModule, DatabaseModule, MaterialModule],
  controllers: [
    CustomerController,
    CustomerCooperationController,
    CustomerContactController,
    CustomerAgreementInvoiceController,
    CustomerSettlementController,
    RightsHolderController,
    RightAssetController,
  ],
  providers: [
    CustomerService,
    CustomerLifecycleService,
    CustomerCooperationService,
    CustomerContactService,
    CustomerAgreementInvoiceService,
    CustomerSettlementService,
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
