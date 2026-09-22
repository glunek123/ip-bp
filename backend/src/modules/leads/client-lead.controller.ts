import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import { LeadListQueryDto } from './lead.dto';
import { ClientLeadService } from './client-lead.service';

@ApiTags('client-leads')
@ApiBearerAuth()
@Controller('client/leads')
@UseGuards(ActorContextGuard, CsrfGuard)
export class ClientLeadController {
  constructor(private readonly leads: ClientLeadService) {}

  @Get()
  list(
    @CurrentActor() actor: ActorContext,
    @Query() query: LeadListQueryDto,
  ) {
    return this.leads.list(actor, query.page, query.pageSize);
  }

  @Get(':id')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.leads.get(actor, id);
  }
}
