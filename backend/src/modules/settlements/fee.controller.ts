import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOkResponse,
  ApiCreatedResponse,
} from '@nestjs/swagger';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import type { ActorContext } from '../../access-control/actor-context';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import {
  CreateFeeDto,
  CancelFeeDto,
  CancelledFeePageDto,
  VerifyCancelledFeePaymentDto,
  ReconcileCancelledFeeRefundDto,
  FeeCaseOptionsDto,
  FeeIdsDto,
  FeePageDto,
  UpdateFeeDto,
  UpdateFeeProofDto,
} from './fee.dto';
import { FeeService } from './fee.service';
import { settlementResponses } from './settlement-openapi';

@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees')
@UseGuards(ActorContextGuard, CsrfGuard)
export class FeeController {
  constructor(private readonly service: FeeService) {}

  @Get()
  @ApiOkResponse({ schema: settlementResponses.fees })
  list(@CurrentActor() actor: ActorContext, @Query() query: FeePageDto) {
    return this.service.list(actor, query);
  }

  @Post()
  @ApiCreatedResponse({ schema: settlementResponses.feeReceipt })
  create(@CurrentActor() actor: ActorContext, @Body() input: CreateFeeDto) {
    return this.service.create(actor, input);
  }

  @Get('case-options')
  @ApiOkResponse({ schema: settlementResponses.feeCaseOptions })
  caseOptions(
    @CurrentActor() actor: ActorContext,
    @Query() query: FeeCaseOptionsDto,
  ) {
    return this.service.caseOptions(actor, query);
  }

  @Get('cancellations')
  @ApiOkResponse({ schema: settlementResponses.cancelledFees })
  cancellations(
    @CurrentActor() actor: ActorContext,
    @Query() query: CancelledFeePageDto,
  ) {
    return this.service.listCancellations(actor, query);
  }

  @Get(':feeId/history')
  @ApiOkResponse({ schema: settlementResponses.feeHistory })
  history(
    @CurrentActor() actor: ActorContext,
    @Param('feeId', new ParseUUIDPipe()) feeId: string,
  ) {
    return this.service.history(actor, feeId);
  }

  @Patch(':feeId')
  @ApiOkResponse({ schema: settlementResponses.feeReceipt })
  update(
    @CurrentActor() actor: ActorContext,
    @Param('feeId', new ParseUUIDPipe()) feeId: string,
    @Body() input: UpdateFeeDto,
  ) {
    return this.service.update(actor, feeId, input);
  }

  @Post('launch')
  @ApiCreatedResponse({ schema: settlementResponses.feeBatchReceipt })
  launch(@CurrentActor() actor: ActorContext, @Body() input: FeeIdsDto) {
    return this.service.batch(actor, 'LAUNCH', input);
  }

  @Post(':feeId/proof')
  @ApiCreatedResponse({ schema: settlementResponses.feeReceipt })
  updateProof(
    @CurrentActor() actor: ActorContext,
    @Param('feeId', new ParseUUIDPipe()) feeId: string,
    @Body() input: UpdateFeeProofDto,
  ) {
    return this.service.updateProof(actor, feeId, input);
  }

  @Post('delete')
  @ApiCreatedResponse({ schema: settlementResponses.feeBatchReceipt })
  delete(@CurrentActor() actor: ActorContext, @Body() input: FeeIdsDto) {
    return this.service.batch(actor, 'DELETE', input);
  }

  @Post(':feeId/cancel')
  @ApiCreatedResponse({ schema: settlementResponses.feeCancelReceipt })
  cancel(
    @CurrentActor() actor: ActorContext,
    @Param('feeId', new ParseUUIDPipe()) feeId: string,
    @Body() input: CancelFeeDto,
  ) {
    return this.service.cancel(actor, feeId, input);
  }

  @Post(':feeId/payment-verification')
  @ApiCreatedResponse({
    schema: settlementResponses.feePaymentVerificationReceipt,
  })
  verifyPayment(
    @CurrentActor() actor: ActorContext,
    @Param('feeId', new ParseUUIDPipe()) feeId: string,
    @Body() input: VerifyCancelledFeePaymentDto,
  ) {
    return this.service.verifyCancelledPayment(actor, feeId, input);
  }

  @Post(':feeId/refund-reconciliations')
  @ApiCreatedResponse({
    schema: settlementResponses.feeRefundReconciliationReceipt,
  })
  reconcileRefund(
    @CurrentActor() actor: ActorContext,
    @Param('feeId', new ParseUUIDPipe()) feeId: string,
    @Body() input: ReconcileCancelledFeeRefundDto,
  ) {
    return this.service.reconcileCancelledRefund(actor, feeId, input);
  }
}
