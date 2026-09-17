import { Module } from '@nestjs/common';
import { AccessControlModule } from '../../access-control/access-control.module';
import { DatabaseModule } from '../../database/database.module';
import { CustomerController } from './customer.controller';
import { CustomerService } from './customer.service';

@Module({
  imports: [AccessControlModule, DatabaseModule],
  controllers: [CustomerController],
  providers: [CustomerService],
  exports: [CustomerService],
})
export class CustomerModule {}
