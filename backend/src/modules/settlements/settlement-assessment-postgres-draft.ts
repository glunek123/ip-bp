import { createHash, randomUUID } from 'node:crypto';
import type { ActorContext } from '../../access-control/actor-context';
import { AccessControlService } from '../../access-control/access-control.service';
import { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import {
  SettlementAssessmentDraftService,
  type LockedSettlementAssessmentSource,
  type SettlementAssessmentSnapshot,
} from './settlement-assessment-draft.service';

type Command = {
  caseId: string;
  declaration: SettlementAssessmentSnapshot['declaration'];
  idempotencyKey: string;
};
function canonicalUuid(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
      value,
    )
  )
    throw new Error('INVALID_ASSESSMENT_ID');
  return value.toLowerCase();
}
export type AssessmentCompositionContext = Readonly<{
  requestFingerprint: string;
  childIdempotencyKey: string;
  parentIdempotencyKey: string;
  expectedAssessmentVersionId: string | null;
  expectedTermsVersion: number | null;
}>;
const assessmentCompositionContexts =
  new WeakSet<AssessmentCompositionContext>();
/** Server-only factory. Never populate from an HTTP body's trusted/hash fields.
 * Parent computes the complete canonical-request hash itself and must persist the
 * exact parent audit/receipt required by migration 1600 in this same transaction.
 * The deferred parent constraints, not this capability, prove that final binding.
 */
export function createAssessmentCompositionContext(input: {
  requestFingerprint: string;
  parentIdempotencyKey: string;
  expectedAssessmentVersionId: string | null;
  expectedTermsVersion: number | null;
}): AssessmentCompositionContext {
  if (
    !/^[a-f0-9]{64}$/u.test(input.requestFingerprint) ||
    !/^\S(?:[\s\S]{0,126}\S)?$/u.test(input.parentIdempotencyKey) ||
    (input.expectedTermsVersion !== null &&
      (!Number.isSafeInteger(input.expectedTermsVersion) ||
        input.expectedTermsVersion < 1))
  )
    throw new Error('INVALID_ASSESSMENT_COMPOSITION');
  const context: AssessmentCompositionContext = Object.freeze({
    requestFingerprint: input.requestFingerprint,
    parentIdempotencyKey: input.parentIdempotencyKey,
    childIdempotencyKey:
      'assessment:' +
      createHash('sha256')
        .update(input.parentIdempotencyKey, 'utf8')
        .digest('hex'),
    expectedAssessmentVersionId:
      input.expectedAssessmentVersionId === null
        ? null
        : canonicalUuid(input.expectedAssessmentVersionId),
    expectedTermsVersion: input.expectedTermsVersion,
  });
  assessmentCompositionContexts.add(context);
  return context;
}

function validateSnapshotIds(
  snapshot: SettlementAssessmentSnapshot,
  actor: ActorContext,
  caseId: string,
) {
  for (const id of [
    snapshot.id,
    snapshot.caseId,
    snapshot.departmentId,
    snapshot.closureVersionId,
    snapshot.auditEventId,
    snapshot.recordedByUserId,
    ...(snapshot.priorVersionId === null ? [] : [snapshot.priorVersionId]),
  ]) {
    if (canonicalUuid(id) !== id)
      throw new Error('INVALID_ASSESSMENT_RECEIPT_SOURCE');
  }
  if (
    snapshot.caseId !== caseId ||
    snapshot.departmentId !== actor.departmentId ||
    snapshot.recordedByUserId !== actor.userId
  )
    throw new Error('INVALID_ASSESSMENT_RECEIPT_SOURCE');
}

/** UNREGISTERED PostgreSQL adapter draft. All persistence gates stay closed.
 * A real invocation is expected to fail at the gate; no database execution has
 * validated this code. Do not register until migrations, rollback and concurrent
 * authorization/source changes have been tested on an explicitly authorized DB.
 */
export class SettlementAssessmentPostgresDraft {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
  ) {}

  private async authorize(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
  ) {
    if (actor.clientCustomerId || actor.notaryOfficeId || actor.lawyerAccountId)
      throw new Error('ACTION_FORBIDDEN');
    await lockCustomerActorFacts(tx, this.organization, actor);
    const account = await tx.userAccount.findUnique({
      where: { id: actor.userId },
      select: { active: true, accountType: true },
    });
    if (!account?.active || account.accountType !== 'INTERNAL')
      throw new Error('ACTION_FORBIDDEN');
    const cases = await tx.$queryRaw<
      Array<{
        responsible_user_id: string;
        stage: string;
        team_id?: string | null;
      }>
    >`
      SELECT responsible_user_id,stage::text,
       (SELECT m.team_id FROM department_memberships m
        WHERE m.user_id=cases.responsible_user_id AND m.department_id=cases.department_id) AS team_id FROM cases
      WHERE id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid FOR UPDATE`;
    if (cases.length !== 1) throw new Error('CASE_NOT_FOUND');
    if (cases[0].responsible_user_id !== actor.userId)
      throw new Error('ACTION_FORBIDDEN');
    await this.access.authorizeCase(
      actor,
      'case.read',
      {
        departmentId: actor.departmentId,
        responsibleUserId: cases[0].responsible_user_id,
        ...(cases[0].team_id ? { teamId: cases[0].team_id } : {}),
      },
      tx,
    );
    if (!['WAITING_ARCHIVE', 'ARCHIVED'].includes(cases[0].stage))
      throw new Error('INVALID_STAGE');
  }

  private async source(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    caseId: string,
  ): Promise<LockedSettlementAssessmentSource> {
    const closures = await tx.$queryRaw<
      Array<{ id: string; amount: string | null; state: 'KNOWN' | 'PENDING' }>
    >`
      SELECT v.id,v.close_amt::text AS amount,v.close_amount_state::text AS state
      FROM case_closures h JOIN case_closure_versions v
       ON v.id=h.current_version_id AND v.case_id=h.case_id AND v.department_id=h.department_id
      WHERE h.case_id=${caseId}::uuid AND h.department_id=${actor.departmentId}::uuid FOR UPDATE OF h,v`;
    if (closures.length !== 1) throw new Error('CLOSURE_SOURCE_MISSING');
    const terms = await tx.$queryRaw<
      Array<{
        version: number;
        customer_formula: string | null;
        lawyer_mode: 'FULL_RISK' | 'HALF_RISK' | 'FIXED_FEE' | null;
        lawyer_base_fee: string | null;
        lawyer_split_percent: string | null;
        customer_manual_amount: string | null;
        lawyer_manual_amount: string | null;
      }>
    >`SELECT version,customer_formula,lawyer_mode::text,
      lawyer_base_fee::text,lawyer_split_percent::text,customer_manual_amount::text,lawyer_manual_amount::text
      FROM case_settlement_terms WHERE case_id=${caseId}::uuid
       AND department_id=${actor.departmentId}::uuid FOR UPDATE`;
    const prior = await tx.$queryRaw<Array<{ id: string; revision: number }>>`
      SELECT id,revision FROM case_settlement_assessment_versions
      WHERE case_id=${caseId}::uuid AND department_id=${actor.departmentId}::uuid
      ORDER BY revision DESC LIMIT 1 FOR UPDATE`;
    const c = closures[0];
    const t = terms[0];
    if (
      canonicalUuid(c.id) !== c.id ||
      (prior[0] && canonicalUuid(prior[0].id) !== prior[0].id)
    )
      throw new Error('INVALID_SETTLEMENT_ASSESSMENT_SOURCE');
    return {
      caseId,
      departmentId: actor.departmentId,
      closureVersionId: c.id,
      currentClosureVersionId: c.id,
      termsVersion: t?.version ?? null,
      priorAssessment: prior[0] ?? null,
      inputs: {
        closureAmount: c.amount,
        closureAmountState: c.state,
        fallbackClaimAmount: null,
        customerFormula: t?.customer_formula ?? null,
        lawyerMode: t?.lawyer_mode ?? null,
        lawyerBaseFee: t?.lawyer_base_fee ?? null,
        lawyerSplitPercent: t?.lawyer_split_percent ?? null,
        customerManualAmount: t?.customer_manual_amount ?? null,
        lawyerManualAmount: t?.lawyer_manual_amount ?? null,
      },
    };
  }

  async execute(
    actor: ActorContext,
    command: Command,
  ): Promise<SettlementAssessmentSnapshot> {
    actor = {
      ...actor,
      userId: canonicalUuid(actor.userId),
      departmentId: canonicalUuid(actor.departmentId),
    };
    command = { ...command, caseId: canonicalUuid(command.caseId) };
    if (!/^\S(?:[\s\S]{0,126}\S)?$/u.test(command.idempotencyKey))
      throw new Error('INVALID_IDEMPOTENCY_KEY');
    if (
      !['UNKNOWN', 'APPLICABLE', 'NOT_APPLICABLE'].includes(command.declaration)
    )
      throw new Error('INVALID_SETTLEMENT_DECLARATION');
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            return this.executeInTransaction(tx, actor, command);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2034' ||
            (error.code === 'P2010' &&
              (error.meta?.code === '55P03' ||
                error.meta?.code === '40001' ||
                error.meta?.code === '40P01')));
        if (!retryable || attempt === 2) throw error;
      }
    }
    throw new Error('SETTLEMENT_ASSESSMENT_RETRY_EXHAUSTED');
  }

  /** Internal composition entry: caller owns the SERIALIZABLE transaction and
   * full rollback/retry boundary. Never commits, starts a transaction, or catches
   * failures; all current authorization and receipt checks still run here. */
  async executeInTransaction(
    tx: Prisma.TransactionClient,
    actor: ActorContext,
    command: Command,
    composition?: AssessmentCompositionContext,
  ): Promise<SettlementAssessmentSnapshot> {
    if (
      composition !== undefined &&
      !assessmentCompositionContexts.has(composition)
    )
      throw new Error('INVALID_ASSESSMENT_COMPOSITION');
    actor = {
      ...actor,
      userId: canonicalUuid(actor.userId),
      departmentId: canonicalUuid(actor.departmentId),
    };
    command = { ...command, caseId: canonicalUuid(command.caseId) };
    if (composition)
      command = { ...command, idempotencyKey: composition.childIdempotencyKey };
    if (!/^\S(?:[\s\S]{0,126}\S)?$/u.test(command.idempotencyKey))
      throw new Error('INVALID_IDEMPOTENCY_KEY');
    if (
      !['UNKNOWN', 'APPLICABLE', 'NOT_APPLICABLE'].includes(command.declaration)
    )
      throw new Error('INVALID_SETTLEMENT_DECLARATION');
    const fingerprint =
      composition?.requestFingerprint ??
      createHash('sha256')
        .update(
          JSON.stringify([
            'CASE_SETTLEMENT_ASSESSMENT_RECORD',
            command.caseId,
            command.declaration,
          ]),
        )
        .digest('hex');
    // Current authorization precedes receipt lookup even for exact retries.
    await this.authorize(tx, actor, command.caseId);
    const receipts = await tx.$queryRaw<
      Array<{
        case_id: string;
        request_fingerprint: string;
        result_snapshot: SettlementAssessmentSnapshot;
      }>
    >`SELECT case_id,request_fingerprint,result_snapshot FROM case_settlement_assessment_receipts
            WHERE department_id=${actor.departmentId}::uuid AND actor_user_id=${actor.userId}::uuid
             AND idempotency_key=${command.idempotencyKey}`;
    if (receipts.length) {
      // Only the parent coordinator may replay a complete composite command.
      // Reusing an old child would skip its same-transaction parent link and
      // cannot satisfy the 1600/1700 prospective provenance contract.
      if (composition)
        throw new Error('COMPOSED_ASSESSMENT_REQUIRES_PARENT_REPLAY');
      const receipt = receipts[0];
      if (
        receipt.case_id !== command.caseId ||
        receipt.request_fingerprint !== fingerprint
      )
        throw new Error('IDEMPOTENCY_CONFLICT');
      validateSnapshotIds(receipt.result_snapshot, actor, command.caseId);
      return receipt.result_snapshot;
    }
    const coordinator = new SettlementAssessmentDraftService({
      serializable: async (work) =>
        work({
          authorizeInternalOperatorAndLockCase: async () => {
            /* already locked above */
          },
          currentLockedSource: async () => {
            const source = await this.source(tx, actor, command.caseId);
            if (
              composition &&
              (source.priorAssessment?.id ?? null) !==
                composition.expectedAssessmentVersionId
            )
              throw new Error('ASSESSMENT_VERSION_CONFLICT');
            if (
              composition &&
              source.termsVersion !== composition.expectedTermsVersion
            )
              throw new Error('SETTLEMENT_TERMS_VERSION_CONFLICT');
            return source;
          },
          audit: async (input) => {
            await tx.$executeRaw`INSERT INTO audit_events
                (id,department_id,actor_kind,actor_user_id,internal_actor_user_id,resource_type,resource_id,action,details)
                VALUES (${input.id}::uuid,${actor.departmentId}::uuid,'HUMAN',${actor.userId}::uuid,
                 ${actor.userId}::uuid,${input.resourceType},${input.resourceId}::uuid,${input.action},
                 ${JSON.stringify({ ...input.details, requestFingerprint: fingerprint, authorizationRevision: actor.authorizationRevision })}::jsonb)`;
          },
          append: async (s) => {
            const customerSource =
              s.calculationInputs.customerManualAmount === null
                ? 'AUTOMATIC'
                : 'MANUAL';
            const lawyerSource =
              s.calculationInputs.lawyerManualAmount === null
                ? 'AUTOMATIC'
                : 'MANUAL';
            await tx.$executeRaw`INSERT INTO case_settlement_assessment_versions
                (id,case_id,department_id,revision,prior_version_id,closure_version_id,terms_version,declaration,
                 calculation_inputs,calculation_rule_version,customer_source,lawyer_source,customer_amount,
                 lawyer_amount,recorded_by_user_id,audit_event_id,recorded_at)
                VALUES (${s.id}::uuid,${s.caseId}::uuid,${s.departmentId}::uuid,${s.revision},${s.priorVersionId}::uuid,
                 ${s.closureVersionId}::uuid,${s.termsVersion},${s.declaration},${JSON.stringify(s.calculationInputs)}::jsonb,
                 ${s.calculationRuleVersion},${customerSource},${lawyerSource},${s.customerAmount}::numeric,
                 ${s.lawyerAmount}::numeric,${s.recordedByUserId}::uuid,${s.auditEventId}::uuid,${s.recordedAt}::timestamptz)`;
          },
        }),
    });
    const result = await coordinator.execute(actor, command);
    validateSnapshotIds(result, actor, command.caseId);
    await tx.$executeRaw`INSERT INTO case_settlement_assessment_receipts
            (id,department_id,actor_user_id,case_id,assessment_version_id,audit_event_id,idempotency_key,request_fingerprint,result_snapshot,created_at)
            VALUES (${randomUUID()}::uuid,${actor.departmentId}::uuid,${actor.userId}::uuid,${command.caseId}::uuid,
             ${result.id}::uuid,${result.auditEventId}::uuid,${command.idempotencyKey},${fingerprint},${JSON.stringify(result)}::jsonb,${result.recordedAt}::timestamptz)`;
    if (composition) {
      // Migration 1700 defers exact parent receipt/audit verification until commit.
      // A composed child cannot commit through this path without that parent;
      // this link and all child writes still have closed persistence gates.
      await tx.$executeRaw`INSERT INTO case_settlement_update_child_links
        (kind,child_version_id,case_id,department_id,actor_user_id,parent_key,request_fingerprint)
        VALUES ('ASSESSMENT',${result.id}::uuid,${command.caseId}::uuid,${actor.departmentId}::uuid,
          ${actor.userId}::uuid,${composition.parentIdempotencyKey},${fingerprint})`;
    }
    return result;
  }
}
