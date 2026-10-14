export function verifyCaseArchiveMigration(caseId: string): Promise<{
  empty: boolean;
  oldForeignKeys: number;
  enumCommitted: boolean;
  injectedFailure: boolean;
  ddlRolledBack: boolean;
  forwardRecovery: boolean;
  preserved: boolean;
  oldBytesPreserved: boolean;
  noGrantBackfill: boolean;
  stageOnlyRejected: boolean;
}>;
