import { isDatabaseTransactionConflict } from '../../common/database-transaction-conflict';
import {
  lockPaymentCaseScope,
  readPaymentFinancialReview,
  type PaymentFinancialSources,
} from './case-closure-payment-financial-prisma-draft';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client';
import type { DatabaseService } from '../../database/database.service';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import type { ActorContext } from '../../access-control/actor-context';
import {
  CaseClosurePaymentCorrectionDraftService,
  type ClosurePaymentCorrectionTransaction,
  type ClosurePaymentFact,
  type CorrectClosurePaymentCommand,
  type PaymentCorrectionResult,
  type PaymentReviewInput,
} from './case-closure-payment-correction-draft.service';
function fail(code: string): never {
  throw new Error(code);
}
/** Historical receipts may contain internal source evidence. Never return it. */
export function redactPaymentFinancialSources(
  result: PaymentCorrectionResult,
): PaymentCorrectionResult {
  const review = { ...result.review };
  delete review.financialSources;
  return { ...result, review };
}
export function assertPaymentReplayScope(
  scope: readonly string[] | null,
  recordedCaseIds: readonly string[] = [],
): void {
  if (scope === null || recordedCaseIds.some((id) => !scope.includes(id)))
    fail('ACTION_FORBIDDEN');
}
export function normalizePaymentUuid(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    fail('INVALID_UUID');
  return value.toLowerCase();
}
/** Serializable payment revision adapter. Reads financial sources in the same
 * transaction; missing, stale or unauthorized sources remain UNKNOWN. */
export class CaseClosurePaymentPrismaDraft {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}
  async execute(
    actor: ActorContext,
    command: CorrectClosurePaymentCommand,
  ): Promise<PaymentCorrectionResult> {
    actor = {
      ...actor,
      userId: normalizePaymentUuid(actor.userId),
      departmentId: normalizePaymentUuid(actor.departmentId),
    };
    command = {
      ...command,
      caseId: normalizePaymentUuid(command.caseId),
      paymentId: normalizePaymentUuid(command.paymentId),
      expectedVersionId: normalizePaymentUuid(command.expectedVersionId),
    };
    if (
      command.kind === 'CORRECT' &&
      /^(?:0|[1-9]\d{0,13})(?:\.\d{1,2})?$/u.test(command.amount)
    )
      command = {
        ...command,
        amount: new Prisma.Decimal(command.amount).toFixed(2),
      };
    for (let attempt = 0; ; attempt++) {
      try {
        const service = new CaseClosurePaymentCorrectionDraftService({
          serializable: (work) =>
            this.database.$transaction(
              async (db) => {
                let authorizedCaseIds: string[] | null = null;
                let internalFinancialSources:
                  PaymentFinancialSources | undefined;
                const tx: ClosurePaymentCorrectionTransaction = {
                  authorizeInternalOperatorAndLockCase: async (
                    currentActor,
                    caseId,
                  ) => {
                    if (
                      currentActor.clientCustomerId ||
                      currentActor.notaryOfficeId ||
                      currentActor.lawyerAccountId
                    )
                      fail('ACTION_FORBIDDEN');
                    await lockCustomerActorFacts(
                      db,
                      this.organization,
                      currentActor,
                    );
                    const users = await db.$queryRaw<
                      {
                        active: boolean;
                        account_type: string;
                        authorization_revision: number;
                      }[]
                    >`SELECT active,account_type,authorization_revision FROM user_accounts WHERE id=${currentActor.userId}::uuid FOR UPDATE`;
                    if (
                      !users[0]?.active ||
                      users[0].account_type !== 'INTERNAL' ||
                      users[0].authorization_revision !==
                        currentActor.authorizationRevision
                    )
                      fail('ACTION_FORBIDDEN');
                    const members = await db.$queryRaw<
                      { active: boolean }[]
                    >`SELECT active FROM department_memberships WHERE user_id=${currentActor.userId}::uuid AND department_id=${currentActor.departmentId}::uuid FOR UPDATE`;
                    if (!members[0]?.active) fail('ACTION_FORBIDDEN');
                    authorizedCaseIds = await lockPaymentCaseScope(
                      db,
                      currentActor,
                      caseId,
                    );
                    const cases = await db.$queryRaw<
                      { responsible_user_id: string; team_id: string | null }[]
                    >`SELECT c.responsible_user_id,m.team_id FROM cases c LEFT JOIN department_memberships m ON m.user_id=c.responsible_user_id AND m.department_id=c.department_id WHERE c.id=${caseId}::uuid AND c.department_id=${currentActor.departmentId}::uuid`;
                    if (
                      cases.length !== 1 ||
                      cases[0].responsible_user_id !== currentActor.userId
                    )
                      fail('ACTION_FORBIDDEN');
                    await this.access.authorizeCase(
                      currentActor,
                      'case.read',
                      {
                        departmentId: currentActor.departmentId,
                        responsibleUserId: cases[0].responsible_user_id,
                        ...(cases[0].team_id
                          ? { teamId: cases[0].team_id }
                          : {}),
                      },
                      db,
                    );
                  },
                  receipt: async (currentActor, key) => {
                    const rows = await db.$queryRaw<
                      {
                        request_fingerprint: string;
                        result_snapshot: PaymentCorrectionResult;
                      }[]
                    >`SELECT request_fingerprint,result_snapshot FROM case_closure_payment_receipts WHERE department_id=${currentActor.departmentId}::uuid AND actor_user_id=${currentActor.userId}::uuid AND idempotency_key=${key}`;
                    if (!rows[0]) return null;
                    assertPaymentReplayScope(authorizedCaseIds);
                    const result = rows[0].result_snapshot;
                    if (
                      !result ||
                      typeof result.versionId !== 'string' ||
                      typeof result.reviewRequired !== 'boolean' ||
                      !result.review ||
                      result.review.caseId !== command.caseId ||
                      !['ARCHIVED', 'WAITING_ARCHIVE'].includes(result.stage) ||
                      result.stage !== result.review.stage ||
                      !Array.isArray(result.review.effectiveAmounts) ||
                      !result.review.effectiveAmounts.every(
                        (v) => typeof v === 'string',
                      ) ||
                      !Array.isArray(
                        result.review.effectivePaymentVersionIds,
                      ) ||
                      !result.review.effectivePaymentVersionIds.every(
                        (v) => typeof v === 'string',
                      )
                    )
                      fail('INVALID_PAYMENT_RECEIPT');
                    if (result.review.financialSources) {
                      const recordedIds =
                        result.review.financialSources.countedCaseIds;
                      if (
                        !Array.isArray(recordedIds) ||
                        !recordedIds.every((id) => typeof id === 'string')
                      )
                        fail('INVALID_PAYMENT_RECEIPT');
                      assertPaymentReplayScope(authorizedCaseIds, recordedIds);
                    }
                    normalizePaymentUuid(result.versionId);
                    normalizePaymentUuid(result.review.caseId);
                    normalizePaymentUuid(result.review.closureVersionId);
                    result.review.effectivePaymentVersionIds.forEach(
                      normalizePaymentUuid,
                    );
                    const sources = await db.$queryRaw<
                      { valid: boolean }[]
                    >`SELECT EXISTS(SELECT 1 FROM case_closure_payment_receipts r JOIN case_closure_payment_versions p ON p.id=r.payment_version_id AND p.case_id=r.case_id AND p.department_id=r.department_id JOIN audit_events a ON a.id=p.audit_event_id WHERE r.department_id=${currentActor.departmentId}::uuid AND r.actor_user_id=${currentActor.userId}::uuid AND r.idempotency_key=${key} AND p.id=${result.versionId}::uuid AND p.closure_version_id=${result.review.closureVersionId}::uuid AND a.details->>'fingerprint'=r.request_fingerprint AND a.details->'result'=r.result_snapshot) AS valid`;
                    if (!sources[0]?.valid) fail('INVALID_PAYMENT_RECEIPT');
                    return {
                      fingerprint: rows[0].request_fingerprint,
                      result: redactPaymentFinancialSources(result),
                    };
                  },
                  latest: async (caseId, paymentId) => {
                    const rows = await db.$queryRaw<
                      ClosurePaymentFact[]
                    >`SELECT id,payment_id AS "paymentId",revision,state,paid_on::text AS "paidOn",amount::text AS amount,payer,payee FROM case_closure_payment_versions WHERE case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid AND payment_id=${paymentId}::uuid ORDER BY revision DESC LIMIT 1 FOR UPDATE`;
                    return rows[0] ?? null;
                  },
                  append: async (p) => {
                    const count =
                      await db.$executeRaw`INSERT INTO case_closure_payment_versions(id,payment_id,revision,prior_version_id,case_id,department_id,closure_version_id,state,paid_on,amount,payer,payee,reason,recorded_at,recorded_by_user_id,audit_event_id) SELECT ${p.id}::uuid,${p.paymentId}::uuid,${p.revision},${p.priorVersionId}::uuid,${p.caseId}::uuid,${p.departmentId}::uuid,${p.closureVersionId}::uuid,${p.state},${p.paidOn}::date,${p.amount}::numeric,${p.payer},${p.payee},${p.reason},${p.recordedAt},${p.recordedByUserId}::uuid,${p.auditEventId}::uuid WHERE EXISTS (SELECT 1 FROM case_closure_payment_versions prior WHERE prior.id=${p.priorVersionId}::uuid AND prior.case_id=${p.caseId}::uuid AND prior.department_id=${p.departmentId}::uuid AND prior.payment_id=${p.paymentId}::uuid AND prior.revision=${p.revision - 1} AND prior.state='ACTIVE' AND NOT EXISTS(SELECT 1 FROM case_closure_payment_versions successor WHERE successor.prior_version_id=prior.id))`;
                    if (count !== 1) fail('PAYMENT_CHANGED');
                  },
                  currentReview: async (caseId) => {
                    const closures = await db.$queryRaw<
                      {
                        stage: string;
                        closureVersionId: string;
                        closureAmount: string | null;
                      }[]
                    >`SELECT c.stage,v.id AS "closureVersionId",CASE WHEN v.close_amount_state='KNOWN' THEN v.close_amt::text ELSE NULL END AS "closureAmount" FROM cases c JOIN case_closures h ON h.case_id=c.id AND h.department_id=c.department_id JOIN case_closure_versions v ON v.id=h.current_version_id AND v.case_id=c.id AND v.department_id=c.department_id WHERE c.id=${caseId}::uuid AND c.department_id=${actor.departmentId}::uuid`;
                    const source = closures[0];
                    if (
                      !source ||
                      (source.stage !== 'ARCHIVED' &&
                        source.stage !== 'WAITING_ARCHIVE')
                    )
                      fail('INVALID_STAGE');
                    const payments = await db.$queryRaw<
                      { id: string; amount: string }[]
                    >`SELECT p.id,p.amount::text AS amount FROM case_closure_payment_versions p WHERE p.case_id=${caseId}::uuid AND p.department_id=${actor.departmentId}::uuid AND p.state='ACTIVE' AND NOT EXISTS(SELECT 1 FROM case_closure_payment_versions successor WHERE successor.prior_version_id=p.id) ORDER BY p.payment_id`;
                    const financial = await readPaymentFinancialReview(
                      db,
                      actor,
                      caseId,
                      authorizedCaseIds,
                    );
                    internalFinancialSources = financial.sources;
                    const review: PaymentReviewInput = {
                      caseId,
                      stage: source.stage,
                      closureVersionId: source.closureVersionId,
                      closureAmount: source.closureAmount,
                      effectivePaymentVersionIds: payments.map((p) => p.id),
                      effectiveAmounts: payments.map((p) => p.amount),
                      financialReadiness: financial.state,
                      financialItems: {
                        refund: financial.refund,
                        customer: financial.customer,
                        lawyer: financial.lawyer,
                      },
                    };
                    return review;
                  },
                  audit: async (a) => {
                    await db.$executeRaw`INSERT INTO audit_events(id,department_id,actor_kind,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details) VALUES (${a.id}::uuid,${a.actor.departmentId}::uuid,'HUMAN',${a.actor.userId}::uuid,${a.actor.userId}::uuid,'CASE_CLOSURE_PAYMENT_VERSION',${a.versionId}::uuid,${a.action},${JSON.stringify({ authorizationRevision: a.actor.authorizationRevision, caseId: a.caseId, priorVersionId: a.priorVersionId, versionId: a.versionId, paymentId: command.paymentId, kind: command.kind, ...(command.kind === 'CORRECT' ? { paidOn: command.paidOn, amount: command.amount, payer: command.payer, payee: command.payee } : {}), reason: a.reason, fingerprint: a.fingerprint, result: a.result, internalFinancialSources, recordedAt: a.recordedAt.toISOString() })}::jsonb)`;
                  },
                  saveReceipt: async (
                    currentActor,
                    key,
                    fingerprint,
                    result,
                  ) => {
                    const count =
                      await db.$executeRaw`INSERT INTO case_closure_payment_receipts(id,department_id,actor_user_id,case_id,payment_version_id,audit_event_id,idempotency_key,request_fingerprint,result_snapshot,created_at) SELECT ${randomUUID()}::uuid,${currentActor.departmentId}::uuid,${currentActor.userId}::uuid,p.case_id,p.id,p.audit_event_id,${key},${fingerprint},${JSON.stringify(result)}::jsonb,p.recorded_at FROM case_closure_payment_versions p WHERE p.id=${result.versionId}::uuid AND p.case_id=${command.caseId}::uuid AND p.department_id=${currentActor.departmentId}::uuid AND p.recorded_by_user_id=${currentActor.userId}::uuid`;
                    if (count !== 1) fail('INVALID_PAYMENT_RECEIPT');
                  },
                };
                const result = await work(tx);
                await db.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
                return result;
              },
              { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
            ),
        });
        return await service.execute(actor, command);
      } catch (error) {
        if (
          attempt < 2 &&
          isDatabaseTransactionConflict(error, { retryUnique: true })
        )
          continue;
        throw error;
      }
    }
  }
}
