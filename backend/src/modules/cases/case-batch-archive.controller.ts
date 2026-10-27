import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CaseBatchArchiveDto,
  CaseBatchArchiveResultDto,
} from './case-batch-archive.dto';
import { CaseBatchArchiveService } from './case-batch-archive.service';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases/early-archive-batches')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseBatchArchiveController {
  constructor(private readonly service: CaseBatchArchiveService) {}
  @Post()
  @HttpCode(200)
  @ApiBody({ type: CaseBatchArchiveDto })
  @ApiOkResponse({ type: CaseBatchArchiveResultDto })
  archive(
    @CurrentActor() actor: ActorContext,
    @Body() input: CaseBatchArchiveDto,
  ): Promise<CaseBatchArchiveResultDto> {
    return this.service.archive(actor, input);
  }
}
