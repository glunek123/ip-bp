import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { AccessControlModule } from '../../access-control/access-control.module';
import { CaseModule } from '../cases';
import { CustomerModule } from '../customers';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarReminderService } from './calendar-reminder.service';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [
    AuthModule,
    AccessControlModule,
    DatabaseModule,
    CaseModule,
    CustomerModule,
  ],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarReminderService],
})
export class CalendarModule {}
