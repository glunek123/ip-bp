import {
  NotaryMatterStage,
  NotaryOpeningReviewResult,
} from '../../generated/prisma/client';

type Decision = {
  result: NotaryOpeningReviewResult;
  reason: string | null;
  decidedAt: Date;
  archivedAt: Date | null;
};

export function openingReviewMatchesStage(
  stage: NotaryMatterStage,
  decision: Decision | null,
): boolean {
  if (
    stage === 'PENDING_EVIDENCE' ||
    stage === 'WAITING_UNBOX' ||
    stage === 'UNBOX_REVIEW'
  )
    return decision === null;
  if (decision === null) return false;
  if (stage === 'ISSUANCE_DECISION')
    return (
      decision.result === 'INFRINGEMENT' &&
      decision.reason === null &&
      decision.archivedAt === null
    );
  return (
    stage === 'ARCHIVED' &&
    decision.result === 'NO_INFRINGEMENT' &&
    typeof decision.reason === 'string' &&
    decision.reason.trim() === decision.reason &&
    decision.reason.length >= 1 &&
    decision.reason.length <= 2000 &&
    decision.archivedAt instanceof Date &&
    decision.archivedAt.getTime() === decision.decidedAt.getTime()
  );
}
