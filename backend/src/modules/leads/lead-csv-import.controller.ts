import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Post,
  UseGuards,
  UseInterceptors,
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
import type { Observable } from 'rxjs';

@Injectable()
export class LeadCsvImportBodyLimitInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ body: unknown }>();
    const compact = JSON.stringify(request.body);
    if (
      typeof compact !== 'string' ||
      Buffer.byteLength(compact, 'utf8') > 92_160
    )
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    return next.handle();
  }
}

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadCsvImportController {
  constructor(private readonly leads: LeadService) {}

  @Post('csv-import')
  @UseInterceptors(LeadCsvImportBodyLimitInterceptor)
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
