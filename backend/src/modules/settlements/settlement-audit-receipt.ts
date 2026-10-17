import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';

/** The immutable creation audit preserves a request when its source row later changes. */
export async function loadFinancialAuditReceipt(
  tx: Pick<Prisma.TransactionClient, 'auditEvent'>,
  identity: {
    departmentId: string;
    actorUserId: string;
    resourceType: string;
    resourceId: string;
    action: string;
    launchId?: string;
  },
  fingerprint: string,
  missingIsConflict = false,
) {
  const { launchId, ...where } = identity;
  const audits = await tx.auditEvent.findMany({
    where: {
      ...where,
      ...(launchId === undefined
        ? {}
        : { details: { path: ['launchId'], equals: launchId } }),
    },
    select: { details: true },
  });
  if (
    audits.length !== 1 ||
    audits[0]?.details === null ||
    typeof audits[0]?.details !== 'object' ||
    Array.isArray(audits[0]?.details)
  ) {
    if (missingIsConflict)
      throw new ConflictException({
        code: 'IDEMPOTENCY_CONFLICT',
        message: '请求与原操作不一致',
      });
    throw new InternalServerErrorException({
      code: 'INVALID_FINANCIAL_RECEIPT',
      message: '金融请求回执来源不完整',
    });
  }
  const details = audits[0].details;
  if (typeof details.requestFingerprint !== 'string')
    throw new InternalServerErrorException({
      code: 'INVALID_FINANCIAL_RECEIPT',
      message: '金融请求回执来源不完整',
    });
  if (details.requestFingerprint !== fingerprint)
    throw new ConflictException({
      code: 'IDEMPOTENCY_CONFLICT',
      message: '请求键已用于不同业务内容',
    });
  return details;
}
