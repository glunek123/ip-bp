import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiCreatedResponse } from '@nestjs/swagger';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import type { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CreateCaseFeeEntriesDto } from './case-fee-entry.dto';
import { CaseFeeEntryService } from './case-fee-entry.service';
import { settlementResponses } from './settlement-openapi';
@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseFeeEntryController {
  constructor(private readonly service: CaseFeeEntryService) {}
  @Post('case-entries')
  @ApiCreatedResponse({ schema: settlementResponses.caseFeeEntries })
  create(
    @CurrentActor() actor: ActorContext,
    @Body() input: CreateCaseFeeEntriesDto,
  ) {
    return this.service.create(actor, input);
  }
}
