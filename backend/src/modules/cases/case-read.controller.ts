import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CaseDetailResponseDto,
  CaseListResponseDto,
  CasePageQueryDto,
} from './case-read.dto';
import { CaseReadService } from './case-read.service';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseReadController {
  constructor(private readonly cases: CaseReadService) {}

  @Get()
  @ApiOkResponse({ type: CaseListResponseDto })
  list(@CurrentActor() actor: ActorContext, @Query() query: CasePageQueryDto) {
    return this.cases.list(actor, query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOkResponse({ type: CaseDetailResponseDto })
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cases.get(actor, id);
  }
}
