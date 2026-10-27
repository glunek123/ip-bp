import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

/** Called only by the trusted issuance transaction, after its source audit. */
export type InitializeNotaryFeesFacts = Readonly<{
  departmentId: string;
  matterId: string;
  caseId: string;
  certificateId: string;
  sourceActionEventId: string;
}>;

export async function initializeNotaryFees(
  tx: Prisma.TransactionClient,
  facts: InitializeNotaryFeesFacts,
): Promise<{ createdCount: number }> {
  const invalid = () =>
    new ConflictException({
      code: 'FEE_SOURCE_INVALID',
      message: '费用原始来源不完整或已变化',
    });
  const certificate = await tx.notaryCertificate.findFirst({
    where: {
      id: facts.certificateId,
      matterId: facts.matterId,
      departmentId: facts.departmentId,
      case: {
        id: facts.caseId,
        departmentId: facts.departmentId,
        sourceNotaryMatterId: facts.matterId,
      },
    },
    include: {
      fees: true,
      matter: { select: { evidence: true } },
    },
  });
  if (certificate === null) throw invalid();
  const event = await tx.auditEvent.findFirst({
    where: {
      id: facts.sourceActionEventId,
      departmentId: facts.departmentId,
      resourceType: 'notary_matter',
      resourceId: facts.matterId,
      action: 'notary.certificate_issued',
      actorUserId: certificate.actorUserId,
      notaryOfficeAccountBindingId: certificate.notaryOfficeAccountBindingId,
      internalActorUserId: certificate.internalActorUserId,
    },
  });
  const details = event?.details;
  if (
    event === null ||
    details === null ||
    typeof details !== 'object' ||
    Array.isArray(details) ||
    details.certificateId !== facts.certificateId ||
    details.fromVersion !== certificate.fromVersion ||
    details.toVersion !== certificate.toVersion
  )
    throw invalid();
  const source = certificate.matter.evidence;
  if (
    source === null ||
    source.matterId !== facts.matterId ||
    source.departmentId !== facts.departmentId
  )
    throw invalid();
  const types = {
    NOTARY: '公证费',
    INVESTIGATION: '调查费',
    DISCLOSURE: '披露费',
  } as const;
  const candidates = [
    ...certificate.fees.map((fee) => ({
      type: types[fee.category],
      state: fee.state,
      amount: fee.amount,
      feeDate: certificate.certificateDate,
      sourceKind: 'NOTARY_CERTIFICATE_FEE',
      sourceId: `${certificate.id}:${fee.category}`,
    })),
    {
      type: '样品费',
      state: source.sampleFeeState,
      amount: source.sampleFeeAmount,
      feeDate: source.evidenceAt,
      sourceKind: 'NOTARY_MATTER_EVIDENCE',
      sourceId: `${source.matterId}:sample`,
    },
  ];
  let createdCount = 0;
  for (const candidate of candidates) {
    // PENDING is a fact; it must never be converted to an invented zero.
    if (candidate.state !== 'KNOWN') continue;
    if (
      candidate.amount === null ||
      !candidate.amount.isFinite() ||
      candidate.amount.isNegative() ||
      candidate.amount.decimalPlaces() > 2 ||
      Number.isNaN(candidate.feeDate.getTime())
    )
      throw invalid();
    const identity = {
      departmentId: facts.departmentId,
      sourceKind: candidate.sourceKind,
      sourceId: candidate.sourceId,
    };
    const prior = await tx.feeRecord.findUnique({
      where: { departmentId_sourceKind_sourceId: identity },
    });
    if (prior !== null) {
      if (
        prior.caseId !== facts.caseId ||
        prior.source !== 'auto' ||
        prior.type !== candidate.type ||
        !prior.amount.equals(candidate.amount) ||
        prior.feeDate.getTime() !== candidate.feeDate.getTime()
      )
        throw invalid();
      // A removed source row remains removed; replay never revives it.
      continue;
    }
    const fee = await tx.feeRecord.create({
      data: {
        ...identity,
        caseId: facts.caseId,
        type: candidate.type,
        direction: '支出',
        status: '未发起',
        amount: candidate.amount,
        feeDate: candidate.feeDate,
        source: 'auto',
        actorUserId: null,
        idempotencyKey: null,
      },
    });
    await tx.auditEvent.create({
      data: {
        departmentId: facts.departmentId,
        actorUserId: event.actorUserId,
        notaryOfficeAccountBindingId: event.notaryOfficeAccountBindingId,
        internalActorUserId: event.internalActorUserId,
        resourceType: 'FEE',
        resourceId: fee.id,
        action: 'fee.source-initialized',
        details: {
          ...identity,
          caseId: facts.caseId,
          sourceActionEventId: event.id,
          amount: candidate.amount.toFixed(2),
          feeDate: candidate.feeDate.toISOString().slice(0, 10),
        },
      },
    });
    createdCount += 1;
  }
  return { createdCount };
}
