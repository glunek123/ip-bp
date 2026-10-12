export function verifyCaseExecutionSubmissionMigration(): Promise<{
  migrationCount: number;
  oldChainPreserved: boolean;
  first: boolean;
  resubmitted: boolean;
  history: boolean;
  invalidRejected: boolean;
  atomic: boolean;
  retry: boolean;
}>;
