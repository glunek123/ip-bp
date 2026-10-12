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
>;

export function verifyDirectExecutionChoiceRace(): Promise<{
  raceSingleWinner: boolean;
}>;
