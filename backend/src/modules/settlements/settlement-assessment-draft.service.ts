import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ActorContext } from '../../access-control/actor-context';
import {
  calculateSettlement,
  SETTLEMENT_V2,
  type SettlementCalculationInput,
} from './settlement-calculation';

type Declaration = 'UNKNOWN' | 'APPLICABLE' | 'NOT_APPLICABLE';
type Inputs = Required<SettlementCalculationInput>;
export type LockedSettlementAssessmentSource = {
  caseId: string;
  departmentId: string;
  closureVersionId: string;
  currentClosureVersionId: string;
  termsVersion: number | null;
  inputs: Inputs;
  priorAssessment: { id: string; revision: number } | null;
};
export type SettlementAssessmentSnapshot = {
  id: string;
  caseId: string;
  departmentId: string;
  closureVersionId: string;
  termsVersion: number | null;
  revision: number;
  priorVersionId: string | null;
  declaration: Declaration;
  calculationInputs: Inputs;
  calculationRuleVersion: typeof SETTLEMENT_V2;
  calculationResult: ReturnType<typeof calculateSettlement> | null;
  customerAmount: string | null;
  lawyerAmount: string | null;
  auditEventId: string;
  recordedByUserId: string;
  recordedAt: string;
};

/** All methods must share ONE serializable transaction through the PostgreSQL adapter.
 * Authorization must lock current internal operator/membership/handling scope.
 * Source reads must lock the case, current closure head and settlement terms;
 * every competing terms/closure writer must participate in the same protocol.
 * Audit and append must commit atomically or roll back together.
 * This coordinator alone has no idempotency handling. The PostgreSQL
 * adapter wraps it with current authorization and exact-request replay/conflicts;
 * callers must use that adapter rather than expose this coordinator directly.
 */
export interface SettlementAssessmentDraftTransaction {
  authorizeInternalOperatorAndLockCase(
    actor: ActorContext,
    caseId: string,
  ): Promise<void>;
  currentLockedSource(
    caseId: string,
  ): Promise<LockedSettlementAssessmentSource>;
  audit(input: {
    actor: ActorContext;
    action: 'CASE_SETTLEMENT_ASSESSMENT_RECORD';
    resourceType: 'CASE_SETTLEMENT_ASSESSMENT_VERSION';
    resourceId: string;
    id: string;
    details: SettlementAssessmentSnapshot;
  }): Promise<void>;
  append(snapshot: SettlementAssessmentSnapshot): Promise<void>;
}
export interface SettlementAssessmentDraftStore {
  serializable<T>(
    work: (tx: SettlementAssessmentDraftTransaction) => Promise<T>,
  ): Promise<T>;
}

/** Coordinator: client supplies an explicit declaration, never amounts. */
export class SettlementAssessmentDraftService {
  constructor(private readonly store: SettlementAssessmentDraftStore) {}

  execute(
    actor: ActorContext,
    command: { caseId: string; declaration: Declaration },
  ) {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw new Error('ACTION_FORBIDDEN');
    if (
      !['UNKNOWN', 'APPLICABLE', 'NOT_APPLICABLE'].includes(command.declaration)
    )
      throw new ConflictException({
        code: 'SETTLEMENT_DECLARATION_INVALID',
        message: '结算声明无效',
      });
    return this.store.serializable(async (tx) => {
      await tx.authorizeInternalOperatorAndLockCase(actor, command.caseId);
      const source = await tx.currentLockedSource(command.caseId);
      if (
        source.caseId !== command.caseId ||
        source.departmentId !== actor.departmentId ||
        !source.closureVersionId ||
        source.closureVersionId !== source.currentClosureVersionId ||
        !['KNOWN', 'PENDING'].includes(source.inputs.closureAmountState) ||
        source.inputs.fallbackClaimAmount !== null ||
        (source.termsVersion !== null &&
          (!Number.isSafeInteger(source.termsVersion) ||
            source.termsVersion < 1)) ||
        (source.priorAssessment !== null &&
          (!Number.isSafeInteger(source.priorAssessment.revision) ||
            source.priorAssessment.revision < 1))
      )
        throw new ConflictException({
          code: 'SETTLEMENT_SOURCE_INVALID',
          message: '结案资料已变化，请重新读取后再保存',
        });
      const inputs = structuredClone(source.inputs);
      // Only an applicable declaration makes a claim about calculated amounts.
      // Unknown/not-applicable preserves raw source inputs, including legacy terms.
      const result =
        command.declaration === 'APPLICABLE'
          ? calculateSettlement(inputs)
          : null;
      if (
        command.declaration === 'APPLICABLE' &&
        (inputs.closureAmountState !== 'KNOWN' ||
          result?.customerAmount == null ||
          result.lawyerAmount === null)
      )
        throw new ConflictException({
          code: 'SETTLEMENT_AMOUNT_UNKNOWN',
          message: '结案金额尚未确认，不能声明涉及结算',
        });
      const snapshot: SettlementAssessmentSnapshot = {
        id: randomUUID(),
        caseId: source.caseId,
        departmentId: source.departmentId,
        closureVersionId: source.closureVersionId,
        termsVersion: source.termsVersion,
        revision: (source.priorAssessment?.revision ?? 0) + 1,
        priorVersionId: source.priorAssessment?.id ?? null,
        declaration: command.declaration,
        calculationInputs: inputs,
        calculationRuleVersion: SETTLEMENT_V2,
        calculationResult: result,
        customerAmount:
          command.declaration === 'APPLICABLE'
            ? (result?.customerAmount ?? null)
            : null,
        lawyerAmount:
          command.declaration === 'APPLICABLE'
            ? (result?.lawyerAmount ?? null)
            : null,
        auditEventId: randomUUID(),
        recordedByUserId: actor.userId,
        recordedAt: new Date().toISOString(),
      };
      await tx.audit({
        actor,
        action: 'CASE_SETTLEMENT_ASSESSMENT_RECORD',
        resourceType: 'CASE_SETTLEMENT_ASSESSMENT_VERSION',
        resourceId: snapshot.id,
        id: snapshot.auditEventId,
        details: structuredClone(snapshot),
      });
      await tx.append(snapshot);
      return snapshot;
    });
  }
}
