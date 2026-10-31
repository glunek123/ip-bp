import { CasePaymentCorrectionService } from './case-payment-correction.service';
import { CorrectCasePaymentInput } from './case-payment-correction.dto';
import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ActorContext } from '../../access-control/actor-context';
import { CurrentActor } from '../../access-control/actor-context.decorator';
import { ActorContextGuard } from '../../access-control/actor-context.guard';
import { CsrfGuard } from '../../auth/csrf.guard';
import { RecordEarlyClosureInput } from './case-early-closure.dto';
import { UpdateClosureSettlementInput } from './case-closure-settlement-update.dto';
import { SupplementCasePaymentProofInput } from './case-payment-proof-supplement.dto';
import { CaseEarlyClosureTransactionDraftService } from './case-early-closure-transaction-draft.service';
import { CaseClosureSettlementUpdateTransactionDraftService } from './case-closure-settlement-update-transaction-draft.service';
import { CasePaymentProofSupplementTransactionDraftService } from './case-payment-proof-supplement-transaction-draft.service';
import { ClosureAmountUpdateInput } from './case-closure-amount-update.dto';
import { CaseClosureAmountUpdateDraftService } from './case-closure-amount-update-draft.service';

// Authenticated case commands; each service rechecks ownership and transaction sources.
@ApiTags('cases')
@ApiBearerAuth()
@Controller('cases')
@UseGuards(ActorContextGuard, CsrfGuard)
export class CaseClosureCommandController {
  constructor(
    private readonly early: CaseEarlyClosureTransactionDraftService,
    private readonly settlement: CaseClosureSettlementUpdateTransactionDraftService,
    private readonly proof: CasePaymentProofSupplementTransactionDraftService,
    private readonly amounts: CaseClosureAmountUpdateDraftService,
    private readonly payments: CasePaymentCorrectionService,
  ) {}

  @Post(':id/payment-corrections')
  correctPayment(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: CorrectCasePaymentInput,
  ) {
    return this.payments.correct(actor, id, input);
  }

  @Post(':id/early-closure')
  record(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: RecordEarlyClosureInput,
  ) {
    return this.early.record(actor, id, input);
  }

  @Post(':id/closure-settlement-amounts')
  updateAmounts(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: ClosureAmountUpdateInput,
  ) {
    return this.amounts.update(actor, id, input);
  }

  @Post(':id/closure-settlement-updates')
  update(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateClosureSettlementInput,
  ) {
    return this.settlement.update(actor, id, input);
  }

  @Post(':id/payment-proof-supplements')
  supplement(
    @CurrentActor() actor: ActorContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: SupplementCasePaymentProofInput,
  ) {
    return this.proof.supplement(actor, id, input);
  }
}
