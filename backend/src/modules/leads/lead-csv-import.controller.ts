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
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import { LeadCsvImportDto } from './lead-csv-import.dto';
import { LeadCsvImportResponseDto } from './lead-csv-import-response.dto';
import { LeadService } from './lead.service';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadCsvImportController {
  constructor(private readonly leads: LeadService) {}

  @Post('csv-import')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: LeadCsvImportResponseDto })
  importBatch(
    @CurrentActor() actor: ActorContext,
    @Headers('idempotency-key') key: string | undefined,
    @Body() input: LeadCsvImportDto,
  ) {
    const idempotencyKey = key?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128)
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    return this.leads.importBatch(actor, idempotencyKey, input);
  }
}
