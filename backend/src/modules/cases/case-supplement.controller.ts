import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import type { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CreateCaseSupplementDto } from './case-supplement.dto';
import { CaseSupplementService } from './case-supplement.service';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases/:id/supplemental-workspace')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseSupplementController {
  constructor(private readonly supplements: CaseSupplementService) {}

  @Get()
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.supplements.get(actor, id);
  }

  @Get('requests/:key')
  getRequest(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('key') key: string,
  ) {
    return this.supplements.getRequest(actor, id, key);
  }

  @Post()
  @ApiBody({ type: CreateCaseSupplementDto })
  create(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CreateCaseSupplementDto,
  ) {
    return this.supplements.create(actor, id, input);
  }
}
