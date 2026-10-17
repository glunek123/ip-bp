import { InternalServerErrorException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import {
  sectionRecordDocumentSelect,
  sectionRecordFiles,
} from './case-section-record-edit-read';
import type { ExecutionFilingFollowupsDto } from './case-execution-filing-followup-read.dto';

const metadataSelect = {
  id: true,
  priorVersionId: true,
  fromRevision: true,
  toRevision: true,
  correctionReason: true,
  recordedAt: true,
} as const;
export const executionFeedbackReadSelect = {
  ...metadataSelect,
  feedbackId: true,
  feedbackOn: true,
  courtCaseNo: true,
  content: true,
} as const satisfies Prisma.CaseExecutionFilingFeedbackSelect;
export const executionSupplementReadSelect = {
  ...metadataSelect,
  supplementId: true,
  submittedOn: true,
  note: true,
  documents: {
    orderBy: { contentVersionId: 'asc' },
    select: sectionRecordDocumentSelect,
  },
} as const satisfies Prisma.CaseExecutionFilingSupplementSelect;
type Feedback = Prisma.CaseExecutionFilingFeedbackGetPayload<{
  select: typeof executionFeedbackReadSelect;
}>;
type Supplement = Prisma.CaseExecutionFilingSupplementGetPayload<{
  select: typeof executionSupplementReadSelect;
}>;
type Metadata = {
  id: string;
  priorVersionId: string | null;
  fromRevision: number;
  toRevision: number;
  correctionReason: string | null;
  recordedAt: Date;
};

function orderedRoots<T extends Metadata>(
  rows: readonly T[],
  rootId: (row: T) => string,
): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const root = rootId(row);
    const group = groups.get(root) ?? [];
    group.push(row);
    groups.set(root, group);
  }
  for (const [root, versions] of groups) {
    versions.sort((a, b) => a.toRevision - b.toRevision);
    let previous: T | undefined;
    for (const version of versions) {
      if (
        version.fromRevision !== (previous?.toRevision ?? 0) ||
        version.toRevision !== version.fromRevision + 1 ||
        version.priorVersionId !== (previous?.id ?? null) ||
        (previous === undefined &&
          (version.id !== root || version.correctionReason !== null)) ||
        (previous !== undefined &&
          (version.correctionReason === null ||
            version.correctionReason.trim().length === 0))
      )
        throw new InternalServerErrorException({
          code: 'INVALID_RECORD_SOURCE',
          message: '执行申请后续记录版本来源不一致',
        });
      previous = version;
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      b[0]!.recordedAt.getTime() - a[0]!.recordedAt.getTime() ||
      rootId(a[0]!).localeCompare(rootId(b[0]!)),
  );
}

export function projectExecutionFilingFollowups(
  input: Readonly<{
    filingId: string;
    internal: boolean;
    permissions: readonly [boolean, boolean, boolean, boolean];
    feedbacks: readonly Feedback[];
    supplements: readonly Supplement[];
  }>,
): ExecutionFilingFollowupsDto {
  const feedback = (v: Feedback) => ({
    id: v.id,
    revision: v.toRevision,
    recordedAt: v.recordedAt.toISOString(),
    feedbackOn: v.feedbackOn?.toISOString().slice(0, 10) ?? null,
    courtCaseNo: v.courtCaseNo,
    content: v.content,
  });
  const supplement = (v: Supplement) => ({
    id: v.id,
    revision: v.toRevision,
    recordedAt: v.recordedAt.toISOString(),
    submittedOn: v.submittedOn?.toISOString().slice(0, 10) ?? null,
    note: v.note,
    files: sectionRecordFiles(v.documents),
  });
  return {
    filingId: input.filingId,
    canRecordFeedback: input.permissions[0],
    canSubmitSupplement: input.permissions[2],
    feedbacks: orderedRoots(input.feedbacks, (v) => v.feedbackId).map(
      (versions) => ({
        feedbackId: versions[0]!.feedbackId,
        canCorrect: input.permissions[1],
        current: feedback(versions[versions.length - 1]!),
        history: versions.map((v) => ({
          ...feedback(v),
          ...(input.internal ? { correctionReason: v.correctionReason } : {}),
        })),
      }),
    ),
    supplements: orderedRoots(input.supplements, (v) => v.supplementId).map(
      (versions) => ({
        supplementId: versions[0]!.supplementId,
        canCorrect: input.permissions[3],
        current: supplement(versions[versions.length - 1]!),
        history: versions.map((v) => ({
          ...supplement(v),
          ...(input.internal ? { correctionReason: v.correctionReason } : {}),
        })),
      }),
    ),
  };
}
