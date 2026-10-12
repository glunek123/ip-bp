export function verifyCaseExecutionSubmissionMigration(): Promise<{
  migrationCount: number;
  oldChainPreserved: boolean;
  first: boolean;
  resubmitted: boolean;
  history: boolean;
  invalidRejected: boolean;
  atomic: boolean;
  retry: boolean;
  lawyerDraftBefore: { accepted: boolean; rejectedCode: string | null };
  lawyerDraft: { accepted: boolean; rejectedCode: string | null };
  lawyerDraftAfterSubmit: { accepted: boolean; rejectedCode: string | null };
  actorInvalidRejected: boolean;
  actorAtomic: boolean;
  actorRetry: boolean;
  emptyChain: boolean;
}>;

export function verifyCaseExecutionConfirmationMigration(): Promise<{
  migrationCount: number;
  emptyChain: boolean;
  sameScopePermission: boolean;
  invalidStage: string | null;
  oldHistoryPreserved: boolean;
  directResubmit: string | null;
  directSubmissionInsert: string | null;
  enumFailureAtomic: boolean;
  guardFailureAtomic: boolean;
  guardRetry: boolean;
}>;
