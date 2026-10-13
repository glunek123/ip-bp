import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CalendarService } from './calendar.service';
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
  constructor(private readonly calendar: CalendarService) {}

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
