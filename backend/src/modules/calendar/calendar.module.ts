import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AccessControlModule } from '../../access-control/access-control.module';
import { CaseModule } from '../cases';
import { CustomerModule } from '../customers';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [AuthModule, AccessControlModule, CaseModule, CustomerModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
