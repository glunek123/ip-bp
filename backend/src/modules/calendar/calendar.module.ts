import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { CaseModule } from '../cases';
import { CustomerModule } from '../customers';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [AuthModule, CaseModule, CustomerModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
