import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { NotaryListQueryDto, NotaryListResponseDto } from './notary-list.dto';
import { NotaryListService } from './notary-list.service';
import { NotaryListPreferenceDto } from './notary-list-preference.dto';
import { NotaryListPreferenceService } from './notary-list-preference.service';

@ApiTags('notary-matters')
@ApiBearerAuth()
@Controller('notary-matters')
@UseGuards(ActorContextGuard, CsrfGuard)
export class NotaryListController {
  constructor(
    private readonly listService: NotaryListService,
    private readonly preferenceService: NotaryListPreferenceService,
  ) {}

  @Get('list-preference')
  @ApiOkResponse({ type: NotaryListPreferenceDto })
  getListPreference(@CurrentActor() actor: ActorContext) {
    return this.preferenceService.get(actor);
  }

  @Put('list-preference')
  @ApiOkResponse({ type: NotaryListPreferenceDto })
  putListPreference(
    @CurrentActor() actor: ActorContext,
    @Body() preference: NotaryListPreferenceDto,
  ) {
    return this.preferenceService.put(actor, preference);
  }

  @Get()
  @ApiOkResponse({ type: NotaryListResponseDto })
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: NotaryListQueryDto,
  ) {
    return this.listService.list(
      actor,
      query.page,
      query.pageSize,
      query.stage,
    );
  }
}
