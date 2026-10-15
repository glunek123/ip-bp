import { InternalServerErrorException } from '@nestjs/common';

export interface SectionRecordCorrectionMetadata {
  id: string;
  priorCorrectionId: string | null;
  fromRevision: number;
  toRevision: number;
  correctionReason: string;
  recordedAt: Date;
  recordedByUserId: string;
}

/** Only enumerated public fields leave this boundary; database anchors never do. */
export function projectSectionRecord<
  Values extends object,
  Correction extends SectionRecordCorrectionMetadata,
>(
  original: Values,
  corrections: readonly Correction[],
  values: (correction: Correction) => Values,
) {
  let revision = 0;
  let priorId: string | null = null;
  for (const correction of corrections) {
    if (
      correction.fromRevision !== revision ||
      correction.toRevision !== revision + 1 ||
      correction.priorCorrectionId !== priorId
    ) {
      throw new InternalServerErrorException({
        code: 'INVALID_RECORD_SOURCE',
        message: '资料更正来源不一致',
      });
    }
    revision = correction.toRevision;
    priorId = correction.id;
  }
  return {
    revision,
    original,
    effective:
      corrections.length === 0
        ? original
        : values(corrections[corrections.length - 1]!),
    history: corrections.map((correction) => ({
      ...values(correction),
      id: correction.id,
      priorCorrectionId: correction.priorCorrectionId,
      fromRevision: correction.fromRevision,
      toRevision: correction.toRevision,
      correctionReason: correction.correctionReason,
      recordedAt: correction.recordedAt.toISOString(),
      recordedByUserId: correction.recordedByUserId,
    })),
  };
}

export const sectionRecordDocumentSelect = {
  materialId: true,
  contentVersionId: true,
  contentVersion: { select: { originalFilename: true, mimeType: true } },
} as const;

export function sectionRecordFiles(
  documents: readonly {
    materialId: string;
    contentVersionId: string;
    contentVersion: { originalFilename: string; mimeType: string };
  }[],
) {
  return documents.map((document) => ({
    materialId: document.materialId,
    contentVersionId: document.contentVersionId,
    originalFilename: document.contentVersion.originalFilename,
    mimeType: document.contentVersion.mimeType,
  }));
}

export const sectionRecordCorrectionSelect = {
  executionMailingRecordCorrections: {
    orderBy: { toRevision: 'asc' },
    include: {
      documents: {
        orderBy: { contentVersionId: 'asc' },
        select: sectionRecordDocumentSelect,
      },
    },
  },
  executionFilingRecordCorrections: {
    orderBy: { toRevision: 'asc' },
    include: {
      documents: {
        orderBy: { contentVersionId: 'asc' },
        select: sectionRecordDocumentSelect,
      },
    },
  },
  executionFinishRecordCorrections: {
    orderBy: { toRevision: 'asc' },
    include: {
      documents: {
        orderBy: { contentVersionId: 'asc' },
        select: sectionRecordDocumentSelect,
      },
    },
  },
  hearingRecordCorrections: { orderBy: { toRevision: 'asc' } },
  judgmentRecordCorrections: {
    orderBy: { toRevision: 'asc' },
    include: {
      documents: {
        orderBy: { contentVersionId: 'asc' },
        select: sectionRecordDocumentSelect,
      },
    },
  },
  closureRecordCorrections: {
    orderBy: { toRevision: 'asc' },
    include: {
      documents: {
        orderBy: { contentVersionId: 'asc' },
        select: sectionRecordDocumentSelect,
      },
    },
  },
} as const;
