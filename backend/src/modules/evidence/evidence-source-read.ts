import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { DatabaseService } from '../../database/database.service';
import { Prisma } from '../../generated/prisma/client';
import type { EvidenceSourceKind } from './evidence-source-contract';
import { canonicalEvidenceSource } from './evidence-source-rules';

type Reader = Prisma.TransactionClient | DatabaseService;
const correctionMetadata = {
  id: true,
  priorCorrectionId: true,
  fromRevision: true,
  toRevision: true,
} as const;
const caseSelect = {
  id: true,
  departmentId: true,
  businessNo: true,
  createdAt: true,
  version: true,
  stage: true,
  courtCaseNo: true,
  sourceNotaryMatterId: true,
  certificateId: true,
  externalEntry: { select: { known: true } },
  sourceLead: { select: { platform: true, shopName: true } },
  lawyers: {
    where: { role: 'PRIMARY', endedAt: null },
    select: { lawyer: { select: { fullName: true } } },
    orderBy: { id: 'asc' },
  },
  hearingArrangements: {
    where: { trialRound: { sequence: 1 } },
    orderBy: [{ toVersion: 'desc' }, { id: 'asc' }],
    take: 1,
    select: {
      hearingAt: true,
      recordCorrections: {
        orderBy: { toRevision: 'asc' },
        select: { ...correctionMetadata, hearingAt: true },
      },
    },
  },
  currentSecondInstanceProgress: { select: { hearingAt: true } },
  closure: {
    select: {
      currentVersion: { select: { id: true, closeAt: true } },
      recordCorrections: {
        orderBy: { toRevision: 'asc' },
        select: {
          ...correctionMetadata,
          sourceClosureVersionId: true,
          closeAt: true,
        },
      },
    },
  },
} satisfies Prisma.CaseSelect;
const notarySelect = {
  id: true,
  departmentId: true,
  businessNo: true,
  version: true,
  createdAt: true,
  sourceSnapshot: true,
  sourceLead: { select: { platform: true, shopName: true } },
  notaryOffice: { select: { name: true } },
  evidence: { select: { evidenceAt: true } },
  certificate: {
    select: {
      id: true,
      actorUserId: true,
      notaryOfficeAccountBindingId: true,
      certificateNo: true,
      certificateDate: true,
    },
  },
  case: { select: caseSelect },
} satisfies Prisma.NotaryMatterSelect;
type CaseRecord = Prisma.CaseGetPayload<{ select: typeof caseSelect }>;
type NotaryRecord = Prisma.NotaryMatterGetPayload<{
  select: typeof notarySelect;
}>;

export type EvidenceSourceProjection = {
  sourceKind: EvidenceSourceKind;
  sourceId: string;
  sourceVersion: number;
  departmentId: string;
  businessNo: string;
  sourceBusinessNo?: string;
  createdAt: Date;
  case: {
    id: string | null;
    platform: string | null;
    shopName: string | null;
    caseNo: string | null;
    stage: string | null;
    lawyerName: string | null;
  };
  hearingOn: string | null;
  secondHearingOn: string | null;
  closedOn: string | null;
  certificate: {
    id: string;
    actorUserId: string;
    notaryOfficeAccountBindingId: string;
    number: string;
    issuedOn: Date;
    officeName: string;
    evidenceAt: Date;
  } | null;
};
const day = (value: Date | null | undefined): string | null =>
  value?.toISOString().slice(0, 10) ?? null;
function jsonText(
  value: Prisma.JsonValue | undefined,
  key: string,
): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  const field = value[key];
  return typeof field === 'string' && field.trim() ? field : null;
}
function corrupt(): InternalServerErrorException {
  return new InternalServerErrorException({
    code: 'INVALID_EVIDENCE_SOURCE',
    message: '证物关联来源不完整',
  });
}
function missing(): NotFoundException {
  return new NotFoundException({
    code: 'EVIDENCE_SOURCE_NOT_FOUND',
    message: '未找到可用的证物来源',
  });
}

/** Read only this domain's required date while checking the persisted correction lineage. */
function effectiveDate<
  T extends {
    id: string;
    priorCorrectionId: string | null;
    fromRevision: number;
    toRevision: number;
  },
>(
  original: Date | null,
  corrections: readonly T[],
  value: (row: T) => Date | null,
): Date | null {
  let revision = 0;
  let priorId: string | null = null;
  let effective = original;
  for (const correction of corrections) {
    if (
      correction.priorCorrectionId !== priorId ||
      correction.fromRevision !== revision ||
      correction.toRevision !== revision + 1
    )
      throw corrupt();
    effective = value(correction);
    revision = correction.toRevision;
    priorId = correction.id;
  }
  return effective;
}

function caseProjection(record: CaseRecord) {
  const hearing = record.hearingArrangements[0];
  const hearingOn = hearing
    ? day(
        effectiveDate(
          hearing.hearingAt,
          hearing.recordCorrections,
          (correction) => correction.hearingAt,
        ),
      )
    : null;
  const closure = record.closure?.currentVersion;
  const closedOn = closure
    ? day(
        effectiveDate(
          closure.closeAt,
          record.closure?.recordCorrections.filter(
            (correction) => correction.sourceClosureVersionId === closure.id,
          ) ?? [],
          (correction) => correction.closeAt,
        ),
      )
    : null;
  return {
    case: {
      id: record.id,
      platform:
        record.sourceLead?.platform ??
        jsonText(record.externalEntry?.known, 'platform'),
      shopName:
        record.sourceLead?.shopName ??
        jsonText(record.externalEntry?.known, 'shopName'),
      caseNo: record.courtCaseNo,
      stage: record.stage,
      lawyerName:
        record.lawyers
          .map((assignment) => assignment.lawyer.fullName)
          .join(' / ') || null,
    },
    hearingOn,
    secondHearingOn: day(record.currentSecondInstanceProgress?.hearingAt),
    closedOn,
  };
}

function notaryProjection(record: NotaryRecord): EvidenceSourceProjection {
  if (!record.certificate || !record.evidence) throw corrupt();
  if (
    record.case &&
    (record.case.sourceNotaryMatterId !== record.id ||
      record.case.certificateId !== record.certificate.id ||
      record.case.departmentId !== record.departmentId)
  )
    throw corrupt();
  const display = record.case
    ? caseProjection(record.case)
    : {
        case: {
          id: null,
          platform:
            jsonText(record.sourceSnapshot, 'platform') ??
            record.sourceLead.platform,
          shopName:
            jsonText(record.sourceSnapshot, 'shopName') ??
            record.sourceLead.shopName,
          caseNo: null,
          stage: null,
          lawyerName: null,
        },
        hearingOn: null,
        secondHearingOn: null,
        closedOn: null,
      };
  return {
    sourceKind: 'NOTARY_MATTER',
    sourceId: record.id,
    sourceVersion: record.version,
    departmentId: record.departmentId,
    businessNo: record.case?.businessNo ?? record.businessNo,
    sourceBusinessNo: record.businessNo,
    createdAt: record.createdAt,
    ...display,
    certificate: {
      id: record.certificate.id,
      actorUserId: record.certificate.actorUserId,
      notaryOfficeAccountBindingId:
        record.certificate.notaryOfficeAccountBindingId,
      number: record.certificate.certificateNo,
      issuedOn: record.certificate.certificateDate,
      officeName: record.notaryOffice.name,
      evidenceAt: record.evidence.evidenceAt,
    },
  };
}

/** The evidence application service authorizes the action before calling these readers. */
export async function readEvidenceSource(
  reader: Reader,
  departmentId: string,
  sourceKind: EvidenceSourceKind,
  sourceId: string,
): Promise<EvidenceSourceProjection> {
  if (sourceKind === 'CASE') {
    const record = await reader.case.findFirst({
      where: { id: sourceId, departmentId },
      select: caseSelect,
    });
    if (!record) throw missing();
    const canonical = canonicalEvidenceSource(sourceKind, sourceId, record);
    if (canonical.sourceKind === 'NOTARY_MATTER') {
      const projected = await readEvidenceSource(
        reader,
        departmentId,
        'NOTARY_MATTER',
        canonical.sourceId,
      );
      if (projected.case.id !== record.id) throw corrupt();
      return projected;
    }
    if (
      !record.externalEntry ||
      record.certificateId !== null ||
      record.sourceLead !== null
    )
      throw corrupt();
    return {
      sourceKind: 'CASE',
      sourceId: record.id,
      sourceVersion: record.version,
      departmentId,
      businessNo: record.businessNo,
      createdAt: record.createdAt,
      ...caseProjection(record),
      certificate: null,
    };
  }
  const record = await reader.notaryMatter.findFirst({
    where: { id: sourceId, departmentId, certificate: { isNot: null } },
    select: notarySelect,
  });
  if (!record) throw missing();
  return notaryProjection(record);
}

/** Real sources are discoverable even when a ledger group has no active items. No writes. */
export async function listEvidenceSources(
  reader: Reader,
  departmentId: string,
): Promise<EvidenceSourceProjection[]> {
  const [externalCases, issuedMatters] = await Promise.all([
    reader.case.findMany({
      where: { departmentId, sourceNotaryMatterId: null },
      select: caseSelect,
    }),
    reader.notaryMatter.findMany({
      where: { departmentId, certificate: { isNot: null } },
      select: notarySelect,
    }),
  ]);
  const projections = issuedMatters.map(notaryProjection);
  for (const record of externalCases) {
    if (
      !record.externalEntry ||
      record.certificateId !== null ||
      record.sourceLead !== null
    )
      throw corrupt();
    projections.push({
      sourceKind: 'CASE',
      sourceId: record.id,
      sourceVersion: record.version,
      departmentId,
      businessNo: record.businessNo,
      createdAt: record.createdAt,
      ...caseProjection(record),
      certificate: null,
    });
  }
  return projections.sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() ||
      left.sourceId.localeCompare(right.sourceId),
  );
}
