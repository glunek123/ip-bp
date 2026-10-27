import { InternalServerErrorException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import type { InitializeNotaryEvidenceFacts } from './evidence-source-contract';
import { isFrozenCertificateVersion } from '../materials';

function invalidSource(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'INVALID_EVIDENCE_SOURCE',
    message: '出证证物来源不完整',
  });
}

/** Internal only: called after the original issuance audit and material freezes in the SAME transaction. */
export async function initializeNotaryEvidence(
  tx: Prisma.TransactionClient,
  facts: InitializeNotaryEvidenceFacts,
): Promise<{ groupId: string; created: boolean }> {
  await tx.$queryRaw`SELECT id FROM notary_matters WHERE id = ${facts.sourceNotaryMatterId}::uuid AND department_id = ${facts.departmentId}::uuid FOR UPDATE`;
  const certificate = await tx.notaryCertificate.findFirst({
    where: {
      id: facts.certificateId,
      matterId: facts.sourceNotaryMatterId,
      departmentId: facts.departmentId,
      actorUserId: facts.actorUserId,
      notaryOfficeAccountBindingId: facts.notaryOfficeAccountBindingId,
      internalActorUserId: facts.internalActorUserId ?? null,
    },
    select: {
      certificateNo: true,
      certificateDate: true,
      toVersion: true,
      case: { select: { id: true } },
      matter: {
        select: {
          version: true,
          evidence: { select: { evidenceAt: true } },
          notaryOffice: { select: { name: true } },
        },
      },
    },
  });
  const linkedCase =
    facts.caseId === null
      ? null
      : await tx.case.findFirst({
          where: {
            id: facts.caseId,
            departmentId: facts.departmentId,
            sourceNotaryMatterId: facts.sourceNotaryMatterId,
            certificateId: facts.certificateId,
          },
          select: { id: true },
        });
  const audit = await tx.auditEvent.findFirst({
    where: {
      id: facts.sourceActionEventId,
      departmentId: facts.departmentId,
      actorUserId: facts.actorUserId,
      notaryOfficeAccountBindingId: facts.notaryOfficeAccountBindingId,
      internalActorUserId: facts.internalActorUserId ?? null,
      resourceType: 'notary_matter',
      resourceId: facts.sourceNotaryMatterId,
      action: 'notary.certificate_issued',
      details: { path: ['certificateId'], equals: facts.certificateId },
    },
    select: { id: true, details: true },
  });
  if (
    !certificate ||
    (facts.caseId !== null && !linkedCase) ||
    !audit ||
    !certificate.matter.evidence ||
    (certificate.case?.id ?? null) !== facts.caseId ||
    certificate.certificateNo !== facts.certificateNo ||
    certificate.certificateDate.getTime() !== facts.certificateDate.getTime() ||
    certificate.matter.evidence.evidenceAt.getTime() !==
      facts.evidenceAt.getTime() ||
    certificate.matter.notaryOffice.name !== facts.officeName
  )
    throw invalidSource();
  const references = await tx.materialReference.findMany({
    where: {
      departmentId: facts.departmentId,
      resourceType: 'notary_matter',
      resourceId: facts.sourceNotaryMatterId,
      actionEventId: audit.id,
      purpose: 'NOTARY_CERTIFICATE',
      material: {
        departmentId: facts.departmentId,
        category: 'NOTARY_CERTIFICATE',
        ownerType: 'NOTARY_MATTER',
        ownerId: facts.sourceNotaryMatterId,
      },
    },
    select: {
      materialId: true,
      contentVersionId: true,
      contentVersion: { select: { originalFilename: true, mimeType: true } },
    },
    orderBy: { contentVersionId: 'asc' },
  });
  const expected = new Map(
    facts.files.map((file) => [
      `${file.materialId}:${file.contentVersionId}`,
      file,
    ]),
  );
  const details = audit.details;
  const frozenIds =
    details &&
    typeof details === 'object' &&
    !Array.isArray(details) &&
    Array.isArray(details.contentVersionIds)
      ? details.contentVersionIds
      : [];
  if (
    facts.files.length < 1 ||
    facts.files.length > 10 ||
    expected.size !== facts.files.length ||
    references.length !== expected.size ||
    frozenIds.length !== facts.files.length ||
    new Set(frozenIds).size !== frozenIds.length ||
    facts.files.some(
      (file) =>
        !isFrozenCertificateVersion(
          details,
          'NOTARY_CERTIFICATE',
          file.contentVersionId,
        ),
    ) ||
    references.some((ref) => {
      const file = expected.get(`${ref.materialId}:${ref.contentVersionId}`);
      return (
        !file ||
        file.originalFilename !== ref.contentVersion.originalFilename ||
        file.mimeType !== ref.contentVersion.mimeType
      );
    })
  )
    throw invalidSource();
  const existing = await tx.evidenceGroupVersion.findUnique({
    where: {
      departmentId_sourceKind_sourceId: {
        departmentId: facts.departmentId,
        sourceKind: 'NOTARY_MATTER',
        sourceId: facts.sourceNotaryMatterId,
      },
    },
  });
  if (existing?.caseId && existing.caseId !== facts.caseId)
    throw invalidSource();
  if (existing?.sourceInitializedAt)
    return { groupId: existing.id, created: false };
  const group = existing
    ? await tx.evidenceGroupVersion.update({
        where: { id: existing.id },
        data: {
          caseId: facts.caseId,
          sourceInitializedAt: new Date(),
          version: { increment: 1 },
        },
      })
    : await tx.evidenceGroupVersion.create({
        data: {
          departmentId: facts.departmentId,
          sourceKind: 'NOTARY_MATTER',
          sourceId: facts.sourceNotaryMatterId,
          sourceNotaryMatterId: facts.sourceNotaryMatterId,
          caseId: facts.caseId,
          sourceInitializedAt: new Date(),
        },
      });
  if (existing && existing.caseId === null) {
    await tx.evidenceItem.updateMany({
      where: { groupId: group.id, departmentId: facts.departmentId },
      data: {
        caseId: facts.caseId,
        version: { increment: 1 },
        updatedByUserId: facts.actorUserId,
      },
    });
    await tx.evidencePaperCertificate.updateMany({
      where: { groupId: group.id, departmentId: facts.departmentId },
      data: {
        caseId: facts.caseId,
        version: { increment: 1 },
        updatedByUserId: facts.actorUserId,
      },
    });
  }
  const identity = {
    departmentId: facts.departmentId,
    groupId: group.id,
    sourceKind: 'NOTARY_MATTER' as const,
    sourceId: facts.sourceNotaryMatterId,
    sourceNotaryMatterId: facts.sourceNotaryMatterId,
    caseId: facts.caseId,
    createdByUserId: facts.actorUserId,
    updatedByUserId: facts.actorUserId,
  };
  const item = await tx.evidenceItem.create({
    data: {
      ...identity,
      name: facts.shopName,
      collectedOn: facts.evidenceAt,
      provenance: 'notary.certificate_issued',
      status: 'UNDELIVERED',
    },
  });
  const paper = await tx.evidencePaperCertificate.create({
    data: {
      ...identity,
      sourceCertificateId: facts.certificateId,
      number: facts.certificateNo,
      issuedOn: facts.certificateDate,
      officeName: facts.officeName,
      status: 'NOT_ISSUED',
    },
  });
  await tx.evidenceAuditEvent.create({
    data: {
      departmentId: facts.departmentId,
      actorUserId: facts.actorUserId,
      notaryOfficeAccountBindingId: facts.notaryOfficeAccountBindingId,
      internalActorUserId: facts.internalActorUserId ?? null,
      operation: 'INITIALIZE_NOTARY_SOURCE',
      groupId: group.id,
      itemId: item.id,
      paperCertificateId: paper.id,
      afterSnapshot: {
        sourceKind: 'NOTARY_MATTER',
        sourceId: facts.sourceNotaryMatterId,
        caseId: facts.caseId,
        sourceCertificateId: facts.certificateId,
        sourceVersion: certificate.matter.version,
        issuanceVersion: certificate.toVersion,
        originalAuditEventIds: [facts.sourceActionEventId],
        electronicFiles: facts.files.map((file) => ({
          materialId: file.materialId,
          contentVersionId: file.contentVersionId,
          filename: file.originalFilename,
        })),
        itemStatus: 'UNDELIVERED',
        paperStatus: 'NOT_ISSUED',
      },
    },
  });
  return { groupId: group.id, created: true };
}
