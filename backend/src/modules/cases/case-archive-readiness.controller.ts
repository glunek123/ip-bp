import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { CaseArchiveReadinessService } from './case-archive-readiness.service';

@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseArchiveReadinessController {
  constructor(private readonly readiness: CaseArchiveReadinessService) {}

  @Get(':id/archive-readiness')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: '四项归档条件的即时预检；正式归档仍重新校验' })
  read(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    return this.readiness.read(actor, id);
  }
}

@ApiTags('lawyer-cases')
@ApiBearerAuth()
@Controller('lawyer/cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LawyerCaseArchiveReadinessController {
  constructor(private readonly readiness: CaseArchiveReadinessService) {}

  @Get(':id/archive-readiness')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ description: '当前承办律师的脱敏归档条件预检' })
  read(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    if (
      actor.lawyerAccountId !== actor.userId ||
      actor.clientCustomerId ||
      actor.notaryOfficeId
    )
      throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    return this.readiness.read(actor, id);
  }
}
