import { createHash, randomUUID } from 'node:crypto';
import type { ActorContext } from '../../access-control/actor-context';
import { checkArchivePayment } from './case-archive-payment-check';
import type { FinancialItemReview } from './case-closure-payment-financial-prisma-draft';

export type ClosurePaymentFact = {
  id: string;
  paymentId: string;
  revision: number;
  state: 'ACTIVE' | 'VOID';
  paidOn: string;
  amount: string;
  payer: string;
  payee: string;
};
export type CorrectClosurePaymentCommand = {
  caseId: string;
  paymentId: string;
  expectedVersionId: string;
  idempotencyKey: string;
  reason?: string | null;
} & (
  | { kind: 'VOID' }
  | {
      kind: 'CORRECT';
      paidOn: string;
      amount: string;
      payer: string;
      payee: string;
    }
);
export type PaymentReviewInput = {
  caseId: string;
  stage: 'WAITING_ARCHIVE' | 'ARCHIVED';
  closureVersionId: string;
  closureAmount: string | null;
  effectivePaymentVersionIds: string[];
  effectiveAmounts: string[];
  // The transaction adapter must supply current authorized financial sources.
  financialReadiness: 'PASSED' | 'BLOCKED' | 'UNKNOWN';
  // Optional only for historical receipt compatibility. New SQL adapter results
  // always include all three items; old receipts are never embellished on replay.
  financialItems?: {
    refund: FinancialItemReview;
    customer: FinancialItemReview;
    lawyer: FinancialItemReview;
  };
  financialSources?: {
    refundVersionId: string | null;
    assessmentVersionId: string | null;
    allocationIds: string[];
    countedCaseIds: string[];
  };
};
export type PaymentCorrectionResult = {
  versionId: string;
  stage: 'WAITING_ARCHIVE' | 'ARCHIVED';
  reviewRequired: boolean;
  review: PaymentReviewInput;
};
/** Adapter must implement all operations in ONE serializable transaction.
 * It must lock actor/account/membership authorization facts and case before reads,
 * enforce active INTERNAL operator + current authorization revision + same department
 * + own-case handling scope. A caller-supplied permission boolean is insufficient.
 * Absent receipt or financial provenance blocks use.
 */
export interface ClosurePaymentCorrectionTransaction {
  authorizeInternalOperatorAndLockCase(
    actor: ActorContext,
    caseId: string,
  ): Promise<void>;
  receipt(
    actor: ActorContext,
    key: string,
  ): Promise<{ fingerprint: string; result: PaymentCorrectionResult } | null>;
  latest(caseId: string, paymentId: string): Promise<ClosurePaymentFact | null>;
  append(
    input: ClosurePaymentFact & {
      caseId: string;
      departmentId: string;
      closureVersionId: string;
      priorVersionId: string;
      reason: string | null;
      recordedAt: Date;
      recordedByUserId: string;
      auditEventId: string;
    },
  ): Promise<void>;
  currentReview(caseId: string): Promise<PaymentReviewInput>;
  audit(input: {
    id: string;
    actor: ActorContext;
    caseId: string;
    versionId: string;
    priorVersionId: string;
    action: 'CASE_CLOSURE_PAYMENT_VOID' | 'CASE_CLOSURE_PAYMENT_CORRECT';
    recordedAt: Date;
    reason: string | null;
    fingerprint: string;
    result: PaymentCorrectionResult;
  }): Promise<void>;
  saveReceipt(
    actor: ActorContext,
    key: string,
    fingerprint: string,
    result: PaymentCorrectionResult,
  ): Promise<void>;
}
export interface ClosurePaymentCorrectionStore {
  /** Retry serialization failures with a bounded policy. Roll back every failed attempt. */
  serializable<T>(
    work: (tx: ClosurePaymentCorrectionTransaction) => Promise<T>,
  ): Promise<T>;
}
function reject(code: string): never {
  throw new Error(code);
}
export function validatePaymentFinancialItems(value: unknown): void {
  if (value === undefined) return;
  if (
    typeof value !== 'object' ||
    value === null ||
    !('refund' in value) ||
    !('customer' in value) ||
    !('lawyer' in value)
  )
    reject('INVALID_PAYMENT_FINANCIAL_ITEMS');
  for (const item of [value.refund, value.customer, value.lawyer]) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !('state' in item) ||
      !('reason' in item) ||
      typeof item.state !== 'string' ||
      !['PASSED', 'BLOCKED', 'UNKNOWN', 'EXEMPT'].includes(item.state) ||
      typeof item.reason !== 'string' ||
      !/^[A-Z][A-Z0-9_]{0,99}$/u.test(item.reason)
    )
      reject('INVALID_PAYMENT_FINANCIAL_ITEMS');
  }
}
function validate(command: CorrectClosurePaymentCommand) {
  if (!/^\S(?:[\s\S]{0,126}\S)?$/u.test(command.idempotencyKey))
    reject('INVALID_IDEMPOTENCY_KEY');
  if (
    command.reason !== undefined &&
    command.reason !== null &&
    command.reason.length > 500
  )
    reject('INVALID_REASON');
  if (command.kind !== 'CORRECT' && command.kind !== 'VOID')
    reject('INVALID_COMMAND');
  if (command.kind === 'CORRECT') {
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(command.paidOn) ||
      Number.isNaN(new Date(command.paidOn).getTime()) ||
      new Date(command.paidOn).toISOString().slice(0, 10) !== command.paidOn
    )
      reject('INVALID_PAYMENT_DATE');
    if (
      !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(command.amount) ||
      !/[1-9]/u.test(command.amount)
    )
      reject('INVALID_AMOUNT');
    for (const name of [command.payer, command.payee])
      if (!name.trim() || name.length > 200) reject('INVALID_PARTY');
  }
}
/** Appends payment history without changing cases or archive records. */
export class CaseClosurePaymentCorrectionDraftService {
  constructor(private readonly store: ClosurePaymentCorrectionStore) {}
  execute(
    actor: ActorContext,
    command: CorrectClosurePaymentCommand,
  ): Promise<PaymentCorrectionResult> {
    validate(command);
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      reject('ACTION_FORBIDDEN');
    const reason = command.reason?.trim() || null;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          command.caseId,
          command.paymentId,
          command.expectedVersionId,
          command.kind,
          reason,
          command.kind === 'CORRECT'
            ? [command.paidOn, command.amount, command.payer, command.payee]
            : null,
        ]),
      )
      .digest('hex');
    return this.store.serializable(async (tx) => {
      await tx.authorizeInternalOperatorAndLockCase(actor, command.caseId);
      const receipt = await tx.receipt(actor, command.idempotencyKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) reject('IDEMPOTENCY_CONFLICT');
        validatePaymentFinancialItems(receipt.result.review.financialItems);
        return receipt.result;
      }
      const prior = await tx.latest(command.caseId, command.paymentId);
      if (
        !prior ||
        prior.id !== command.expectedVersionId ||
        prior.state !== 'ACTIVE'
      )
        reject('PAYMENT_CHANGED');
      const before = await tx.currentReview(command.caseId);
      validatePaymentFinancialItems(before.financialItems);
      if (before.stage !== 'WAITING_ARCHIVE' && before.stage !== 'ARCHIVED')
        reject('INVALID_STAGE');
      const versionId = randomUUID();
      const auditEventId = randomUUID();
      const recordedAt = new Date();
      const index = before.effectivePaymentVersionIds.indexOf(prior.id);
      if (
        index < 0 ||
        before.effectiveAmounts.length !==
          before.effectivePaymentVersionIds.length
      )
        reject('INVALID_PAYMENT_REVIEW_SOURCE');
      const projectedReview = {
        ...before,
        effectivePaymentVersionIds: [...before.effectivePaymentVersionIds],
        effectiveAmounts: [...before.effectiveAmounts],
      };
      if (command.kind === 'VOID') {
        projectedReview.effectivePaymentVersionIds.splice(index, 1);
        projectedReview.effectiveAmounts.splice(index, 1);
      } else {
        projectedReview.effectivePaymentVersionIds[index] = versionId;
        projectedReview.effectiveAmounts[index] = command.amount;
      }
      const projectedPayment = checkArchivePayment(
        projectedReview.closureAmount,
        projectedReview.effectiveAmounts,
      );
      const projectedResult: PaymentCorrectionResult = {
        versionId,
        stage: before.stage,
        review: projectedReview,
        reviewRequired:
          before.stage === 'ARCHIVED' &&
          (projectedPayment.state === 'AMOUNT_UNKNOWN' ||
            projectedPayment.state === 'PAYMENT_INCOMPLETE' ||
            before.financialReadiness !== 'PASSED'),
      };
      await tx.audit({
        id: auditEventId,
        actor,
        caseId: command.caseId,
        versionId,
        fingerprint,
        result: projectedResult,
        priorVersionId: prior.id,
        recordedAt,
        reason,
        action:
          command.kind === 'VOID'
            ? 'CASE_CLOSURE_PAYMENT_VOID'
            : 'CASE_CLOSURE_PAYMENT_CORRECT',
      });
      await tx.append({
        ...prior,
        ...(command.kind === 'CORRECT'
          ? {
              paidOn: command.paidOn,
              amount: command.amount,
              payer: command.payer,
              payee: command.payee,
            }
          : {}),
        id: versionId,
        revision: prior.revision + 1,
        state: command.kind === 'VOID' ? 'VOID' : 'ACTIVE',
        caseId: command.caseId,
        departmentId: actor.departmentId,
        closureVersionId: before.closureVersionId,
        priorVersionId: prior.id,
        reason,
        recordedAt,
        recordedByUserId: actor.userId,
        auditEventId,
      });
      const review = await tx.currentReview(command.caseId);
      validatePaymentFinancialItems(review.financialItems);
      if (
        review.caseId !== command.caseId ||
        before.caseId !== command.caseId ||
        review.stage !== before.stage ||
        review.closureVersionId !== before.closureVersionId ||
        review.effectiveAmounts.length !==
          review.effectivePaymentVersionIds.length
      )
        reject('INVALID_PAYMENT_REVIEW_SOURCE');
      const payment = checkArchivePayment(
        review.closureAmount,
        review.effectiveAmounts,
      );
      const reviewRequired =
        review.stage === 'ARCHIVED' &&
        (payment.state === 'AMOUNT_UNKNOWN' ||
          payment.state === 'PAYMENT_INCOMPLETE' ||
          review.financialReadiness !== 'PASSED');
      const result = { versionId, stage: review.stage, reviewRequired, review };
      if (
        JSON.stringify(result.review) !== JSON.stringify(projectedReview) ||
        result.reviewRequired !== projectedResult.reviewRequired
      )
        reject('PAYMENT_RESULT_CHANGED');
      await tx.saveReceipt(actor, command.idempotencyKey, fingerprint, result);
      return result;
    });
  }
}
