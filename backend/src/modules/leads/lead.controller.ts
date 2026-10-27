import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
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
import {
  ApplyLeadWithdrawalDto,
  DecideLeadEvidenceDto,
  CreateLeadDto,
  LeadListQueryDto,
  LeadFilterOptionsQueryDto,
  PushLeadDto,
  UpdateLeadDto,
  UpdateLeadProductScreenshotsDto,
} from './lead.dto';
import { LeadService } from './lead.service';
import { ClientLeadService } from './client-lead.service';
import { ConfirmClientLeadWithdrawalDto, ReviewClientLeadDto } from './client-lead-review.dto';
import { ClientLeadReviewResultDto, ClientLeadWithdrawalConfirmationResultDto } from './client-lead-response.dto';
import { LeadPushResponseDto } from './lead-push-response.dto';
import { LeadWithdrawalApplicationResponseDto } from './lead-withdrawal-application-response.dto';
import { LeadEvidenceDecisionResponseDto } from './lead-evidence-decision-response.dto';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadController {
  constructor(private readonly leads: LeadService, private readonly clientLeads?: ClientLeadService) {}

  @Get('form-context') formContext(@CurrentActor() actor: ActorContext) {
    return this.leads.formContext(actor);
  }
  @Get('filter-options') filterOptions(
    @CurrentActor() actor: ActorContext,
    @Query() query: LeadFilterOptionsQueryDto,
  ) {
    return this.leads.filterOptions(
      actor,
      query.kind,
      query.q,
      query.view,
      query.status,
      query.context,
      query.notaryStage,
    );
  }
  @Get() list(
    @CurrentActor() actor: ActorContext,
    @Query() query: LeadListQueryDto,
  ) {
    const filters = {
      customerId: query.customerId,
      rightsHolderId: query.rightsHolderId,
      shopName: query.shopName,
    };
    if (Object.values(filters).every((value) => value === undefined))
      return this.leads.list(
        actor,
        query.page,
        query.pageSize,
        query.status,
        query.view,
        query.q,
      );
    return this.leads.list(
      actor,
      query.page,
      query.pageSize,
      query.status,
      query.view,
      query.q,
      filters,
    );
  }
  @Get(':id/edit-context') editContext(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.leads.editContext(actor, id);
  }
  @Get(':id') get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.leads.get(actor, id);
  }

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @CurrentActor() actor: ActorContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreateLeadDto,
  ) {
    return this.leads.create(
      actor,
      this.requireIdempotencyKey(idempotencyKey),
      input,
    );
  }

  @Patch(':id')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateLeadDto,
  ) {
    return this.leads.update(actor, id, input);
  }

  @Put(':id/products/:productId/screenshots')
  updateProductScreenshots(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    @Body() input: UpdateLeadProductScreenshotsDto,
  ) {
    return this.leads.updateProductScreenshots(actor, id, productId, input);
  }

  @Post(':id/push')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: LeadPushResponseDto })
  push(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: PushLeadDto,
  ) {
    return this.leads.push(
      actor,
      id,
      this.requireIdempotencyKey(idempotencyKey),
      input,
    );
  }

  @Post(':id/proxy-reviews')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ClientLeadReviewResultDto })
  proxyReview(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ReviewClientLeadDto,
  ) {
    return this.clientLeads!.review(
      actor,
      id,
      this.requireIdempotencyKey(idempotencyKey),
      input,
      true,
    );
  }

  @Post(':id/proxy-withdrawal-confirmations')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: ClientLeadWithdrawalConfirmationResultDto })
  proxyConfirmWithdrawal(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ConfirmClientLeadWithdrawalDto,
  ) {
    return this.clientLeads!.confirmWithdrawal(
      actor,
      id,
      this.requireIdempotencyKey(idempotencyKey),
      input,
      true,
    );
  }

  @Post(':id/withdrawal-applications')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: LeadWithdrawalApplicationResponseDto })
  applyWithdrawal(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ApplyLeadWithdrawalDto,
  ) {
    return this.leads.applyWithdrawal(
      actor,
      id,
      this.requireIdempotencyKey(idempotencyKey),
      input,
    );
  }

  @Post(':id/evidence-decisions')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: LeadEvidenceDecisionResponseDto })
  decideEvidence(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: DecideLeadEvidenceDto,
  ) {
    return this.leads.decideEvidence(
      actor,
      id,
      this.requireIdempotencyKey(idempotencyKey),
      input,
    );
  }

  private requireIdempotencyKey(value: string | undefined) {
    const key = value?.trim();
    if (key === undefined || key.length < 1 || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    return key;
  }
}
