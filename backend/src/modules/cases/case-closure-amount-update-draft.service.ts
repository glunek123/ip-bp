import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { isDatabaseTransactionConflict } from '../../common/database-transaction-conflict';
import type { ActorContext } from '../../access-control/actor-context';
import type { AccessControlService } from '../../access-control/access-control.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import type { OrganizationService } from '../../access-control/organization.service';
import type { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import {
  updateClosureSettlementTermsInTransaction,
  type SettlementAssessmentPostgresDraft,
} from '../settlements';
import { ClosureAmountUpdateInput } from './case-closure-amount-update.dto';
import type { SettlementTermsChange } from './case-closure-settlement-update.dto';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const digest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Result = {
  caseId: string;
  closureVersionId: string;
  assessmentVersionId: string;
  termsVersion: number;
  change: SettlementTermsChange;
};
type Receipt = {
  case_id: string;
  request_fingerprint: string;
  closure_version_id: string;
  terms_version: number;
  assessment_version_id: string;
  audit_event_id: string;
  result_snapshot: Result;
  valid: boolean;
};

/** Source candidate. Requires the independent receipt table and deferred guards;
 * existing assessment gates remain closed pending database validation. */
export class CaseClosureAmountUpdateDraftService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
    private readonly assessments: Pick<
      SettlementAssessmentPostgresDraft,
      'executeInTransaction'
    >,
  ) {}

  async update(
    actor: ActorContext,
    caseId: string,
    value: ClosureAmountUpdateInput,
  ): Promise<Result> {
    const input = plainToInstance(ClosureAmountUpdateInput, value);
    if (
      !uuid.test(caseId) ||
      validateSync(input, { whitelist: true, forbidNonWhitelisted: true })
        .length
    )
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    if (
      actor.clientCustomerId !== undefined ||
      actor.lawyerAccountId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    actor = {
      ...actor,
      userId: actor.userId.toLowerCase(),
      departmentId: actor.departmentId.toLowerCase(),
    };
    caseId = caseId.toLowerCase();
    input.expectedClosureVersionId =
      input.expectedClosureVersionId.toLowerCase();
    input.expectedAssessmentVersionId =
      input.expectedAssessmentVersionId?.toLowerCase() ?? null;
    const fingerprint = digest([
      'CLOSURE_AMOUNT_UPDATE',
      caseId,
      input.expectedClosureVersionId,
      input.expectedTermsVersion,
      input.expectedAssessmentVersionId,
      input.idempotencyKey,
      [input.customerAmount.mode, input.customerAmount.amount ?? null],
      [input.lawyerAmount.mode, input.lawyerAmount.amount ?? null],
    ]);
    const childKey =
      'amount-assessment:' +
      digest([actor.departmentId, actor.userId, input.idempotencyKey]);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            await lockCustomerActorFacts(tx, this.organization, actor);
            const identities = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT u.id FROM user_accounts u JOIN department_memberships m ON m.user_id=u.id
             WHERE u.id=$1::uuid AND u.active AND u.account_type='INTERNAL' AND u.authorization_revision=$3
             AND m.department_id=$2::uuid AND m.active FOR SHARE OF u,m`,
              actor.userId,
              actor.departmentId,
              actor.authorizationRevision,
            );
            if (identities.length !== 1)
              throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT id FROM cases WHERE id=$1::uuid AND department_id=$2::uuid FOR UPDATE',
              caseId,
              actor.departmentId,
            );
            if (locked.length !== 1)
              throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
            const c = await tx.case.findFirst({
              where: { id: caseId, departmentId: actor.departmentId },
              include: {
                responsibleMembership: true,
                consolidationMembership: true,
                closure: true,
              },
            });
            if (!c) throw new NotFoundException({ code: 'CASE_NOT_FOUND' });
            if (c.consolidationMembership?.isMain === false)
              throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
            await this.access.authorizeCase(
              actor,
              'case.read',
              {
                departmentId: actor.departmentId,
                responsibleUserId: c.responsibleUserId,
                ...(c.responsibleMembership.teamId
                  ? { teamId: c.responsibleMembership.teamId }
                  : {}),
              },
              tx,
            );
            if (c.responsibleUserId !== actor.userId)
              await this.access.authorizeDepartmentProxyAction(
                actor,
                'case.closure.settlement.update',
                { departmentId: actor.departmentId },
                tx,
              );
            const receipts = await tx.$queryRawUnsafe<Receipt[]>(
              `SELECT r.case_id,r.request_fingerprint,r.closure_version_id,r.terms_version,
            r.assessment_version_id,r.audit_event_id,r.result_snapshot,
            EXISTS(SELECT 1 FROM audit_events a JOIN case_settlement_assessment_versions v ON v.id=r.assessment_version_id
              JOIN case_settlement_assessment_receipts ar ON ar.assessment_version_id=v.id
              WHERE a.id=r.audit_event_id AND a.department_id=r.department_id AND a.actor_user_id=r.actor_user_id
              AND a.internal_actor_user_id=r.actor_user_id AND a.resource_type='CASE' AND a.resource_id=r.case_id
              AND a.action='case.closure.settlement_amounts.updated' AND a.details->>'requestFingerprint'=r.request_fingerprint
              AND a.details->>'parentIdempotencyKey'=r.idempotency_key
              AND a.details->>'customerMode'=$5 AND a.details->>'lawyerMode'=$6
              AND a.details->'before'=r.result_snapshot#>'{change,before}'
              AND a.details->'after'=r.result_snapshot#>'{change,after}'
              AND v.case_id=r.case_id AND v.department_id=r.department_id AND v.closure_version_id=r.closure_version_id
              AND v.terms_version=r.terms_version AND v.recorded_by_user_id=r.actor_user_id
              AND ar.case_id=r.case_id AND ar.department_id=r.department_id AND ar.actor_user_id=r.actor_user_id
              AND ar.idempotency_key=$4 AND ar.audit_event_id=v.audit_event_id
              AND ar.result_snapshot->>'id'=v.id::text AND ar.result_snapshot->>'closureVersionId'=v.closure_version_id::text
              AND (ar.result_snapshot->>'termsVersion')::integer=v.terms_version) AS valid
            FROM case_closure_amount_update_receipts r WHERE r.department_id=$1::uuid AND r.actor_user_id=$2::uuid AND r.idempotency_key=$3`,
              actor.departmentId,
              actor.userId,
              input.idempotencyKey,
              childKey,
              input.customerAmount.mode,
              input.lawyerAmount.mode,
            );
            if (receipts.length) {
              const r = receipts[0]!,
                s = r.result_snapshot;
              if (r.case_id !== caseId || r.request_fingerprint !== fingerprint)
                throw new ConflictException({ code: 'IDEMPOTENCY_CONFLICT' });
              if (
                receipts.length !== 1 ||
                !r.valid ||
                !s ||
                s.caseId !== caseId ||
                s.closureVersionId !== r.closure_version_id ||
                s.assessmentVersionId !== r.assessment_version_id ||
                s.termsVersion !== r.terms_version ||
                !s.change ||
                s.change.auditEventId !== r.audit_event_id ||
                s.change.after.version !== r.terms_version
              )
                throw new ConflictException({ code: 'INVALID_RECEIPT' });
              for (const [field, command] of [
                ['customerManualAmount', input.customerAmount],
                ['lawyerManualAmount', input.lawyerAmount],
              ] as const) {
                const expected =
                  command.mode === 'KEEP'
                    ? s.change.before[field]
                    : command.mode === 'AUTOMATIC'
                      ? null
                      : new Prisma.Decimal(command.amount!).toFixed(2);
                if (s.change.after[field] !== expected)
                  throw new ConflictException({ code: 'INVALID_RECEIPT' });
              }
              if (
                s.change.before.version !== input.expectedTermsVersion ||
                r.terms_version !== (input.expectedTermsVersion ?? 0) + 1
              )
                throw new ConflictException({ code: 'INVALID_RECEIPT' });
              return s;
            }
            if (
              c.stage !== 'WAITING_ARCHIVE' ||
              c.closure?.currentVersionId !== input.expectedClosureVersionId
            )
              throw new ConflictException({ code: 'VERSION_CONFLICT' });
            const prior = await tx.$queryRawUnsafe<
              Array<{
                id: string;
                declaration: 'UNKNOWN' | 'APPLICABLE' | 'NOT_APPLICABLE';
              }>
            >(
              `SELECT id,declaration::text FROM case_settlement_assessment_versions WHERE case_id=$1::uuid AND department_id=$2::uuid
             ORDER BY revision DESC LIMIT 1 FOR UPDATE`,
              caseId,
              actor.departmentId,
            );
            if (
              (prior[0]?.id ?? null) !== input.expectedAssessmentVersionId ||
              prior.length > 1
            )
              throw new ConflictException({
                code: 'ASSESSMENT_VERSION_CONFLICT',
              });
            const declaration = prior[0]?.declaration ?? 'UNKNOWN';
            if (
              !['UNKNOWN', 'APPLICABLE', 'NOT_APPLICABLE'].includes(declaration)
            )
              throw new ConflictException({ code: 'INVALID_ASSESSMENT' });
            const terms = await updateClosureSettlementTermsInTransaction(
              tx,
              actor,
              caseId,
              {
                ...input,
                declaration,
                expectedAssessmentVersionId: input.expectedAssessmentVersionId,
              },
              { idempotencyKey: input.idempotencyKey, fingerprint },
            );
            if (!terms.change || terms.termsVersion === null)
              throw new ConflictException({ code: 'INVALID_TERMS_CHANGE' });
            const assessment = await this.assessments.executeInTransaction(
              tx,
              actor,
              { caseId, declaration, idempotencyKey: childKey },
            );
            if (
              assessment.caseId !== caseId ||
              assessment.departmentId !== actor.departmentId ||
              assessment.recordedByUserId !== actor.userId ||
              assessment.closureVersionId !== input.expectedClosureVersionId ||
              assessment.termsVersion !== terms.termsVersion ||
              assessment.priorVersionId !== input.expectedAssessmentVersionId ||
              assessment.declaration !== declaration
            )
              throw new ConflictException({ code: 'INVALID_ASSESSMENT' });
            const result: Result = {
              caseId,
              closureVersionId: input.expectedClosureVersionId,
              assessmentVersionId: assessment.id,
              termsVersion: terms.termsVersion,
              change: terms.change,
            };
            await tx.$executeRawUnsafe(
              `INSERT INTO case_closure_amount_update_receipts
            (id,department_id,actor_user_id,case_id,idempotency_key,request_fingerprint,closure_version_id,terms_version,assessment_version_id,audit_event_id,result_snapshot,created_at)
            VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7::uuid,$8,$9::uuid,$10::uuid,$11::jsonb,CURRENT_TIMESTAMP)`,
              randomUUID(),
              actor.departmentId,
              actor.userId,
              caseId,
              input.idempotencyKey,
              fingerprint,
              result.closureVersionId,
              result.termsVersion,
              result.assessmentVersionId,
              result.change.auditEventId,
              JSON.stringify(result),
            );
            if (c.responsibleUserId !== actor.userId)
              await tx.auditEvent.create({
                data: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  internalActorUserId: actor.userId,
                  resourceType: 'CASE',
                  resourceId: caseId,
                  action: 'case.proxy.applied',
                  details: {
                    responsibleUserId: c.responsibleUserId,
                    action: 'case.closure.settlement.update',
                    scope: 'DEPARTMENT',
                    requestFingerprint: fingerprint,
                  },
                },
              });
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            return result;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const retryable = isDatabaseTransactionConflict(error);
        if (!retryable || attempt === 2) throw error;
      }
    }
    throw new ConflictException({ code: 'RETRY_EXHAUSTED' });
  }
}
