import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import type { EvidenceSourceProjection } from './evidence-source-read';
import { evidenceHearingOn } from './evidence-rules';

export const evidenceGroupInclude = {
  items: {
    where: { removedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  },
  paperCertificates: {
    where: { removedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { contentVersion: { select: { originalFilename: true } } },
  },
  auditEvents: {
    where: {
      operation: { in: ['INITIALIZE_NOTARY_SOURCE', 'IMPORT_NOTARY_SOURCE'] },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.EvidenceGroupVersionInclude;
export type EvidenceGroupRecord = Prisma.EvidenceGroupVersionGetPayload<{
  include: typeof evidenceGroupInclude;
}>;
export type EvidenceElectronicFile = {
  materialId: string;
  contentVersionId: string;
  filename: string;
};
const day = (value: Date | null): string | null =>
  value?.toISOString().slice(0, 10) ?? null;
function invalidSource(): never {
  throw new InternalServerErrorException({
    code: 'INVALID_EVIDENCE_SOURCE',
    message: '证物来源或电子版本集合不完整',
  });
}
function files(value: Prisma.JsonValue | undefined): EvidenceElectronicFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10)
    return invalidSource();
  const result = value.map((file) => {
    if (
      typeof file !== 'object' ||
      file === null ||
      Array.isArray(file) ||
      typeof file.materialId !== 'string' ||
      typeof file.contentVersionId !== 'string' ||
      typeof file.filename !== 'string'
    )
      return invalidSource();
    return {
      materialId: file.materialId,
      contentVersionId: file.contentVersionId,
      filename: file.filename,
    };
  });
  if (
    new Set(result.map((file) => `${file.materialId}:${file.contentVersionId}`))
      .size !== result.length
  )
    return invalidSource();
  return result;
}

function paperFiles(
  group: EvidenceGroupRecord,
  paper: EvidenceGroupRecord['paperCertificates'][number],
): EvidenceElectronicFile[] {
  if (paper.sourceCertificateId) {
    const snapshots = group.auditEvents.flatMap((event) => {
      const snapshot = event.afterSnapshot;
      return typeof snapshot === 'object' &&
        snapshot !== null &&
        !Array.isArray(snapshot) &&
        snapshot.sourceCertificateId === paper.sourceCertificateId
        ? [snapshot]
        : [];
    });
    if (snapshots.length !== 1) return invalidSource();
    return files(snapshots[0]?.electronicFiles);
  }
  if (paper.contentMaterialId && paper.contentVersionId && paper.contentVersion)
    return [
      {
        materialId: paper.contentMaterialId,
        contentVersionId: paper.contentVersionId,
        filename: paper.contentVersion.originalFilename,
      },
    ];
  return [];
}

/** Source file snapshots are immutable history, not a promise that a file is currently downloadable. */
export function projectEvidenceGroup(
  group: EvidenceGroupRecord | null,
  source: EvidenceSourceProjection,
  keeperNames: ReadonlyMap<string, string> = new Map(),
) {
  if (
    group &&
    (group.departmentId !== source.departmentId ||
      group.sourceKind !== source.sourceKind ||
      group.sourceId !== source.sourceId ||
      (group.caseId !== null && group.caseId !== source.case.id))
  )
    return invalidSource();
  const paperCertificates =
    group?.paperCertificates.map((paper) => ({
      id: paper.id,
      number: paper.number,
      status: paper.status,
      issuedOn: day(paper.issuedOn),
      officeName: paper.officeName,
      pages: paper.pages,
      contentVersionId: paper.contentVersionId,
      contentMaterialId: paper.contentMaterialId,
      electronicFiles: paperFiles(group, paper),
    })) ?? [];
  return {
    groupId: group?.id ?? null,
    groupVersion: group?.version ?? 0,
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    sourceVersion: source.sourceVersion,
    case: source.case,
    items:
      group?.items.map((item) => ({
        id: item.id,
        groupId: group.id,
        caseId: source.case.id,
        displayCode: item.displayCode,
        shelfLocation: item.shelfLocation,
        status: item.status,
        remark: item.remark,
        provenance: item.provenance,
        name: item.name,
        kind: item.kind,
        collectedOn: day(item.collectedOn),
        keeperName: item.keeperUserId
          ? (keeperNames.get(item.keeperUserId) ?? null)
          : null,
        platform: source.case.platform,
        shopName: source.case.shopName,
        caseNo: source.case.caseNo,
        stage: source.case.stage,
        lawyerName: source.case.lawyerName,
        hearingOn: evidenceHearingOn({
          stage: source.case.stage,
          hearingOn: source.hearingOn,
          secondHearingOn: source.secondHearingOn,
        }),
        closedOn: source.closedOn,
        paperCertificates,
      })) ?? [],
    paperCertificates,
  };
}
export type EvidenceGroupView = ReturnType<typeof projectEvidenceGroup>;
