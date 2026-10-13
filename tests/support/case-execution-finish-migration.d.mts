export function verifyExecutionFinishMigration(caseId: string): Promise<{
  empty: boolean;
  foreignKeys: number;
  enumCommitted: boolean;
  injectedFailure: boolean;
  ddlRolledBack: boolean;
  forwardRecovery: boolean;
  preserved: boolean;
  oldBytesPreserved: boolean;
  stageOnlyRejected: boolean;
}>;
