import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isDatabaseTransactionConflict } from '../../common/database-transaction-conflict';
import type { ActorContext } from '../../access-control/actor-context';
import type { AccessControlService } from '../../access-control/access-control.service';
import type { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import type { DatabaseService } from '../../database/database.service';
import type { MaterialService } from '../materials';
import { SupplementCasePaymentProofInput } from './case-payment-proof-supplement.dto';

type SupplementResult = {
  id: string;
  caseId: string;
  paymentId: string;
  paymentVersionId: string;
  closureVersionId: string;
  stage: 'WAITING_ARCHIVE' | 'ARCHIVED';
  contentVersionIds: string[];
  recordedAt: string;
};
type StoredSupplement = {
  id: string;
  caseId: string;
  paymentId: string;
  paymentVersionId: string;
  closureVersionId: string;
  stage: string;
  contentVersionIds: string[];
  requestFingerprint: string;
  authorizationRevision: number;
  recordedAt: Date;
  resultSnapshot: unknown;
  auditDetails: unknown;
  immutableValid: boolean;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const fail = (code: string): never => {
  throw new ConflictException({ code });
};

/** Appends an independent, authorized payment-proof supplement.
 * Original payment versions, document sets and receipts are never modified. */
export class CasePaymentProofSupplementTransactionDraftService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
    private readonly materials: Pick<
      MaterialService,
      | 'assertAvailableVersions'
      | 'freezeCasePaymentProofSupplementReferencesDraft'
    >,
  ) {}

  async supplement(
    actor: ActorContext,
    caseId: string,
    value: SupplementCasePaymentProofInput,
  ): Promise<SupplementResult> {
    const input = plainToInstance(SupplementCasePaymentProofInput, value);
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
    // DTO rejects duplicates, including case variants. Sorting makes set order irrelevant.
    input.contentVersionIds.sort();
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          command: 'CASE_PAYMENT_PROOF_SUPPLEMENT',
          caseId,
          expectedClosureVersionId: input.expectedClosureVersionId,
          paymentId: input.paymentId,
          expectedPaymentVersionId: input.expectedPaymentVersionId,
          contentVersionIds: input.contentVersionIds,
          idempotencyKey: input.idempotencyKey,
        }),
      )
      .digest('hex');
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(
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
            if (locked.length !== 1) return fail('CASE_NOT_FOUND');
            const c = await tx.case.findFirst({
              where: { id: caseId, departmentId: actor.departmentId },
              include: { responsibleMembership: true, closure: true },
            });
            if (!c) return fail('CASE_NOT_FOUND');
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
            // Replay checks immutable evidence only; later payment corrections, heads and
            // material availability must not rewrite or invalidate the original response.
            const receipts = await tx.$queryRawUnsafe<StoredSupplement[]>(
              `SELECT s.id,s.case_id AS "caseId",s.payment_id AS "paymentId",s.payment_version_id AS "paymentVersionId",
              s.expected_closure_version_id AS "closureVersionId",s.stage,s.content_version_ids AS "contentVersionIds",
              s.request_fingerprint AS "requestFingerprint",s.authorization_revision AS "authorizationRevision",
              s.created_at AS "recordedAt",s.result_snapshot AS "resultSnapshot",a.details AS "auditDetails",
              (a.id IS NOT NULL AND a.department_id=s.department_id AND a.resource_type='CASE_PAYMENT_PROOF_SUPPLEMENT'
               AND a.resource_id=s.id AND a.action='CASE_PAYMENT_PROOF_SUPPLEMENTED' AND a.actor_kind='HUMAN'
               AND a.actor_user_id=s.actor_user_id AND a.internal_actor_user_id=s.actor_user_id
               AND a.customer_account_binding_id IS NULL AND a.lawyer_account_binding_id IS NULL AND a.notary_office_account_binding_id IS NULL
               AND EXISTS(SELECT 1 FROM case_closure_payment_versions p WHERE p.id=s.payment_version_id AND p.payment_id=s.payment_id
                 AND p.case_id=s.case_id AND p.department_id=s.department_id AND p.state='ACTIVE')
               AND EXISTS(SELECT 1 FROM case_closure_versions v WHERE v.id=s.expected_closure_version_id AND v.case_id=s.case_id AND v.department_id=s.department_id)
               AND (SELECT array_agg(d.content_version_id ORDER BY d.content_version_id) FROM case_payment_proof_supplement_documents d
                 WHERE d.supplement_id=s.id)=s.content_version_ids
               AND NOT EXISTS(SELECT 1 FROM case_payment_proof_supplement_documents d WHERE d.supplement_id=s.id AND
                 (d.case_id<>s.case_id OR d.department_id<>s.department_id OR d.payment_version_id<>s.payment_version_id
                  OR EXISTS(SELECT 1 FROM case_closure_payment_documents o WHERE o.payment_version_id=s.payment_version_id AND o.content_version_id=d.content_version_id)
                  OR NOT EXISTS(SELECT 1 FROM material_references r WHERE r.resource_type='case-payment-proof-supplement'
                   AND r.resource_id=s.id AND r.department_id=s.department_id AND r.material_id=d.material_id
                   AND r.content_version_id=d.content_version_id AND r.purpose='CASE_CLOSURE_PAYMENT_PROOF'
                   AND r.action_event_id=s.audit_event_id AND r.asset_version_id IS NULL)))
               AND (SELECT count(*) FROM material_references r WHERE r.resource_type='case-payment-proof-supplement' AND r.resource_id=s.id)=cardinality(s.content_version_ids)
              ) AS "immutableValid"
             FROM case_payment_proof_supplements s LEFT JOIN audit_events a ON a.id=s.audit_event_id
             WHERE s.department_id=$1::uuid AND s.actor_user_id=$2::uuid AND s.idempotency_key=$3`,
              actor.departmentId,
              actor.userId,
              input.idempotencyKey,
            );
            if (receipts.length > 1) return fail('INVALID_RECEIPT');
            const receipt = receipts[0];
            if (receipt) {
              if (
                receipt.caseId !== caseId ||
                receipt.requestFingerprint !== fingerprint
              )
                return fail('IDEMPOTENCY_CONFLICT');
              if (
                !receipt.immutableValid ||
                !uuid.test(receipt.id) ||
                receipt.paymentId !== input.paymentId ||
                receipt.paymentVersionId !== input.expectedPaymentVersionId ||
                receipt.closureVersionId !== input.expectedClosureVersionId ||
                (receipt.stage !== 'WAITING_ARCHIVE' &&
                  receipt.stage !== 'ARCHIVED') ||
                !isDeepStrictEqual(
                  receipt.contentVersionIds,
                  input.contentVersionIds,
                ) ||
                !(receipt.recordedAt instanceof Date) ||
                !Number.isFinite(receipt.recordedAt.getTime()) ||
                !Number.isInteger(receipt.authorizationRevision) ||
                receipt.authorizationRevision < 0
              )
                return fail('INVALID_RECEIPT');
              const result: SupplementResult = {
                id: receipt.id,
                caseId,
                paymentId: receipt.paymentId,
                paymentVersionId: receipt.paymentVersionId,
                closureVersionId: receipt.closureVersionId,
                stage: receipt.stage,
                contentVersionIds: receipt.contentVersionIds,
                recordedAt: receipt.recordedAt.toISOString(),
              };
              if (
                !isDeepStrictEqual(receipt.resultSnapshot, result) ||
                !isDeepStrictEqual(receipt.auditDetails, {
                  authorizationRevision: receipt.authorizationRevision,
                  idempotencyKey: input.idempotencyKey,
                  requestFingerprint: fingerprint,
                  result,
                })
              )
                return fail('INVALID_RECEIPT');
              return result;
            }
            if (c.stage !== 'WAITING_ARCHIVE' && c.stage !== 'ARCHIVED')
              return fail('INVALID_STAGE');
            if (c.closure?.currentVersionId !== input.expectedClosureVersionId)
              return fail('VERSION_CONFLICT');
            const payments = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT p.id FROM case_closure_payment_versions p WHERE p.id=$1::uuid AND p.payment_id=$2::uuid
             AND p.case_id=$3::uuid AND p.department_id=$4::uuid AND p.state='ACTIVE'
             AND NOT EXISTS(SELECT 1 FROM case_closure_payment_versions n WHERE n.prior_version_id=p.id) FOR UPDATE OF p`,
              input.expectedPaymentVersionId,
              input.paymentId,
              caseId,
              actor.departmentId,
            );
            if (payments.length !== 1) return fail('PAYMENT_VERSION_CONFLICT');
            const eligibility = await tx.$queryRawUnsafe<
              Array<{ eligible: boolean }>
            >(
              'SELECT case_payment_proof_upload_eligible($1::uuid,$2::uuid,$3::uuid) AS eligible',
              actor.userId,
              caseId,
              actor.departmentId,
            );
            if (eligibility[0]?.eligible !== true)
              throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
            const duplicates = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT content_version_id AS id FROM case_closure_payment_documents WHERE payment_version_id=$1::uuid AND content_version_id=ANY($2::uuid[])
             UNION ALL SELECT content_version_id AS id FROM case_payment_proof_supplement_documents WHERE payment_version_id=$1::uuid AND content_version_id=ANY($2::uuid[])`,
              input.expectedPaymentVersionId,
              input.contentVersionIds,
            );
            if (duplicates.length) return fail('PROOF_ALREADY_LINKED');
            const facts = await this.materials.assertAvailableVersions(
              tx,
              actor,
              {
                ownerType: 'CASE',
                ownerId: caseId,
                category: 'CASE_CLOSURE_PAYMENT_PROOF',
                contentVersionIds: input.contentVersionIds,
                minCount: 1,
                maxCount: 10,
              },
            );
            if (
              facts.length !== input.contentVersionIds.length ||
              new Set(facts.map((f) => f.contentVersionId)).size !==
                facts.length ||
              facts.some(
                (f) => !input.contentVersionIds.includes(f.contentVersionId),
              )
            )
              return fail('INVALID_MATERIAL_VERSION');
            const clocks = await tx.$queryRawUnsafe<
              Array<{ recordedAt: Date }>
            >('SELECT CURRENT_TIMESTAMP(3) AS "recordedAt"');
            const now = clocks[0]?.recordedAt;
            if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
              return fail('INVALID_TRANSACTION_CLOCK');
            const id = randomUUID(),
              auditEventId = randomUUID();
            const result: SupplementResult = {
              id,
              caseId,
              paymentId: input.paymentId,
              paymentVersionId: input.expectedPaymentVersionId,
              closureVersionId: input.expectedClosureVersionId,
              stage: c.stage,
              contentVersionIds: input.contentVersionIds,
              recordedAt: now.toISOString(),
            };
            await tx.auditEvent.create({
              data: {
                id: auditEventId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE_PAYMENT_PROOF_SUPPLEMENT',
                resourceId: id,
                action: 'CASE_PAYMENT_PROOF_SUPPLEMENTED',
                details: {
                  authorizationRevision: actor.authorizationRevision,
                  idempotencyKey: input.idempotencyKey,
                  requestFingerprint: fingerprint,
                  result,
                },
              },
            });
            await tx.$executeRawUnsafe(
              `INSERT INTO case_payment_proof_supplements
            (id,case_id,department_id,payment_id,payment_version_id,expected_closure_version_id,actor_user_id,authorization_revision,
             idempotency_key,request_fingerprint,content_version_ids,stage,audit_event_id,result_snapshot,created_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9,$10,$11::uuid[],$12,$13::uuid,$14::jsonb,$15)`,
              id,
              caseId,
              actor.departmentId,
              input.paymentId,
              input.expectedPaymentVersionId,
              input.expectedClosureVersionId,
              actor.userId,
              actor.authorizationRevision,
              input.idempotencyKey,
              fingerprint,
              input.contentVersionIds,
              c.stage,
              auditEventId,
              JSON.stringify(result),
              now,
            );
            for (const fact of facts)
              await tx.$executeRawUnsafe(
                `INSERT INTO case_payment_proof_supplement_documents
            (supplement_id,payment_version_id,case_id,department_id,material_id,content_version_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid)`,
                id,
                input.expectedPaymentVersionId,
                caseId,
                actor.departmentId,
                fact.materialId,
                fact.contentVersionId,
              );
            await this.materials.freezeCasePaymentProofSupplementReferencesDraft(
              tx,
              actor,
              caseId,
              input.expectedPaymentVersionId,
              id,
              facts,
              auditEventId,
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
          { isolationLevel: 'Serializable' },
        );
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
