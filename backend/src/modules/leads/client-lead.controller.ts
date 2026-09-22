import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import { ClientLeadListQueryDto } from './client-lead-review.dto';
import { ClientLeadService } from './client-lead.service';
import {
  ClientLeadListResponseDto,
  ClientLeadResponseDto,
} from './client-lead-response.dto';

@ApiTags('client-leads')
@ApiBearerAuth()
@Controller('client/leads')
@UseGuards(ActorContextGuard, CsrfGuard)
export class ClientLeadController {
  constructor(private readonly leads: ClientLeadService) {}

  @Get()
  @ApiOkResponse({ type: ClientLeadListResponseDto })
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: ClientLeadListQueryDto,
  ) {
    return this.leads.list(actor, query.view, query.page, query.pageSize);
  }

  @Get(':id')
  @ApiOkResponse({ type: ClientLeadResponseDto })
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.leads.get(actor, id);
  }
}
