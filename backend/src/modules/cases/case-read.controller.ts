import {
  Controller,
  Body,
  Get,
  Post,
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
import { CaseMatchService } from './case-match.service';
import { MatchCaseDto, MatchCaseResponseDto } from './case-match.dto';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseReadController {
  constructor(
    private readonly cases: CaseReadService,
    private readonly matching: CaseMatchService,
  ) {}

  @Get()
  @ApiOkResponse({ type: CaseListResponseDto })
  list(@CurrentActor() actor: ActorContext, @Query() query: CasePageQueryDto) {
    return this.cases.list(
      actor,
      query.page,
      query.pageSize,
      query.view,
      query.stage,
    );
  }

  @Get(':id')
  @ApiOkResponse({ type: CaseDetailResponseDto })
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.cases.get(actor, id);
  }

  @Post(':id/match')
  @ApiOkResponse({ type: MatchCaseResponseDto })
  match(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: MatchCaseDto,
  ) {
    return this.matching.match(actor, id, body);
  }
}
