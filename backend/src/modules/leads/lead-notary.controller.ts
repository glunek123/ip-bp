import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
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
import {
  CreateNotaryOfficeDto,
  RecordNotaryEvidenceDto,
  RecordNotaryOpeningDto,
  ReviewNotaryOpeningDto,
  NotaryOpeningReviewResponseDto,
  SetNotaryOfficeStatusDto,
  TransferLeadToNotaryDto,
} from './lead-notary.dto';
import { LeadNotaryService } from './lead-notary.service';
import { NotaryOpeningService } from './notary-opening.service';
import { NotaryOpeningReviewService } from './notary-opening-review.service';
import { NotaryOfficeAccountService } from './notary-office-account.service';
import {
  CreateNotaryOfficeAccountDto,
  SetNotaryOfficeAccountStatusDto,
} from './notary-office-account.dto';
import {
  NotaryOfficeAccountListResponseDto,
  NotaryOfficeAccountResponseDto,
} from './notary-office-account-response.dto';
import { ApiOkResponse } from '@nestjs/swagger';

@ApiTags('notary-offices')
@ApiBearerAuth()
@Controller('notary-offices')
@UseGuards(ActorContextGuard, CsrfGuard)
export class NotaryOfficeController {
  constructor(
    private readonly notary: LeadNotaryService,
    private readonly accounts: NotaryOfficeAccountService,
  ) {}

  @Get(':id/accounts')
  @ApiOkResponse({ type: NotaryOfficeAccountListResponseDto })
  listAccounts(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.accounts.list(actor, id);
  }

  @Post(':id/accounts')
  @ApiCreatedResponse({ type: NotaryOfficeAccountResponseDto })
  createAccount(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CreateNotaryOfficeAccountDto,
  ) {
    return this.accounts.create(actor, id, input);
  }

  @Patch(':id/accounts/:userId/status')
  @ApiOkResponse({ type: NotaryOfficeAccountResponseDto })
  setAccountStatus(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() input: SetNotaryOfficeAccountStatusDto,
  ) {
    return this.accounts.setStatus(actor, id, userId, input.active);
  }

  @Get()
  list(@CurrentActor() actor: ActorContext) {
    return this.notary.listOffices(actor);
  }

  @Post()
  create(
    @CurrentActor() actor: ActorContext,
    @Body() input: CreateNotaryOfficeDto,
  ) {
    return this.notary.createOffice(actor, input);
  }

  @Patch(':id/status')
  deactivate(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: SetNotaryOfficeStatusDto,
  ) {
    return this.notary.deactivateOffice(actor, id, input);
  }
}

@ApiTags('notary-matters')
@ApiBearerAuth()
@Controller()
@UseGuards(ActorContextGuard, CsrfGuard)
export class LeadNotaryController {
  constructor(
    private readonly notary: LeadNotaryService,
    private readonly opening: NotaryOpeningService,
    private readonly openingReview: NotaryOpeningReviewService,
  ) {}

  @Post('leads/:id/notary-matters')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  transfer(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: TransferLeadToNotaryDto,
  ) {
    const key = idempotencyKey?.trim();
    if (key === undefined || key.length < 1 || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    return this.notary.transfer(actor, id, key, input);
  }

  @Get('notary-matters/:id')
  get(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notary.getMatter(actor, id);
  }

  @Post('notary-matters/:id/evidence')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  recordEvidence(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: RecordNotaryEvidenceDto,
  ) {
    const key = idempotencyKey?.trim();
    if (key === undefined || key.length < 1 || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    return this.notary.recordEvidence(actor, id, key, input);
  }

  @Post('notary-matters/:id/opening')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  recordOpening(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: RecordNotaryOpeningDto,
  ) {
    if (actor.notaryOfficeId !== undefined)
      throw new ForbiddenException({
        code: 'ACTION_FORBIDDEN',
        message: '请使用公证处开箱入口',
      });
    const key = idempotencyKey?.trim();
    if (key === undefined || key.length < 1 || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    return this.opening.record(actor, id, key, input);
  }

  @Post('notary-matters/:id/opening-review')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: NotaryOpeningReviewResponseDto })
  reviewOpening(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: ReviewNotaryOpeningDto,
  ) {
    const key = idempotencyKey?.trim();
    if (key === undefined || key.length < 1 || key.length > 128)
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key 必须为 1 至 128 个字符',
      });
    return this.openingReview.review(actor, id, key, input);
  }
}
