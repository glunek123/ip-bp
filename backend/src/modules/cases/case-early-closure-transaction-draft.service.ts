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
import type { MaterialService } from '../materials';
import { RecordEarlyClosureInput } from './case-early-closure.dto';

const reject = (code: string): never => {
  if (code === 'CASE_NOT_FOUND') throw new NotFoundException({ code });
  throw new ConflictException({ code });
};
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const paymentResult = (
  versionId: string,
  caseId: string,
  closureVersionId: string,
  closureAmount: string | null,
  effectivePaymentVersionIds: string[],
  effectiveAmounts: string[],
) => ({
  versionId,
  stage: 'WAITING_ARCHIVE',
  reviewRequired: true,
  review: {
    caseId,
    stage: 'WAITING_ARCHIVE',
    closureVersionId,
    closureAmount,
    effectivePaymentVersionIds,
    effectiveAmounts,
    financialReadiness: 'UNKNOWN',
  },
});
const sameJson = (left: unknown, right: unknown): boolean => {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value !== null && typeof value === 'object')
      return (
        '{' +
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
          .join(',') +
        '}'
      );
    return JSON.stringify(value) ?? 'undefined';
  };
  return canonical(left) === canonical(right);
};
export type EarlyClosureDraftResult = {
  id: string;
  earlyClosureId: string;
  closureId: string;
  closureVersionId: string;
  stage: 'WAITING_ARCHIVE';
  version: number;
  recordedAt: string;
};
/** Records early closure and its initial facts in one transaction.
 * No partial success or trigger bypass is permitted. */
export class CaseEarlyClosureTransactionDraftService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessControlService,
    private readonly materials: Pick<
      MaterialService,
      | 'assertAvailableVersions'
      | 'freezeCaseClosureReferences'
      | 'freezeCaseClosurePaymentReferences'
    >,
    private readonly organization: OrganizationService,
  ) {}

  async record(
    actor: ActorContext,
    caseId: string,
    value: RecordEarlyClosureInput,
  ): Promise<EarlyClosureDraftResult> {
    const input = plainToInstance(RecordEarlyClosureInput, value);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        caseId,
      ) ||
      validateSync(input, { whitelist: true, forbidNonWhitelisted: true })
        .length ||
      input.expectedVersion > 2147483645 ||
      input.closeAt >
        new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) ||
      input.paymentRecords.some(
        (p) =>
          p.paidOn >
          new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }),
      )
    )
      throw new BadRequestException({ code: 'VALIDATION_ERROR' });
    if (
      actor.clientCustomerId !== undefined ||
      actor.lawyerAccountId !== undefined ||
      actor.notaryOfficeId !== undefined
    )
      throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
    // PostgreSQL canonicalizes UUIDs; use the same representation before hashing or retaining snapshots.
    caseId = caseId.toLowerCase();
    input.closeContentVersionIds = input.closeContentVersionIds.map((id) =>
      id.toLowerCase(),
    );
    input.paymentRecords = input.paymentRecords.map((payment) => ({
      ...payment,
      screenshotContentVersionId:
        payment.screenshotContentVersionId?.toLowerCase() ?? null,
    }));
    const fingerprint = hash({
      caseId,
      expectedVersion: input.expectedVersion,
      expectedStage: input.expectedStage,
      idempotencyKey: input.idempotencyKey,
      closeAt: input.closeAt,
      closeAmountState: input.closeAmountState,
      closeAmt: input.closeAmt,
      closeContentVersionIds: input.closeContentVersionIds,
      paymentType: input.paymentType,
      paymentRecords: input.paymentRecords.map((p) => ({
        paidOn: p.paidOn,
        amount: p.amount,
        payer: p.payer,
        payee: p.payee,
        screenshotContentVersionId: p.screenshotContentVersionId,
      })),
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            await lockCustomerActorFacts(tx, this.organization, actor);
            const identity = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              `SELECT u.id FROM user_accounts u JOIN department_memberships m ON m.user_id=u.id
          WHERE u.id=$1::uuid AND u.active AND u.account_type='INTERNAL' AND m.department_id=$2::uuid AND m.active FOR SHARE OF u,m`,
              actor.userId,
              actor.departmentId,
            );
            if (identity.length !== 1)
              throw new ForbiddenException({ code: 'ACTION_FORBIDDEN' });
            const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
              'SELECT id FROM cases WHERE id=$1::uuid AND department_id=$2::uuid FOR UPDATE',
              caseId,
              actor.departmentId,
            );
            if (locked.length !== 1) reject('CASE_NOT_FOUND');
            const c = await tx.case.findFirst({
              where: { id: caseId, departmentId: actor.departmentId },
              include: {
                responsibleMembership: true,
                consolidationMembership: true,
              },
            });
            if (!c) return reject('CASE_NOT_FOUND');
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
            let earlyClosureAction: 'case.closure.record' | 'case.archive' =
              'case.closure.record';
            const authorizeEarlyAction = async (
              action: 'case.closure.record' | 'case.archive',
            ) => {
              if (c.responsibleUserId !== actor.userId)
                return this.access.authorizeDepartmentAction(actor, action, tx);
              return this.access.authorizeCase(
                actor,
                action,
                {
                  departmentId: actor.departmentId,
                  responsibleUserId: c.responsibleUserId,
                  ...(c.responsibleMembership.teamId
                    ? { teamId: c.responsibleMembership.teamId }
                    : {}),
                },
                tx,
              );
            };
            try {
              await authorizeEarlyAction('case.closure.record');
            } catch (error) {
              if (!(error instanceof ForbiddenException)) throw error;
              earlyClosureAction = 'case.archive';
              await authorizeEarlyAction('case.archive');
            }
            const receipt = await tx.caseEarlyClosureReceipt.findUnique({
              where: {
                departmentId_actorUserId_idempotencyKey: {
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  idempotencyKey: input.idempotencyKey,
                },
              },
            });
            if (receipt) {
              if (
                receipt.caseId !== caseId ||
                receipt.requestFingerprint !== fingerprint
              )
                return reject('IDEMPOTENCY_CONFLICT');
              const e = await tx.caseEarlyClosure.findUnique({
                where: { id: receipt.earlyClosureId },
              });
              const v = await tx.caseClosureVersion.findFirst({
                where: {
                  caseId,
                  departmentId: actor.departmentId,
                  earlyClosureId: receipt.earlyClosureId,
                  kind: 'REGISTER',
                },
              });
              const cr = await tx.caseClosureReceipt.findUnique({
                where: {
                  departmentId_actorUserId_command_idempotencyKey: {
                    departmentId: actor.departmentId,
                    actorUserId: actor.userId,
                    command: 'RECORD',
                    idempotencyKey: input.idempotencyKey,
                  },
                },
              });
              if (
                !e ||
                !v ||
                !cr ||
                e.caseId !== caseId ||
                e.departmentId !== actor.departmentId ||
                e.recordedByUserId !== actor.userId ||
                e.fromVersion !== input.expectedVersion ||
                e.fromStage !== input.expectedStage ||
                e.toVersion !== input.expectedVersion + 1 ||
                v.earlyClosureId !== e.id ||
                v.fromVersion !== e.toVersion ||
                v.toVersion !== e.toVersion + 1 ||
                v.recordedByUserId !== actor.userId ||
                cr.caseId !== caseId ||
                cr.requestFingerprint !== fingerprint
              )
                return reject('INVALID_RECEIPT');
              const sourceExpected = {
                id: caseId,
                earlyClosureId: e.id,
                fromStage: e.fromStage,
                stage: 'WAITING_ARCHIVE',
                version: e.toVersion,
                recordedAt: e.recordedAt.toISOString(),
              };
              const sourceActual = receipt.resultSnapshot;
              if (
                !sourceActual ||
                typeof sourceActual !== 'object' ||
                Array.isArray(sourceActual) ||
                Object.keys(sourceActual).length !==
                  Object.keys(sourceExpected).length ||
                Object.entries(sourceExpected).some(
                  ([k, val]) => sourceActual[k] !== val,
                ) ||
                v.closeAt?.toISOString().slice(0, 10) !== input.closeAt ||
                v.closeAmountState !== input.closeAmountState ||
                (v.closeAmt?.toFixed(2) ?? null) !==
                  (input.closeAmt === null
                    ? null
                    : new Prisma.Decimal(input.closeAmt).toFixed(2)) ||
                v.paymentType !== input.paymentType ||
                v.finishId !== null ||
                v.externalEntryId !== null
              )
                return reject('INVALID_RECEIPT');
              const payments = await tx.caseClosurePaymentVersion.findMany({
                where: {
                  closureVersionId: v.id,
                  caseId,
                  departmentId: actor.departmentId,
                  revision: 1,
                },
                include: { documents: true },
              });
              if (payments.length !== input.paymentRecords.length)
                return reject('INVALID_RECEIPT');
              const children = await Promise.all(
                input.paymentRecords.map((_, i) =>
                  tx.caseClosurePaymentReceipt.findUnique({
                    where: {
                      departmentId_actorUserId_idempotencyKey: {
                        departmentId: actor.departmentId,
                        actorUserId: actor.userId,
                        idempotencyKey: hash({
                          command: 'early-closure-payment',
                          key: input.idempotencyKey,
                          index: i,
                        }),
                      },
                    },
                  }),
                ),
              );
              if (
                children.some((child) => !child) ||
                new Set(children.map((child) => child?.paymentVersionId))
                  .size !== children.length
              )
                return reject('INVALID_RECEIPT');
              for (let i = 0; i < input.paymentRecords.length; i++) {
                const child = children[i];
                const payment = payments.find(
                    (p) => p.id === child?.paymentVersionId,
                  ),
                  original = input.paymentRecords[i]!;
                if (!payment) return reject('INVALID_RECEIPT');
                if (
                  !child ||
                  child.caseId !== caseId ||
                  child.requestFingerprint !== fingerprint ||
                  child.departmentId !== actor.departmentId ||
                  child.actorUserId !== actor.userId ||
                  child.auditEventId !== payment?.auditEventId ||
                  !sameJson(
                    child.resultSnapshot,
                    paymentResult(
                      payment.id,
                      caseId,
                      v.id,
                      input.closeAmt,
                      children.map((c) => c!.paymentVersionId),
                      input.paymentRecords.map((p) => p.amount),
                    ),
                  ) ||
                  !payment ||
                  payment.recordedByUserId !== actor.userId ||
                  payment.state !== 'ACTIVE' ||
                  payment.paidOn.toISOString().slice(0, 10) !==
                    original.paidOn ||
                  payment.amount.toFixed(2) !==
                    new Prisma.Decimal(original.amount).toFixed(2) ||
                  payment.payer !== original.payer ||
                  payment.payee !== original.payee ||
                  payment.documents.length !==
                    (original.screenshotContentVersionId === null ? 0 : 1) ||
                  payment.documents.some(
                    (d) =>
                      d.contentVersionId !==
                      original.screenshotContentVersionId,
                  )
                )
                  return reject('INVALID_RECEIPT');
              }
              const retained = await tx.caseClosureDocument.findMany({
                where: {
                  closureVersionId: v.id,
                  caseId,
                  departmentId: actor.departmentId,
                },
              });
              if (
                retained.length !== input.closeContentVersionIds.length ||
                retained.some(
                  (d) =>
                    !input.closeContentVersionIds.includes(d.contentVersionId),
                )
              )
                return reject('INVALID_RECEIPT');
              const audits = await tx.auditEvent.findMany({
                where: {
                  id: {
                    in: [
                      e.auditEventId,
                      v.auditEventId,
                      ...payments.map((p) => p.auditEventId),
                    ],
                  },
                },
              });
              if (
                audits.length !== 2 + payments.length ||
                audits.some(
                  (a) =>
                    a.departmentId !== actor.departmentId ||
                    a.actorUserId !== actor.userId ||
                    a.internalActorUserId !== actor.userId ||
                    a.actorKind !== 'HUMAN' ||
                    a.customerAccountBindingId !== null ||
                    a.lawyerAccountBindingId !== null ||
                    a.notaryOfficeAccountBindingId !== null,
                )
              )
                return reject('INVALID_RECEIPT');
              const sourceAudit = audits.find((a) => a.id === e.auditEventId),
                closureAudit = audits.find((a) => a.id === v.auditEventId);
              const sourceRevision =
                sourceAudit?.details &&
                typeof sourceAudit.details === 'object' &&
                !Array.isArray(sourceAudit.details)
                  ? sourceAudit.details.authorizationRevision
                  : undefined;
              const sourceDetails = {
                earlyClosureId: e.id,
                fromStage: e.fromStage,
                fromVersion: e.fromVersion,
                toVersion: e.toVersion,
                requestFingerprint: fingerprint,
              };
              if (
                !sourceAudit ||
                sourceAudit.action !== 'case.early_closed' ||
                sourceAudit.resourceType !== 'CASE' ||
                sourceAudit.resourceId !== caseId ||
                !(
                  sameJson(sourceAudit.details, sourceDetails) ||
                  (typeof sourceRevision === 'number' &&
                    Number.isSafeInteger(sourceRevision) &&
                    sourceRevision > 0 &&
                    sameJson(sourceAudit.details, {
                      ...sourceDetails,
                      authorizationRevision: sourceRevision,
                    }))
                ) ||
                !closureAudit ||
                closureAudit.action !== 'case.closure.recorded' ||
                closureAudit.resourceType !== 'CASE' ||
                closureAudit.resourceId !== caseId ||
                !sameJson(closureAudit.details, {
                  closureId: v.closureId,
                  closureVersionId: v.id,
                  finishId: null,
                  priorVersionId: null,
                  fromVersion: v.fromVersion,
                  toVersion: v.toVersion,
                  closeAt: input.closeAt,
                  closeAmountState: input.closeAmountState,
                  closeAmt:
                    input.closeAmt === null
                      ? null
                      : new Prisma.Decimal(input.closeAmt).toFixed(2),
                  note: null,
                  correctionReason: null,
                  closeContentVersionIds: input.closeContentVersionIds,
                })
              )
                return reject('INVALID_RECEIPT');
              for (let i = 0; i < children.length; i++) {
                const payment = payments.find(
                    (p) => p.id === children[i]?.paymentVersionId,
                  ),
                  original = input.paymentRecords[i]!;
                const audit = audits.find(
                  (a) => a.id === payment?.auditEventId,
                );
                const revision =
                  audit?.details !== null &&
                  typeof audit?.details === 'object' &&
                  !Array.isArray(audit.details)
                    ? audit.details.authorizationRevision
                    : undefined;
                if (
                  !payment ||
                  !audit ||
                  audit.action !== 'CASE_CLOSURE_PAYMENT_RECORD' ||
                  audit.resourceType !== 'CASE_CLOSURE_PAYMENT_VERSION' ||
                  audit.resourceId !== payment.id ||
                  typeof revision !== 'number' ||
                  !Number.isSafeInteger(revision) ||
                  revision < 1 ||
                  !sameJson(audit.details, {
                    // Current permissions were rechecked before receipt lookup;
                    // retain the original authenticated revision for history.
                    authorizationRevision: revision,
                    caseId,
                    closureVersionId: v.id,
                    paymentVersionId: payment.id,
                    paidOn: original.paidOn,
                    amount: original.amount,
                    payer: original.payer,
                    payee: original.payee,
                    screenshotContentVersionId:
                      original.screenshotContentVersionId,
                    fingerprint,
                    result: children[i]!.resultSnapshot,
                  })
                )
                  return reject('INVALID_RECEIPT');
              }
              const expectedReferences = [
                ...retained.map((d) => ({
                  resourceType: 'case',
                  resourceId: caseId,
                  purpose: 'CASE_CLOSURE_DOCUMENT',
                  materialId: d.materialId,
                  contentVersionId: d.contentVersionId,
                  actionEventId: v.auditEventId,
                })),
                ...payments.flatMap((p) =>
                  p.documents.map((d) => ({
                    resourceType: 'case-closure-payment-version',
                    resourceId: p.id,
                    purpose: 'CASE_CLOSURE_PAYMENT_PROOF',
                    materialId: d.materialId,
                    contentVersionId: d.contentVersionId,
                    actionEventId: p.auditEventId,
                  })),
                ),
              ];
              const references = await tx.materialReference.findMany({
                where: {
                  departmentId: actor.departmentId,
                  actionEventId: {
                    in: [
                      v.auditEventId,
                      ...payments.map((p) => p.auditEventId),
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
                        actual.departmentId === actor.departmentId &&
                        actual.assetVersionId === null &&
                        Object.entries(expected).every(
                          ([key, val]) =>
                            actual[key as keyof typeof expected] === val,
                        ),
                    ),
                )
              )
                return reject('INVALID_RECEIPT');
              const expected = {
                id: caseId,
                closureId: v.closureId,
                closureVersionId: v.id,
                finishId: null,
                stage: 'WAITING_ARCHIVE',
                version: v.toVersion,
                recordedAt: v.recordedAt.toISOString(),
              };
              if (
                JSON.stringify(cr.resultSnapshot) !== JSON.stringify(expected)
              ) {
                // JSONB key order is not significant.
                const actual = cr.resultSnapshot;
                if (
                  !actual ||
                  typeof actual !== 'object' ||
                  Array.isArray(actual) ||
                  Object.keys(actual).length !== 7 ||
                  Object.entries(expected).some(([k, val]) => actual[k] !== val)
                )
                  return reject('INVALID_RECEIPT');
              }
              return {
                id: caseId,
                earlyClosureId: e.id,
                closureId: v.closureId,
                closureVersionId: v.id,
                stage: 'WAITING_ARCHIVE',
                version: v.toVersion,
                recordedAt: v.recordedAt.toISOString(),
              };
            }
            if (
              c.stage !== input.expectedStage ||
              c.version !== input.expectedVersion ||
              c.consolidationMembership?.isMain === false
            )
              return reject('VERSION_CONFLICT');
            const sources = await Promise.all([
              tx.caseEarlyClosure.findFirst({ where: { caseId } }),
              tx.caseEarlyArchive.findFirst({ where: { caseId } }),
              tx.caseClosure.findFirst({ where: { caseId } }),
              tx.caseArchive.findFirst({ where: { caseId } }),
              tx.caseExecutionFinish.findFirst({ where: { caseId } }),
            ]);
            if (sources.some(Boolean)) return reject('SOURCE_CONFLICT');
            const docs = await this.materials.assertAvailableVersions(
              tx,
              actor,
              {
                ownerType: 'CASE',
                ownerId: caseId,
                category: 'CASE_CLOSURE_DOCUMENT',
                contentVersionIds: input.closeContentVersionIds,
                minCount: 0,
                maxCount: 10,
              },
            );
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
              return reject('INVALID_TRANSACTION_CLOCK');
            const earlyClosureId = randomUUID(),
              closureId = randomUUID(),
              closureVersionId = randomUUID(),
              sourceAudit = randomUUID(),
              closureAudit = randomUUID();
            const sourceSnapshot = {
              id: caseId,
              earlyClosureId,
              fromStage: c.stage,
              stage: 'WAITING_ARCHIVE',
              version: c.version + 1,
              recordedAt: now.toISOString(),
            };
            await tx.auditEvent.create({
              data: {
                id: sourceAudit,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.early_closed',
                details: {
                  earlyClosureId,
                  fromStage: c.stage,
                  fromVersion: c.version,
                  toVersion: c.version + 1,
                  requestFingerprint: fingerprint,
                  authorizationRevision: actor.authorizationRevision,
                },
              },
            });
            await tx.caseEarlyClosure.create({
              data: {
                id: earlyClosureId,
                caseId,
                departmentId: actor.departmentId,
                fromStage: c.stage,
                fromVersion: c.version,
                toVersion: c.version + 1,
                recordedAt: now,
                recordedByUserId: actor.userId,
                auditEventId: sourceAudit,
              },
            });
            await tx.caseEarlyClosureReceipt.create({
              data: {
                caseId,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                earlyClosureId,
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: sourceSnapshot,
              },
            });
            if (
              (
                await tx.case.updateMany({
                  where: {
                    id: caseId,
                    departmentId: actor.departmentId,
                    stage: input.expectedStage,
                    version: c.version,
                  },
                  data: { stage: 'WAITING_ARCHIVE', version: c.version + 1 },
                })
              ).count !== 1
            )
              return reject('VERSION_CONFLICT');
            await tx.auditEvent.create({
              data: {
                id: closureAudit,
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                internalActorUserId: actor.userId,
                resourceType: 'CASE',
                resourceId: caseId,
                action: 'case.closure.recorded',
                details: {
                  closureId,
                  closureVersionId,
                  finishId: null,
                  priorVersionId: null,
                  fromVersion: c.version + 1,
                  toVersion: c.version + 2,
                  closeAt: input.closeAt,
                  closeAmountState: input.closeAmountState,
                  closeAmt:
                    input.closeAmt === null
                      ? null
                      : new Prisma.Decimal(input.closeAmt).toFixed(2),
                  note: null,
                  correctionReason: null,
                  closeContentVersionIds: input.closeContentVersionIds,
                },
              },
            });
            await tx.caseClosure.create({
              data: {
                id: closureId,
                caseId,
                departmentId: actor.departmentId,
                earlyClosureId,
                finishId: null,
                externalEntryId: null,
              },
            });
            await tx.caseClosureVersion.create({
              data: {
                id: closureVersionId,
                closureId,
                caseId,
                departmentId: actor.departmentId,
                earlyClosureId,
                finishId: null,
                externalEntryId: null,
                kind: 'REGISTER',
                fromVersion: c.version + 1,
                toVersion: c.version + 2,
                closeAt: new Date(input.closeAt + 'T00:00:00Z'),
                closeAmountState: input.closeAmountState,
                closeAmt: input.closeAmt,
                paymentType: input.paymentType,
                recordedAt: now,
                recordedByUserId: actor.userId,
                auditEventId: closureAudit,
              },
            });
            await this.materials.freezeCaseClosureReferences(
              tx,
              actor,
              caseId,
              closureVersionId,
              docs,
              closureAudit,
            );
            if (
              (
                await tx.caseClosure.updateMany({
                  where: {
                    id: closureId,
                    caseId,
                    departmentId: actor.departmentId,
                    currentVersionId: null,
                  },
                  data: { currentVersionId: closureVersionId },
                })
              ).count !== 1
            )
              return reject('VERSION_CONFLICT');
            if (
              (
                await tx.case.updateMany({
                  where: {
                    id: caseId,
                    departmentId: actor.departmentId,
                    stage: 'WAITING_ARCHIVE',
                    version: c.version + 1,
                  },
                  data: { version: c.version + 2 },
                })
              ).count !== 1
            )
              return reject('VERSION_CONFLICT');
            const paymentIds = input.paymentRecords.map(() => randomUUID());
            for (let i = 0; i < input.paymentRecords.length; i++) {
              const p = input.paymentRecords[i]!;
              const id = paymentIds[i]!,
                auditId = randomUUID();
              const resultSnapshot = paymentResult(
                id,
                caseId,
                closureVersionId,
                input.closeAmt,
                paymentIds,
                input.paymentRecords.map((payment) => payment.amount),
              );
              await tx.auditEvent.create({
                data: {
                  id: auditId,
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
                    result: resultSnapshot,
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
                  auditEventId: auditId,
                },
              });
              await this.materials.freezeCaseClosurePaymentReferences(
                tx,
                actor,
                caseId,
                id,
                screenshots[i]!,
                auditId,
              );
              await tx.caseClosurePaymentReceipt.create({
                data: {
                  caseId,
                  departmentId: actor.departmentId,
                  actorUserId: actor.userId,
                  paymentVersionId: id,
                  auditEventId: auditId,
                  idempotencyKey: hash({
                    command: 'early-closure-payment',
                    key: input.idempotencyKey,
                    index: i,
                  }),
                  requestFingerprint: fingerprint,
                  resultSnapshot,
                },
              });
            }
            const finalSnapshot = {
              id: caseId,
              closureId,
              closureVersionId,
              finishId: null,
              stage: 'WAITING_ARCHIVE',
              version: c.version + 2,
              recordedAt: now.toISOString(),
            };
            await tx.caseClosureReceipt.create({
              data: {
                departmentId: actor.departmentId,
                actorUserId: actor.userId,
                caseId,
                command: 'RECORD',
                idempotencyKey: input.idempotencyKey,
                requestFingerprint: fingerprint,
                resultSnapshot: finalSnapshot,
              },
            });
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
                    action: earlyClosureAction,
                    scope: 'DEPARTMENT',
                    requestFingerprint: fingerprint,
                  },
                },
              });
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            return {
              id: caseId,
              earlyClosureId,
              closureId,
              closureVersionId,
              stage: 'WAITING_ARCHIVE',
              version: c.version + 2,
              recordedAt: now.toISOString(),
            };
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (isDatabaseTransactionConflict(error) && attempt < 2) continue;
        throw error;
      }
    }
    return reject('VERSION_CONFLICT');
  }
}
