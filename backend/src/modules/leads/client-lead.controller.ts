import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { ActorContext } from '../../access-control/actor-context';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  ClientLeadListQueryDto,
  ConfirmClientLeadWithdrawalDto,
  ReviewClientLeadDto,
} from './client-lead-review.dto';
import { ClientLeadService } from './client-lead.service';
import {
  ClientLeadListResponseDto,
  ClientLeadResponseDto,
  ClientLeadReviewResultDto,
  ClientLeadWithdrawalConfirmationResultDto,
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

  @Post(':id/reviews')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ClientLeadReviewResultDto })
  review(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ReviewClientLeadDto,
  ) {
    const key = idempotencyKey?.trim();
    if (key === undefined || key.length < 1 || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    return this.leads.review(actor, id, key, input);
  }

  @Post(':id/withdrawal-confirmations')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ClientLeadWithdrawalConfirmationResultDto })
  confirmWithdrawal(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ConfirmClientLeadWithdrawalDto,
  ) {
    const key = idempotencyKey?.trim();
    if (key === undefined || key.length < 1 || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    return this.leads.confirmWithdrawal(actor, id, key, input);
  }
}
