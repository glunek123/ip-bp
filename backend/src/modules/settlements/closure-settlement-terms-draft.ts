import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ActorContext } from '../../access-control/actor-context';
import { Prisma } from '../../generated/prisma/client';
import type {
  SettlementUpdateAssessmentInput,
  SettlementTermsChange,
} from '../cases';

/** Composition only: caller must authorize the responsible internal operator and
 * hold the case lock in its serializable transaction. Never opens a transaction. */
export async function updateClosureSettlementTermsInTransaction(
  tx: Prisma.TransactionClient,
  actor: ActorContext,
  caseId: string,
  command: SettlementUpdateAssessmentInput,
  parent: { idempotencyKey: string; fingerprint: string },
): Promise<{
  termsVersion: number | null;
  change: SettlementTermsChange | null;
}> {
  await tx.$queryRawUnsafe(
    'SELECT case_id FROM case_settlement_terms WHERE case_id=$1::uuid AND department_id=$2::uuid FOR UPDATE',
    caseId,
    actor.departmentId,
  );
  const prior = await tx.caseSettlementTerms.findUnique({ where: { caseId } });
  if (
    (prior?.version ?? null) !== command.expectedTermsVersion ||
    (prior && prior.departmentId !== actor.departmentId)
  )
    throw new ConflictException({ code: 'SETTLEMENT_TERMS_VERSION_CONFLICT' });
  const customer = command.customerAmount?.mode ?? 'KEEP';
  const lawyer = command.lawyerAmount?.mode ?? 'KEEP';
  if (customer === 'KEEP' && lawyer === 'KEEP')
    return { termsVersion: prior?.version ?? null, change: null };
  if ((prior?.version ?? 0) >= 2147483647)
    throw new ConflictException({ code: 'SETTLEMENT_TERMS_VERSION_CONFLICT' });
  const before = {
    version: prior?.version ?? null,
    customerManualAmount: prior?.customerManualAmount?.toFixed(2) ?? null,
    lawyerManualAmount: prior?.lawyerManualAmount?.toFixed(2) ?? null,
  };
  const amounts = {
    customerManualAmount:
      customer === 'KEEP'
        ? before.customerManualAmount
        : customer === 'AUTOMATIC'
          ? null
          : new Prisma.Decimal(command.customerAmount!.amount!).toFixed(2),
    lawyerManualAmount:
      lawyer === 'KEEP'
        ? before.lawyerManualAmount
        : lawyer === 'AUTOMATIC'
          ? null
          : new Prisma.Decimal(command.lawyerAmount!.amount!).toFixed(2),
  };
  const saved = prior
    ? await tx.caseSettlementTerms.update({
        where: { caseId },
        data: { ...amounts, version: { increment: 1 } },
      })
    : await tx.caseSettlementTerms.create({
        data: { caseId, departmentId: actor.departmentId, ...amounts },
      });
  const change: SettlementTermsChange = {
    auditEventId: randomUUID(),
    before,
    after: { version: saved.version, ...amounts },
  };
  await tx.auditEvent.create({
    data: {
      id: change.auditEventId,
      departmentId: actor.departmentId,
      actorUserId: actor.userId,
      internalActorUserId: actor.userId,
      resourceType: 'CASE',
      resourceId: caseId,
      action: 'case.closure.settlement_amounts.updated',
      details: {
        parentIdempotencyKey: parent.idempotencyKey,
        requestFingerprint: parent.fingerprint,
        authorizationRevision: actor.authorizationRevision,
        customerMode: customer,
        lawyerMode: lawyer,
        before: change.before,
        after: change.after,
      },
    },
  });
  return { termsVersion: saved.version, change };
}
