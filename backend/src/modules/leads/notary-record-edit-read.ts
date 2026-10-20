import {
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { AccessControlService } from '../../access-control/access-control.service';
import { ActorContext } from '../../access-control/actor-context';
import { NotaryMatterStage } from '../../generated/prisma/client';

export type RecordLogistics = {
  id: string;
  companyState: 'PRESENT' | 'NONE';
  companyValue: string | null;
  trackingState: 'PRESENT' | 'NONE';
  trackingValue: string | null;
};
export type EvidenceEditValue = {
  evidenceAt: string;
  logistics: RecordLogistics[];
};
export type SenderEditValue = {
  senderName: string | null;
  senderPhone: string | null;
  senderAddress: string | null;
};
type OriginalMatter = {
  id: string;
  departmentId: string;
  stage: NotaryMatterStage;
  sourceLead: { responsibleUserId: string; teamId: string | null };
  evidence: { evidenceAt: Date; logistics: RecordLogistics[] } | null;
  opening: SenderEditValue | null;
  evidenceCorrections: Array<{
    id: string;
    revision: number;
    correctionReason: string;
    actorUserId: string;
    recordedAt: Date;
    evidenceAt: Date;
    logistics: RecordLogistics[];
  }>;
  openingSenderCorrections: Array<
    {
      id: string;
      revision: number;
      correctionReason: string;
      actorUserId: string;
      recordedAt: Date;
    } & SenderEditValue
  >;
};

const evidenceStages: NotaryMatterStage[] = [
  'WAITING_UNBOX',
  'UNBOX_REVIEW',
  'ISSUANCE_DECISION',
  'WAITING_CERTIFICATE',
  'WAITING_RETURN',
];
const senderStages: NotaryMatterStage[] = [
  'UNBOX_REVIEW',
  'ISSUANCE_DECISION',
  'WAITING_CERTIFICATE',
  'WAITING_RETURN',
];
const evidenceValue = (row: {
  evidenceAt: Date;
  logistics: RecordLogistics[];
}): EvidenceEditValue => ({
  evidenceAt: row.evidenceAt.toISOString().slice(0, 10),
  logistics: row.logistics.map(
    ({ id, companyState, companyValue, trackingState, trackingValue }) => ({
      id,
      companyState,
      companyValue,
      trackingState,
      trackingValue,
    }),
  ),
});
const senderValue = (row: SenderEditValue): SenderEditValue => ({
  senderName: row.senderName,
  senderPhone: row.senderPhone,
  senderAddress: row.senderAddress,
});
function corrupt(): never {
  throw new InternalServerErrorException({
    code: 'INTERNAL_ERROR',
    message: '公证资料更正历史不完整',
  });
}

export async function readNotaryRecordEdits(
  access: AccessControlService,
  actor: ActorContext,
  matter: OriginalMatter,
) {
  const evidenceRows = matter.evidenceCorrections;
  const senderRows = matter.openingSenderCorrections;
  const facts = {
    departmentId: matter.departmentId,
    responsibleUserId: matter.sourceLead.responsibleUserId,
    ...(matter.sourceLead.teamId === null
      ? {}
      : { teamId: matter.sourceLead.teamId }),
  };
  let permitted = false;
  try {
    await access.authorizeLead(actor, 'notary.record.correct', facts);
    permitted = true;
  } catch (error) {
    if (!(error instanceof ForbiddenException)) throw error;
  }
  const history = <T>(
    rows: Array<{
      id: string;
      revision: number;
      correctionReason: string;
      actorUserId: string;
      recordedAt: Date;
    }>,
    original: T,
    value: (index: number) => T,
  ) => {
    let previous = original;
    return rows.map((row, index) => {
      if (row.revision !== index + 1) corrupt();
      const after = value(index);
      const entry = {
        correctionId: row.id,
        revision: row.revision,
        correctionReason: row.correctionReason,
        actorUserId: row.actorUserId,
        recordedAt: row.recordedAt.toISOString(),
        before: previous,
        after,
      };
      previous = after;
      return entry;
    });
  };
  if (matter.evidence === null && evidenceRows.length > 0) corrupt();
  if (matter.opening === null && senderRows.length > 0) corrupt();
  const originalEvidence =
    matter.evidence === null ? null : evidenceValue(matter.evidence);
  const originalSender =
    matter.opening === null ? null : senderValue(matter.opening);
  const evidenceHistory =
    originalEvidence === null
      ? []
      : history(evidenceRows, originalEvidence, (index) =>
          evidenceValue(evidenceRows[index]),
        );
  const senderHistory =
    originalSender === null
      ? []
      : history(senderRows, originalSender, (index) =>
          senderValue(senderRows[index]),
        );
  return {
    evidence:
      originalEvidence === null
        ? null
        : {
            canCorrect: permitted && evidenceStages.includes(matter.stage),
            revision: evidenceRows.length,
            original: originalEvidence,
            effective: evidenceHistory.at(-1)?.after ?? originalEvidence,
            history: evidenceHistory,
          },
    openingSender:
      originalSender === null
        ? null
        : {
            canCorrect: permitted && senderStages.includes(matter.stage),
            revision: senderRows.length,
            original: originalSender,
            effective: senderHistory.at(-1)?.after ?? originalSender,
            history: senderHistory,
          },
  };
}
