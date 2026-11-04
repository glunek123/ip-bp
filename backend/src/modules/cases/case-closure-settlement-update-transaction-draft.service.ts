import { normalizeRefundAmount } from './case-refund-inventory-draft.service';
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
import type { OrganizationService } from '../../access-control/organization.service';
import { lockCustomerActorFacts } from '../../access-control/customer-actor-facts-lock';
import type { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import type { MaterialService } from '../materials';
import {
  createAssessmentCompositionContext,
  updateClosureSettlementTermsInTransaction,
  type SettlementAssessmentPostgresDraft,
} from '../settlements';
import {
  createRefundCompositionContext,
  type CaseRefundInventoryPrismaDraft,
} from './case-refund-inventory-prisma-draft';
import type { RefundInventoryDraftCommand } from './case-refund-inventory-draft.service';
import {
  UpdateClosureSettlementInput,
  type ClosureSettlementUpdateResult,
  type SettlementTermsChange,
} from './case-closure-settlement-update.dto';
import { readCaseSourceAnchor } from './case-entry-source';
import { assertExecutionSourceChain } from './case-execution-source';

const fail = (code: string): never => {
  if (code === 'CASE_NOT_FOUND') throw new NotFoundException({ code });
  throw new ConflictException({ code });
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
function readTermsChange(value: unknown): SettlementTermsChange | null {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== 'object' ||
    !('auditEventId' in value) ||
    typeof value.auditEventId !== 'string' ||
    !uuid.test(value.auditEventId) ||
    !('before' in value) ||
    !('after' in value)
  )
    return fail('INVALID_RECEIPT');
  const state = (v: unknown) => {
    if (
      !v ||
      typeof v !== 'object' ||
      !('version' in v) ||
      !(
        v.version === null ||
        (typeof v.version === 'number' &&
          Number.isInteger(v.version) &&
          v.version > 0)
      ) ||
      !('customerManualAmount' in v) ||
      !('lawyerManualAmount' in v)
    )
      return fail('INVALID_RECEIPT');
    const amount = (x: unknown): string | null =>
      x === null
        ? null
        : typeof x === 'string' && /^(0|[1-9]\d{0,15})\.\d{2}$/u.test(x)
          ? x
          : fail('INVALID_RECEIPT');
    return {
      version: v.version,
      customerManualAmount: amount(v.customerManualAmount),
      lawyerManualAmount: amount(v.lawyerManualAmount),
    };
  };
  const before = state(value.before),
    after = state(value.after);
  if (after.version === null || after.version !== (before.version ?? 0) + 1)
    return fail('INVALID_RECEIPT');
  return {
    auditEventId: value.auditEventId,
    before,
    after: { ...after, version: after.version },
  };
}
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (
    a &&
    b &&
    typeof a === 'object' &&
    typeof b === 'object' &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const left = Object.entries(a),
      right = Object.entries(b);
    return (
      left.length === right.length &&
      left.every(([k, v]) =>
        right.some(([key, val]) => key === k && same(v, val)),
      )
    );
  }
  return false;
};

/** Commits settlement updates as one serializable transaction. The caller receives
 * no success until all facts, child bindings and deferred constraints have passed. */
export class CaseClosureSettlementUpdateTransactionDraftService {
  constructor(
    private readonly database: DatabaseService,
    private readonly access: AccessControlService,
    private readonly organization: OrganizationService,
    private readonly materials: Pick<
      MaterialService,
      | 'assertAvailableVersions'
      | 'assertSettlementUpdateDocumentVersions'
      | 'freezeCaseClosureReferences'
      | 'freezeCaseClosurePaymentReferences'
    >,
    private readonly refunds: Pick<
      CaseRefundInventoryPrismaDraft,
      'executeInTransaction'
    >,
    private readonly assessments: Pick<
      SettlementAssessmentPostgresDraft,
      'executeInTransaction'
    >,
  ) {}

  async update(
    actor: ActorContext,
    caseId: string,
    value: UpdateClosureSettlementInput,
  ): Promise<ClosureSettlementUpdateResult> {
    const input = plainToInstance(UpdateClosureSettlementInput, value);
    const today = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Shanghai',
    });
    if (
      !uuid.test(caseId) ||
      validateSync(input, { whitelist: true, forbidNonWhitelisted: true })
        .length ||
      input.expectedVersion > 2147483646 ||
      (input.closeAt !== null && input.closeAt > today) ||
      input.paymentRecords.some((p) => p.paidOn > today)
    )
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    if (
      actor.clientCustomerId !== undefined ||
      actor.lawyerAccountId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    caseId = caseId.toLowerCase();
    actor = {
      ...actor,
      userId: actor.userId.toLowerCase(),
      departmentId: actor.departmentId.toLowerCase(),
    };
    input.expectedClosureVersionId =
      input.expectedClosureVersionId.toLowerCase();
    input.closeContentVersionIds = input.closeContentVersionIds.map((id) =>
      id.toLowerCase(),
    );
    input.paymentRecords = input.paymentRecords.map((p) => ({
      ...p,
      screenshotContentVersionId:
        p.screenshotContentVersionId?.toLowerCase() ?? null,
    }));
    if (input.refund)
      input.refund = {
        ...input.refund,
        expectedVersionId:
          input.refund.expectedVersionId?.toLowerCase() ?? null,
        ...(input.refund.items === undefined
          ? {}
          : {
              items: input.refund.items.map((i) => ({
                ...i,
                itemId: i.itemId.toLowerCase(),
                ...(i.amount === undefined
                  ? {}
                  : { amount: normalizeRefundAmount(i.amount) }),
              })),
            }),
      };
    if (input.settlement)
      input.settlement = {
        ...input.settlement,
        expectedAssessmentVersionId:
          input.settlement.expectedAssessmentVersionId?.toLowerCase() ?? null,
      };
    // Explicit shape avoids object insertion order affecting the request identity.
    const fingerprintFor = (amounts: boolean) =>
      hash({
        command: 'CLOSURE_SETTLEMENT_UPDATE',
        ...(amounts && input.refund
          ? { refundAmountProtocol: 'refund-item-amounts-v1' }
          : {}),
        caseId,
        expectedVersion: input.expectedVersion,
        expectedClosureVersionId: input.expectedClosureVersionId,
        idempotencyKey: input.idempotencyKey,
        closeAt: input.closeAt,
        closeAmountState: input.closeAmountState,
        closeAmt: input.closeAmt,
        closeContentVersionIds: input.closeContentVersionIds,
        correctionReason: input.correctionReason ?? null,
        paymentType: input.paymentType,
        paymentRecords: input.paymentRecords.map((p) => [
          p.paidOn,
          p.amount,
          p.payer,
          p.payee,
          p.screenshotContentVersionId,
        ]),
        refund: input.refund
          ? [
              input.refund.expectedVersionId,
              input.refund.kind,
              input.refund.items?.map((i) => [
                i.itemId,
                i.party,
                i.status,
                i.description,
                ...(amounts ? [normalizeRefundAmount(i.amount)] : []),
              ]) ?? null,
            ]
          : null,
        settlement: input.settlement
          ? [
              input.settlement.expectedAssessmentVersionId,
              input.settlement.expectedTermsVersion,
              input.settlement.declaration,
              [
                input.settlement.customerAmount?.mode ?? 'KEEP',
                input.settlement.customerAmount?.amount ?? null,
              ],
              [
                input.settlement.lawyerAmount?.mode ?? 'KEEP',
                input.settlement.lawyerAmount?.amount ?? null,
              ],
            ]
          : null,
      });
    const legacyFingerprint = fingerprintFor(false),
      newFingerprint = fingerprintFor(true);
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            let fingerprint = newFingerprint;
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
              include: {
                responsibleMembership: true,
                consolidationMembership: true,
                closure: { include: { currentVersion: true } },
                executionFinish: true,
              },
            });
            if (!c) return fail('CASE_NOT_FOUND');
            if (c.consolidationMembership?.isMain === false)
              throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
            const hasFinancialChange =
              input.paymentRecords.length > 0 ||
              input.refund !== undefined ||
              input.settlement !== undefined;
            // The proxy action is confined to this financial command. It does
            // not authorize the standalone closure-correction endpoint.
            if (c.responsibleUserId !== actor.userId) {
              if (hasFinancialChange) {
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
                await this.access.authorizeDepartmentAction(
                  actor,
                  'case.closure.settlement.update',
                  tx,
                );
              } else {
                await this.access.authorizeCase(
                  actor,
                  'case.closure.correct',
                  {
                    departmentId: actor.departmentId,
                    responsibleUserId: c.responsibleUserId,
                    ...(c.responsibleMembership.teamId
                      ? { teamId: c.responsibleMembership.teamId }
                      : {}),
                  },
                  tx,
                );
              }
            } else {
              // Preserve the owner's existing correction and read gates.
              if (hasFinancialChange)
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
              await this.access.authorizeCase(
                actor,
                'case.closure.correct',
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: c.responsibleUserId,
                  ...(c.responsibleMembership.teamId
                    ? { teamId: c.responsibleMembership.teamId }
                    : {}),
                },
                tx,
              );
            }
            const receipt =
              await tx.caseClosureSettlementUpdateReceipt.findUnique({
                where: {
                  departmentId_actorUserId_idempotencyKey: {
                    departmentId: actor.departmentId,
                    actorUserId: actor.userId,
                    idempotencyKey: input.idempotencyKey,
                  },
                },
                include: { payments: { orderBy: { position: 'asc' } } },
              });
            if (receipt) {
              if (
                input.refund &&
                receipt.requestFingerprint === legacyFingerprint &&
                (input.refund.items?.every((i) => i.amount === undefined) ??
                  true)
              ) {
                const legacy = await tx.$queryRaw<
                  { valid: boolean }[]
                >`SELECT true AS valid FROM case_refund_inventory_receipts r WHERE r.inventory_version_id=${receipt.refundVersionId}::uuid AND r.case_id=${caseId}::uuid AND r.department_id=${actor.departmentId}::uuid AND r.actor_user_id=${actor.userId}::uuid AND r.request_fingerprint=${legacyFingerprint} AND NOT EXISTS(SELECT 1 FROM case_refund_inventory_item_amounts a WHERE a.inventory_version_id=r.inventory_version_id) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.result_snapshot#>'{snapshot,items}') i WHERE i ? 'amount')`;
                if (legacy.length === 1) fingerprint = legacyFingerprint;
              }
              if (
                receipt.caseId !== caseId ||
                receipt.requestFingerprint !== fingerprint
              )
                return fail('IDEMPOTENCY_CONFLICT');
              // Reconstruct only the original immutable response. No current heads are substituted.
              const v = await tx.caseClosureVersion.findUnique({
                where: { id: receipt.closureVersionId },
              });
              const expected: ClosureSettlementUpdateResult = {
                id: caseId,
                stage: 'WAITING_ARCHIVE',
                version: v?.toVersion ?? 0,
                closureId: v?.closureId ?? '',
                closureVersionId: receipt.closureVersionId,
                recordedAt: v?.recordedAt.toISOString() ?? '',
                paymentVersionIds: receipt.payments.map(
                  (p) => p.paymentVersionId,
                ),
                refundInventoryVersionId: receipt.refundVersionId,
                settlementAssessmentVersionId: receipt.assessmentVersionId,
                settlementTermsChange: readTermsChange(
                  receipt.resultSnapshot &&
                    typeof receipt.resultSnapshot === 'object' &&
                    !Array.isArray(receipt.resultSnapshot)
                    ? receipt.resultSnapshot.settlementTermsChange
                    : undefined,
                ),
              };
              const termsChange = expected.settlementTermsChange;
              const changesRequested =
                input.settlement !== undefined &&
                [
                  input.settlement.customerAmount,
                  input.settlement.lawyerAmount,
                ].some((c) => c && c.mode !== 'KEEP');
              if (changesRequested !== (termsChange !== null))
                return fail('INVALID_RECEIPT');
              if (termsChange) {
                for (const side of ['customer', 'lawyer'] as const) {
                  const cmd =
                    side === 'customer'
                      ? input.settlement?.customerAmount
                      : input.settlement?.lawyerAmount;
                  const field =
                    side === 'customer'
                      ? 'customerManualAmount'
                      : 'lawyerManualAmount';
                  const requested =
                    cmd?.mode === 'MANUAL'
                      ? new Prisma.Decimal(cmd.amount!).toFixed(2)
                      : cmd?.mode === 'AUTOMATIC'
                        ? null
                        : termsChange.before[field];
                  if (termsChange.after[field] !== requested)
                    return fail('INVALID_RECEIPT');
                }
                const termsAudit = await tx.auditEvent.findUnique({
                  where: { id: termsChange.auditEventId },
                });
                if (
                  !termsAudit ||
                  termsAudit.resourceType !== 'CASE' ||
                  termsAudit.resourceId !== caseId ||
                  termsAudit.departmentId !== actor.departmentId ||
                  termsAudit.actorKind !== 'HUMAN' ||
                  termsAudit.actorUserId !== actor.userId ||
                  termsAudit.internalActorUserId !== actor.userId ||
                  termsAudit.action !==
                    'case.closure.settlement_amounts.updated' ||
                  !termsAudit.details ||
                  typeof termsAudit.details !== 'object' ||
                  Array.isArray(termsAudit.details) ||
                  !same(termsAudit.details, {
                    parentIdempotencyKey: input.idempotencyKey,
                    requestFingerprint: fingerprint,
                    authorizationRevision:
                      termsAudit.details.authorizationRevision,
                    customerMode:
                      input.settlement?.customerAmount?.mode ?? 'KEEP',
                    lawyerMode: input.settlement?.lawyerAmount?.mode ?? 'KEEP',
                    before: termsChange.before,
                    after: termsChange.after,
                  }) ||
                  typeof termsAudit.details.authorizationRevision !==
                    'number' ||
                  !Number.isSafeInteger(
                    termsAudit.details.authorizationRevision,
                  ) ||
                  termsAudit.details.authorizationRevision < 1 ||
                  termsChange.before.version !==
                    input.settlement?.expectedTermsVersion
                )
                  return fail('INVALID_RECEIPT');
              }
              if (
                !v ||
                v.kind !== 'CORRECT' ||
                v.caseId !== caseId ||
                v.departmentId !== actor.departmentId ||
                v.recordedByUserId !== actor.userId ||
                v.auditEventId !== receipt.closureAuditEventId ||
                v.fromVersion !== input.expectedVersion ||
                v.toVersion !== input.expectedVersion + 1 ||
                v.priorVersionId !== input.expectedClosureVersionId ||
                (v.closeAt?.toISOString().slice(0, 10) ?? null) !==
                  input.closeAt ||
                v.closeAmountState !== input.closeAmountState ||
                (v.closeAmt?.toFixed(2) ?? null) !==
                  (input.closeAmt === null
                    ? null
                    : new Prisma.Decimal(input.closeAmt).toFixed(2)) ||
                v.paymentType !== input.paymentType ||
                v.correctionReason !== (input.correctionReason ?? null) ||
                receipt.refundIncluded !== (input.refund !== undefined) ||
                receipt.assessmentIncluded !==
                  (input.settlement !== undefined) ||
                receipt.payments.length !== input.paymentRecords.length ||
                receipt.payments.some((p, i) => p.position !== i) ||
                !same(receipt.resultSnapshot, expected)
              )
                return fail('INVALID_RECEIPT');
              const audit = await tx.auditEvent.findUnique({
                where: { id: receipt.auditEventId },
              });
              if (
                !audit ||
                audit.actorKind !== 'HUMAN' ||
                audit.actorUserId !== actor.userId ||
                audit.internalActorUserId !== actor.userId ||
                audit.departmentId !== actor.departmentId ||
                audit.resourceType !== 'CASE_CLOSURE_SETTLEMENT_UPDATE' ||
                audit.resourceId !== receipt.id ||
                audit.action !== 'CASE_CLOSURE_SETTLEMENT_UPDATED' ||
                !same(audit.details, {
                  requestFingerprint: fingerprint,
                  result: expected,
                })
              )
                return fail('INVALID_RECEIPT');
              const closureReceipt = await tx.caseClosureReceipt.findUnique({
                where: {
                  departmentId_actorUserId_command_idempotencyKey: {
                    departmentId: actor.departmentId,
                    actorUserId: actor.userId,
                    command: 'CORRECT',
                    idempotencyKey: input.idempotencyKey,
                  },
                },
              });
              if (
                !closureReceipt ||
                closureReceipt.caseId !== caseId ||
                closureReceipt.requestFingerprint !== fingerprint ||
                !same(closureReceipt.resultSnapshot, {
                  id: caseId,
                  closureId: v.closureId,
                  closureVersionId: v.id,
                  finishId: v.finishId,
                  stage: 'WAITING_ARCHIVE',
                  version: v.toVersion,
                  recordedAt: v.recordedAt.toISOString(),
                })
              )
                return fail('INVALID_RECEIPT');
              // All children must still have their immutable parent binding and original hash.
              const bound = await tx.$queryRawUnsafe<Array<{ valid: boolean }>>(
                `SELECT
              (NOT $4::boolean OR EXISTS(SELECT 1 FROM case_settlement_update_child_links l JOIN case_refund_inventory_receipts r ON r.inventory_version_id=l.child_version_id
                WHERE l.kind='REFUND' AND l.child_version_id=$5::uuid AND l.parent_key=$3 AND l.case_id=$1::uuid AND l.department_id=$2::uuid AND l.actor_user_id=$8::uuid AND l.request_fingerprint=$9 AND r.request_fingerprint=$9 AND r.actor_user_id=$8::uuid))
              AND (NOT $6::boolean OR EXISTS(SELECT 1 FROM case_settlement_update_child_links l JOIN case_settlement_assessment_receipts r ON r.assessment_version_id=l.child_version_id
                JOIN case_settlement_assessment_versions a ON a.id=l.child_version_id WHERE l.kind='ASSESSMENT' AND l.child_version_id=$7::uuid AND l.parent_key=$3 AND l.case_id=$1::uuid AND l.department_id=$2::uuid AND l.actor_user_id=$8::uuid AND l.request_fingerprint=$9 AND r.request_fingerprint=$9 AND r.actor_user_id=$8::uuid AND a.closure_version_id=$10::uuid
                AND a.terms_version IS NOT DISTINCT FROM $11::integer
                AND (NOT $14::boolean OR (a.calculation_inputs->>'customerManualAmount' IS NOT DISTINCT FROM $12::text
                  AND a.calculation_inputs->>'lawyerManualAmount' IS NOT DISTINCT FROM $13::text)))) AS valid`,
                caseId,
                actor.departmentId,
                input.idempotencyKey,
                receipt.refundIncluded,
                receipt.refundVersionId,
                receipt.assessmentIncluded,
                receipt.assessmentVersionId,
                actor.userId,
                fingerprint,
                v.id,
                termsChange?.after.version ??
                  input.settlement?.expectedTermsVersion ??
                  null,
                termsChange?.after.customerManualAmount ?? null,
                termsChange?.after.lawyerManualAmount ?? null,
                termsChange !== null,
              );
              if (bound[0]?.valid !== true) return fail('INVALID_RECEIPT');
              const retained = await tx.caseClosureDocument.findMany({
                where: {
                  closureVersionId: v.id,
                  caseId,
                  departmentId: actor.departmentId,
                },
              });
              if (
                !same(
                  retained.map((d) => d.contentVersionId).sort(),
                  [...input.closeContentVersionIds].sort(),
                )
              )
                return fail('INVALID_RECEIPT');
              const closureAudit = await tx.auditEvent.findUnique({
                where: { id: v.auditEventId },
              });
              if (
                !closureAudit ||
                closureAudit.action !== 'case.closure.corrected' ||
                closureAudit.resourceType !== 'CASE' ||
                closureAudit.resourceId !== caseId ||
                closureAudit.departmentId !== actor.departmentId ||
                closureAudit.actorUserId !== actor.userId ||
                closureAudit.internalActorUserId !== actor.userId ||
                !same(closureAudit.details, {
                  authorizationRevision:
                    closureAudit.details &&
                    typeof closureAudit.details === 'object' &&
                    !Array.isArray(closureAudit.details)
                      ? closureAudit.details.authorizationRevision
                      : undefined,
                  closureId: v.closureId,
                  closureVersionId: v.id,
                  finishId: v.finishId,
                  priorVersionId: v.priorVersionId,
                  fromVersion: v.fromVersion,
                  toVersion: v.toVersion,
                  closeAt: input.closeAt,
                  closeAmountState: input.closeAmountState,
                  closeAmt: v.closeAmt?.toFixed(2) ?? null,
                  note: v.note,
                  correctionReason: input.correctionReason ?? null,
                  closeContentVersionIds: input.closeContentVersionIds,
                })
              )
                return fail('INVALID_RECEIPT');
              const expectedReferences = retained.map((d) => ({
                resourceType: 'case',
                resourceId: caseId,
                purpose: 'CASE_CLOSURE_DOCUMENT',
                materialId: d.materialId,
                contentVersionId: d.contentVersionId,
                actionEventId: v.auditEventId,
              }));
              for (const [i, link] of receipt.payments.entries()) {
                const p = await tx.caseClosurePaymentVersion.findUnique({
                  where: { id: link.paymentVersionId },
                  include: { documents: true },
                });
                const child = await tx.caseClosurePaymentReceipt.findUnique({
                  where: { paymentVersionId: link.paymentVersionId },
                });
                const original = input.paymentRecords[i]!;
                if (
                  !p ||
                  !child ||
                  p.caseId !== caseId ||
                  p.departmentId !== actor.departmentId ||
                  p.recordedByUserId !== actor.userId ||
                  p.closureVersionId !== v.id ||
                  p.revision !== 1 ||
                  p.state !== 'ACTIVE' ||
                  p.paymentId !== p.id ||
                  p.priorVersionId !== null ||
                  p.auditEventId !== link.auditEventId ||
                  p.paidOn.toISOString().slice(0, 10) !== original.paidOn ||
                  p.amount.toFixed(2) !==
                    new Prisma.Decimal(original.amount).toFixed(2) ||
                  p.payer !== original.payer ||
                  p.payee !== original.payee ||
                  p.documents.length !==
                    (original.screenshotContentVersionId === null ? 0 : 1) ||
                  p.documents.some(
                    (d) =>
                      d.contentVersionId !==
                      original.screenshotContentVersionId,
                  ) ||
                  child.caseId !== caseId ||
                  child.departmentId !== actor.departmentId ||
                  child.actorUserId !== actor.userId ||
                  child.requestFingerprint !== fingerprint ||
                  child.auditEventId !== link.auditEventId
                )
                  return fail('INVALID_RECEIPT');
                const childResult = child.resultSnapshot;
                if (
                  !childResult ||
                  typeof childResult !== 'object' ||
                  Array.isArray(childResult) ||
                  childResult.versionId !== p.id ||
                  childResult.stage !== 'WAITING_ARCHIVE' ||
                  childResult.reviewRequired !== true ||
                  !childResult.review ||
                  typeof childResult.review !== 'object' ||
                  Array.isArray(childResult.review) ||
                  childResult.review.caseId !== caseId ||
                  childResult.review.stage !== 'WAITING_ARCHIVE' ||
                  childResult.review.closureVersionId !== v.id ||
                  childResult.review.closureAmount !== input.closeAmt ||
                  childResult.review.financialReadiness !== 'UNKNOWN' ||
                  !Array.isArray(
                    childResult.review.effectivePaymentVersionIds,
                  ) ||
                  !Array.isArray(childResult.review.effectiveAmounts) ||
                  childResult.review.effectivePaymentVersionIds.length !==
                    childResult.review.effectiveAmounts.length ||
                  !same(
                    childResult.review.effectivePaymentVersionIds.slice(
                      -receipt.payments.length,
                    ),
                    expected.paymentVersionIds,
                  ) ||
                  !same(
                    childResult.review.effectiveAmounts.slice(
                      -receipt.payments.length,
                    ),
                    input.paymentRecords.map((payment) => payment.amount),
                  )
                )
                  return fail('INVALID_RECEIPT');
                const paymentAudit = await tx.auditEvent.findUnique({
                  where: { id: link.auditEventId },
                });
                // This is the original write's authorization revision. Current
                // authorization was checked above; a later valid revision must
                // not rewrite or invalidate the original immutable receipt.
                const originalAuthorizationRevision =
                  paymentAudit?.details &&
                  typeof paymentAudit.details === 'object' &&
                  !Array.isArray(paymentAudit.details)
                    ? paymentAudit.details.authorizationRevision
                    : undefined;
                if (
                  !paymentAudit ||
                  typeof originalAuthorizationRevision !== 'number' ||
                  !Number.isSafeInteger(originalAuthorizationRevision) ||
                  originalAuthorizationRevision < 1 ||
                  paymentAudit.departmentId !== actor.departmentId ||
                  paymentAudit.actorKind !== 'HUMAN' ||
                  paymentAudit.actorUserId !== actor.userId ||
                  paymentAudit.internalActorUserId !== actor.userId ||
                  paymentAudit.resourceType !==
                    'CASE_CLOSURE_PAYMENT_VERSION' ||
                  paymentAudit.resourceId !== p.id ||
                  paymentAudit.action !== 'CASE_CLOSURE_PAYMENT_RECORD' ||
                  !same(paymentAudit.details, {
                    authorizationRevision: originalAuthorizationRevision,
                    caseId,
                    closureVersionId: v.id,
                    paymentVersionId: p.id,
                    paidOn: original.paidOn,
                    amount: original.amount,
                    payer: original.payer,
                    payee: original.payee,
                    screenshotContentVersionId:
                      original.screenshotContentVersionId,
                    fingerprint,
                    result: child.resultSnapshot,
                  }) ||
                  child.idempotencyKey !==
                    hash([
                      'closure-settlement-payment',
                      input.idempotencyKey,
                      i,
                    ])
                )
                  return fail('INVALID_RECEIPT');
                expectedReferences.push(
                  ...p.documents.map((d) => ({
                    resourceType: 'case-closure-payment-version',
                    resourceId: p.id,
                    purpose: 'CASE_CLOSURE_PAYMENT_PROOF',
                    materialId: d.materialId,
                    contentVersionId: d.contentVersionId,
                    actionEventId: p.auditEventId,
                  })),
                );
              }
              const references = await tx.materialReference.findMany({
                where: {
                  departmentId: actor.departmentId,
                  actionEventId: {
                    in: [
                      v.auditEventId,
                      ...receipt.payments.map((p) => p.auditEventId),
                    ],
                  },
                },
              });
              if (
                references.length !== expectedReferences.length ||
                expectedReferences.some(
                  (expected) =>
                    !references.some(
                      (actual) =>
                        actual.assetVersionId === null &&
                        Object.entries(expected).every(
                          ([key, val]) =>
                            actual[key as keyof typeof expected] === val,
                        ),
                    ),
                )
              )
                return fail('INVALID_RECEIPT');
              return expected;
            }
            if (
              c.stage !== 'WAITING_ARCHIVE' ||
              c.version !== input.expectedVersion ||
              !c.closure?.currentVersion ||
              c.closure.currentVersionId !== input.expectedClosureVersionId ||
              c.closure.currentVersion.toVersion !== c.version
            )
              return fail('VERSION_CONFLICT');
            const h = c.closure,
              prior = h.currentVersion!;
            if (c.responsibleUserId !== actor.userId && hasFinancialChange) {
              const priorDocuments = await tx.caseClosureDocument.findMany({
                where: {
                  closureVersionId: prior.id,
                  caseId,
                  departmentId: actor.departmentId,
                },
                select: { contentVersionId: true },
              });
              if (
                (prior.closeAt?.toISOString().slice(0, 10) ?? null) !==
                  input.closeAt ||
                !same(
                  priorDocuments
                    .map((document) => document.contentVersionId)
                    .sort(),
                  [...input.closeContentVersionIds].sort(),
                )
              )
                await this.access.authorizeCase(
                  actor,
                  'case.closure.correct',
                  {
                    departmentId: actor.departmentId,
                    responsibleUserId: c.responsibleUserId,
                    ...(c.responsibleMembership.teamId
                      ? { teamId: c.responsibleMembership.teamId }
                      : {}),
                  },
                  tx,
                );
            }
            const source = await readCaseSourceAnchor(
              tx,
              caseId,
              actor.departmentId,
            );
            const early = await assertExecutionSourceChain(
              tx,
              caseId,
              actor.departmentId,
              source,
              true,
            );
            if (
              (h.earlyClosureId !== null && early?.id !== h.earlyClosureId) ||
              prior.earlyClosureId !== h.earlyClosureId ||
              prior.finishId !== h.finishId ||
              prior.externalEntryId !== h.externalEntryId ||
              (h.earlyClosureId === null &&
                (h.finishId !== (c.executionFinish?.id ?? null) ||
                  (h.finishId === null &&
                    (source.kind !== 'EXTERNAL_ENTRY' ||
                      source.initialStage !== 'WAITING_ARCHIVE' ||
                      h.externalEntryId !== source.entryId)))) ||
              (source.kind === 'EXTERNAL_ENTRY' &&
                input.closeAt !== null &&
                input.closeAt < source.stageReachedOn)
            )
              return fail('INVALID_STATE');
            if (
              await tx.caseClosureRecordCorrection.findFirst({
                where: {
                  caseId,
                  departmentId: actor.departmentId,
                  closureId: h.id,
                },
                select: { id: true },
              })
            )
              return fail('VERSION_CONFLICT');
            const active = await tx.$queryRawUnsafe<
              Array<{ id: string; amount: string }>
            >(
              "SELECT p.id,p.amount::text AS amount FROM case_closure_payment_versions p WHERE p.case_id=$1::uuid AND p.department_id=$2::uuid AND p.state='ACTIVE' AND NOT EXISTS(SELECT 1 FROM case_closure_payment_versions n WHERE n.prior_version_id=p.id) ORDER BY p.payment_id",
              caseId,
              actor.departmentId,
            );
            if (
              input.paymentType === 'ONE_TIME' &&
              active.length + input.paymentRecords.length > 1
            )
              return fail('ONE_TIME_PAYMENT_LIMIT');
            const documents =
              await this.materials.assertSettlementUpdateDocumentVersions(
                tx,
                actor,
                caseId,
                input.expectedClosureVersionId,
                input.closeContentVersionIds,
              );
            if (
              new Set(documents.map((d) => d.materialId)).size !==
              documents.length
            )
              return fail('INVALID_MATERIALS');
            const screenshots = [];
            for (const p of input.paymentRecords)
              screenshots.push(
                p.screenshotContentVersionId === null
                  ? []
                  : await this.materials.assertAvailableVersions(tx, actor, {
                      ownerType: 'CASE',
                      ownerId: caseId,
                      category: 'CASE_CLOSURE_PAYMENT_PROOF',
                      contentVersionIds: [p.screenshotContentVersionId],
                      minCount: 1,
                      maxCount: 1,
                    }),
              );
            const clocks = await tx.$queryRawUnsafe<
              Array<{ recordedAt: Date }>
            >('SELECT CURRENT_TIMESTAMP AS "recordedAt"');
            const now = clocks[0]?.recordedAt;
            if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
              return fail('INVALID_TRANSACTION_CLOCK');
            const closureVersionId = randomUUID(),
              closureAuditEventId = randomUUID(),
              receiptId = randomUUID(),
              auditEventId = randomUUID();
            const closureResult = {
              id: caseId,
              closureId: h.id,
              closureVersionId,
              finishId: h.finishId,
              stage: 'WAITING_ARCHIVE',
              version: c.version + 1,
              recordedAt: now.toISOString(),
            };
            await tx.auditEvent.create({
              data: {
                id: closureAuditEventId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.closure.corrected',
                details: {
                  authorizationRevision: actor.authorizationRevision,
                  closureId: h.id,
                  closureVersionId,
                  finishId: h.finishId,
                  priorVersionId: prior.id,
                  fromVersion: c.version,
                  toVersion: c.version + 1,
                  closeAt: input.closeAt,
                  closeAmountState: input.closeAmountState,
                  closeAmt:
                    input.closeAmt === null
                      ? null
                      : new Prisma.Decimal(input.closeAmt).toFixed(2),
                  note: prior.note,
                  correctionReason: input.correctionReason ?? null,
                  closeContentVersionIds: input.closeContentVersionIds,
                },
              },
            });
            await tx.caseClosureVersion.create({
              data: {
                id: closureVersionId,
                closureId: h.id,
                caseId,
                departmentId: actor.departmentId,
                earlyClosureId: h.earlyClosureId,
                finishId: h.finishId,
                externalEntryId: h.externalEntryId,
                kind: 'CORRECT',
                priorVersionId: prior.id,
                fromVersion: c.version,
                toVersion: c.version + 1,
                closeAt:
                  input.closeAt === null
                    ? null
                    : new Date(input.closeAt + 'T00:00:00Z'),
                closeAmountState: input.closeAmountState,
                closeAmt: input.closeAmt,
                paymentType: input.paymentType,
                note: prior.note,
                correctionReason: input.correctionReason ?? null,
                recordedAt: now,
                recordedByUserId: actor.userId,
                auditEventId: closureAuditEventId,
              },
            });
            await this.materials.freezeCaseClosureReferences(
              tx,
              actor,
              caseId,
              closureVersionId,
              documents,
              closureAuditEventId,
            );
            if (
              (
                await tx.caseClosure.updateMany({
                  where: {
                    id: h.id,
                    caseId,
                    departmentId: actor.departmentId,
                    currentVersionId: prior.id,
                  },
                  data: { currentVersionId: closureVersionId },
                })
              ).count !== 1
            )
              return fail('VERSION_CONFLICT');
            if (
              (
                await tx.case.updateMany({
                  where: {
                    id: caseId,
                    departmentId: actor.departmentId,
                    stage: 'WAITING_ARCHIVE',
                    version: c.version,
                  },
                  data: { version: c.version + 1 },
                })
              ).count !== 1
            )
              return fail('VERSION_CONFLICT');
            await tx.caseClosureReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                command: 'CORRECT',
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: closureResult,
              },
            });
            const paymentVersionIds = input.paymentRecords.map(() =>
                randomUUID(),
              ),
              paymentAudits = input.paymentRecords.map(() => randomUUID());
            for (const [i, p] of input.paymentRecords.entries()) {
              const id = paymentVersionIds[i]!,
                paymentAuditId = paymentAudits[i]!;
              // UNKNOWN is explicit: a payment command is not proof of financial readiness.
              const result = {
                versionId: id,
                stage: 'WAITING_ARCHIVE',
                reviewRequired: true,
                review: {
                  caseId,
                  stage: 'WAITING_ARCHIVE',
                  closureVersionId,
                  closureAmount: input.closeAmt,
                  effectivePaymentVersionIds: [
                    ...active.map((x) => x.id),
                    ...paymentVersionIds,
                  ],
                  effectiveAmounts: [
                    ...active.map((x) => x.amount),
                    ...input.paymentRecords.map((x) => x.amount),
                  ],
                  financialReadiness: 'UNKNOWN',
                },
              };
              await tx.auditEvent.create({
                data: {
                  id: paymentAuditId,
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  internalActorUserId: actor.userId,
                  resourceType: 'CASE_CLOSURE_PAYMENT_VERSION',
                  resourceId: id,
                  action: 'CASE_CLOSURE_PAYMENT_RECORD',
                  details: {
                    authorizationRevision: actor.authorizationRevision,
                    caseId,
                    closureVersionId,
                    paymentVersionId: id,
                    paidOn: p.paidOn,
                    amount: p.amount,
                    payer: p.payer,
                    payee: p.payee,
                    screenshotContentVersionId: p.screenshotContentVersionId,
                    fingerprint,
                    result,
                  },
                },
              });
              await tx.caseClosurePaymentVersion.create({
                data: {
                  id,
                  paymentId: id,
                  revision: 1,
                  caseId,
                  departmentId: actor.departmentId,
                  closureVersionId,
                  state: 'ACTIVE',
                  paidOn: new Date(p.paidOn + 'T00:00:00Z'),
                  amount: p.amount,
                  payer: p.payer,
                  payee: p.payee,
                  recordedAt: now,
                  recordedByUserId: actor.userId,
                  auditEventId: paymentAuditId,
                },
              });
              await this.materials.freezeCaseClosurePaymentReferences(
                tx,
                actor,
                caseId,
                id,
                screenshots[i]!,
                paymentAuditId,
              );
              await tx.caseClosurePaymentReceipt.create({
                data: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  caseId,
                  paymentVersionId: id,
                  auditEventId: paymentAuditId,
                  idempotencyKey: hash([
                    'closure-settlement-payment',
                    input.idempotencyKey,
                    i,
                  ]),
                  requestFingerprint: fingerprint,
                  resultSnapshot: result,
                },
              });
            }
            let refundInventoryVersionId: string | null = null,
              settlementAssessmentVersionId: string | null = null;
            let settlementTermsChange: SettlementTermsChange | null = null;
            if (input.refund) {
              const r = input.refund,
                composition = createRefundCompositionContext(tx, {
                  fingerprint,
                  idempotencyKey: input.idempotencyKey,
                  caseId,
                  actorUserId: actor.userId,
                  departmentId: actor.departmentId,
                });
              const base = { caseId, expectedVersionId: r.expectedVersionId };
              const command: RefundInventoryDraftCommand =
                r.kind === 'CONFIRM_COMPLETE'
                  ? { ...base, kind: r.kind }
                  : { ...base, kind: r.kind, items: r.items! };
              refundInventoryVersionId = (
                await this.refunds.executeInTransaction(
                  tx,
                  actor,
                  command,
                  composition.idempotencyKey,
                  composition.context,
                )
              ).snapshot.id;
            }
            if (input.settlement) {
              const terms = await updateClosureSettlementTermsInTransaction(
                tx,
                actor,
                caseId,
                input.settlement,
                { idempotencyKey: input.idempotencyKey, fingerprint },
              );
              settlementTermsChange = terms.change;
              const s = input.settlement,
                composition = createAssessmentCompositionContext({
                  requestFingerprint: fingerprint,
                  parentIdempotencyKey: input.idempotencyKey,
                  expectedAssessmentVersionId: s.expectedAssessmentVersionId,
                  expectedTermsVersion: terms.termsVersion,
                });
              settlementAssessmentVersionId = (
                await this.assessments.executeInTransaction(
                  tx,
                  actor,
                  {
                    caseId,
                    declaration: s.declaration,
                    idempotencyKey: composition.childIdempotencyKey,
                  },
                  composition,
                )
              ).id;
            }
            const result: ClosureSettlementUpdateResult = {
              id: caseId,
              stage: 'WAITING_ARCHIVE',
              version: c.version + 1,
              closureId: h.id,
              closureVersionId,
              recordedAt: now.toISOString(),
              paymentVersionIds,
              refundInventoryVersionId,
              settlementAssessmentVersionId,
              settlementTermsChange,
            };
            await tx.auditEvent.create({
              data: {
                id: auditEventId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE_CLOSURE_SETTLEMENT_UPDATE',
                resourceId: receiptId,
                action: 'CASE_CLOSURE_SETTLEMENT_UPDATED',
                details: { requestFingerprint: fingerprint, result },
              },
            });
            await tx.caseClosureSettlementUpdateReceipt.create({
              data: {
                id: receiptId,
                caseId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
                closureVersionId,
                closureAuditEventId,
                refundIncluded: input.refund !== undefined,
                refundVersionId: refundInventoryVersionId,
                assessmentIncluded: input.settlement !== undefined,
                assessmentVersionId: settlementAssessmentVersionId,
                auditEventId,
                resultSnapshot: result,
              },
            });
            for (const [
              position,
              paymentVersionId,
            ] of paymentVersionIds.entries())
              await tx.caseClosureSettlementUpdatePayment.create({
                data: {
                  receiptId,
                  caseId,
                  departmentId: actor.departmentId,
                  position,
                  paymentVersionId,
                  auditEventId: paymentAudits[position]!,
                },
              });
            if (c.responsibleUserId !== actor.userId && hasFinancialChange)
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
