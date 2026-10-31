import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { ActorContext } from '../../access-control/actor-context';
import { isDatabaseTransactionConflict } from '../../common/database-transaction-conflict';
import { CaseClosurePaymentPrismaDraft } from './case-closure-payment-prisma-draft';
import { CorrectCasePaymentInput } from './case-payment-correction.dto';

export class CasePaymentCorrectionService {
  constructor(private readonly payments: CaseClosurePaymentPrismaDraft) {}
  async correct(
    actor: ActorContext,
    caseId: string,
    value: CorrectCasePaymentInput,
  ) {
    const input = plainToInstance(CorrectCasePaymentInput, value);
    if (
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(caseId) ||
      validateSync(input, { whitelist: true, forbidNonWhitelisted: true })
        .length
    )
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    const base = {
      caseId,
      paymentId: input.paymentId,
      expectedVersionId: input.expectedVersionId,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
    };
    try {
      if (input.kind === 'VOID')
        return await this.payments.execute(actor, { ...base, kind: 'VOID' });
      // Validation above proves these four fields; preserve the caller's exact body for retry.
      if (
        input.paidOn === undefined ||
        input.amount === undefined ||
        input.payer === undefined ||
        input.payee === undefined
      )
        throw new BadRequestException({ code: 'VALIDATION_ERROR' });
      const today = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      if (
        input.paidOn > today ||
        new Date(input.paidOn).toISOString().slice(0, 10) !== input.paidOn
      )
        throw new BadRequestException({ code: 'INVALID_PAYMENT_DATE' });
      return await this.payments.execute(actor, {
        ...base,
        kind: 'CORRECT',
        paidOn: input.paidOn,
        amount: input.amount,
        payer: input.payer,
        payee: input.payee,
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isDatabaseTransactionConflict(error, { retryUnique: true }))
        throw new ConflictException({ code: 'PAYMENT_CHANGED' });
      if (error instanceof Error) {
        const code = error.message;
        if (code === 'ACTION_FORBIDDEN') throw new ForbiddenException({ code });
        if (
          ['PAYMENT_CHANGED', 'IDEMPOTENCY_CONFLICT', 'INVALID_STAGE'].includes(
            code,
          )
        )
          throw new ConflictException({ code });
        if (
          [
            'INVALID_UUID',
            'INVALID_IDEMPOTENCY_KEY',
            'INVALID_REASON',
            'INVALID_COMMAND',
            'INVALID_PAYMENT_DATE',
            'INVALID_AMOUNT',
            'INVALID_PARTY',
          ].includes(code)
        )
          throw new BadRequestException({ code });
      }
      throw error;
    }
  }
}
