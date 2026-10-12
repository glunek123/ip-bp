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
