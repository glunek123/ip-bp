export function verifyCaseExecutionSubmissionDatabase(): Promise<{
  first: boolean;
  concurrentSingleWinner: boolean;
  faultRollbacks: boolean;
  replay: boolean;
  revokedReplay: string | null;
  changedKey: string | null;
  firstRead: boolean;
  lawyerRead: boolean;
  resubmitted: boolean;
  lawyerSubmitted: boolean;
  lawyerUploadBytes: boolean;
  lawyerRevokedReplay: string | null;
  lawyerAssignmentRevokedReplay: string | null;
  staleAnchor: string | null;
  noChange: string | null;
  serviceChoiceBlocked: string | null;
  history: boolean;
  lawyerHistory: boolean;
  oldFrozenBytes: boolean;
  blockedRevocation: string | null;
  bypassStage: string | null;
  final: boolean;
}>;

export function verifyCaseExecutionConfirmationDatabase(): Promise<{
  source: boolean;
  wrongSubmission: string | null;
  wrongCase: string | null;
  faultRollbacks: boolean;
  raceSingleWinner: boolean;
  raceBoundCurrent: boolean;
  response: boolean;
  replay: boolean;
  changedKey: string | null;
  revokedReplay: string | null;
  internalProjection: boolean;
  lawyerProjection: boolean;
  resubmitBlocked: string | null;
  sqlResubmitBlocked: string | null;
  rejectedStageReversal: string | null;
  singleFact: boolean;
  preservedBundle: boolean;
}>;

export function verifyExecutionAppealSource(
  resultKind: 'AFFIRM' | 'CHANGE' | 'REMAND',
  raceWithRevocation: boolean,
): Promise<
  | { remandRejected: string | null; noFact: boolean }
  | {
      badSourcesRejected: boolean;
      raceSingleWinner: boolean;
    }
  | {
      badSourcesRejected: boolean;
      accepted: boolean;
      serviceBlocked: string | null;
      sqlBlocked: string | null;
    }
  | { accepted: boolean }
>;

export function verifyExecutionConfirmationAppealSources(): Promise<{
  change: boolean;
  affirm: boolean;
}>;

export function verifyDirectExecutionChoiceRace(): Promise<{
  raceSingleWinner: boolean;
}>;
