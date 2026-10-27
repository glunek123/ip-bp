import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CalendarService } from './calendar.service';
import { CalendarReminderService } from './calendar-reminder.service';
import {
  ManualItemDto,
  ManualItemUpdateDto,
  ReminderReadDto,
  RefundApplicationDto,
} from './calendar-reminder.dto';
import { CalendarMonthQueryDto, CalendarSummaryQueryDto } from './calendar.dto';
import {
  CalendarSnapshotResponseDto,
  CalendarSummaryResponseDto,
} from './calendar.response.dto';

function exactQuery(query: object, names: string[]): void {
  if (
    Object.keys(query).length !== names.length ||
    names.some((name) => !(name in query))
  )
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: '不支持的查询参数',
    });
}

@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendar')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly reminders: CalendarReminderService,
  ) {}

  @Get('personal')
  personal(
    @CurrentActor() actor: ActorContext,
    @Query() query: CalendarMonthQueryDto,
  ) {
    exactQuery(query, ['month']);
    return this.reminders.manualMonth(actor, query.month);
  }

  @Get('refund-dates')
  refundDates(
    @CurrentActor() actor: ActorContext,
    @Query() query: CalendarMonthQueryDto,
  ) {
    exactQuery(query, ['month']);
    return this.reminders.refundMonth(actor, query.month);
  }

  @Post('personal')
  createPersonal(
    @CurrentActor() actor: ActorContext,
    @Body() input: ManualItemDto,
  ) {
    return this.reminders.createManual(actor, input);
  }

  @Patch('personal/:id')
  updatePersonal(
    @CurrentActor() actor: ActorContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ManualItemUpdateDto,
  ) {
    return this.reminders.updateManual(actor, id, input);
  }

  @Get('reminders')
  dueReminders(
    @CurrentActor() actor: ActorContext,
    @Query() query: CalendarSummaryQueryDto,
  ) {
    exactQuery(query, []);
    return this.reminders.due(actor);
  }

  @Post('reminders/read')
  readReminder(
    @CurrentActor() actor: ActorContext,
    @Body() input: ReminderReadDto,
  ) {
    return this.reminders.markRead(actor, input);
  }

  @Post('refund-applications')
  registerRefundApplication(
    @CurrentActor() actor: ActorContext,
    @Body() input: RefundApplicationDto,
  ) {
    return this.reminders.registerRefundApplication(actor, input);
  }

  @Get('summary')
  @ApiOkResponse({
    type: CalendarSummaryResponseDto,
    description: '当前授权日期事件汇总',
  })
  summary(
    @CurrentActor() actor: ActorContext,
    @Query() query: CalendarSummaryQueryDto,
  ) {
    exactQuery(query, []);
    return this.calendar.summary(actor);
  }

  @Get()
  @ApiOkResponse({
    type: CalendarSnapshotResponseDto,
    description: '当前授权日期事件月视图',
  })
  snapshot(
    @CurrentActor() actor: ActorContext,
    @Query() query: CalendarMonthQueryDto,
  ) {
    exactQuery(query, ['month']);
    if (typeof query.month !== 'string')
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'month 必须为 YYYY-MM',
      });
    return this.calendar.snapshot(actor, query.month);
  }
}
