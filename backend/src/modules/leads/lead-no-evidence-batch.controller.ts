import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiTags,
} from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { LeadNoEvidenceBatchDto } from './lead-no-evidence-batch.dto';
import { LeadNoEvidenceBatchResponseDto } from './lead-no-evidence-batch-response.dto';
import { LeadService } from './lead.service';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadNoEvidenceBatchController {
  constructor(private readonly leads: LeadService) {}

  @Post('batch-no-evidence')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: LeadNoEvidenceBatchResponseDto })
  decide(
    @CurrentActor() actor: ActorContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: LeadNoEvidenceBatchDto,
  ): Promise<LeadNoEvidenceBatchResponseDto> {
    const idempotencyKey = key?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128)
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    return this.leads.decideNoEvidenceBatch(actor, idempotencyKey, input);
  }
}
