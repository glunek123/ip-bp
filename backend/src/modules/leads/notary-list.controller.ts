import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { NotaryListQueryDto } from './notary-list.dto';
import { NotaryListService } from './notary-list.service';

@ApiTags('notary-matters')
@ApiBearerAuth()
@Controller('notary-matters')
@UseGuards(ActorContextGuard, CsrfGuard)
export class NotaryListController {
  constructor(private readonly listService: NotaryListService) {}

  @Get()
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
