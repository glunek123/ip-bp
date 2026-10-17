import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import { LeadBatchPushDto } from './lead-batch-push.dto';
import { LeadBatchPushResponseDto } from './lead-batch-push-response.dto';
import { ApiCreatedResponse } from '@nestjs/swagger';
import { LeadService } from './lead.service';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadBatchPushController {
  constructor(private readonly leads: LeadService) {}

  @Post('batch-push')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: LeadBatchPushResponseDto })
  push(
    @CurrentActor() actor: ActorContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: LeadBatchPushDto,
  ) {
    const idempotencyKey = key?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128)
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    return this.leads.pushBatch(actor, idempotencyKey, input);
  }
}
