export function verifyNotaryListPreferenceMigration(): Promise<{
  emptyChain: boolean;
  previousSchemaPreserved: boolean;
  foreignKeyCode: string | null;
  restrictCode: string | null;
  failureCode: string | null;
  failedDeployStatus: number | null;
  failedDeployTransactionAborted: boolean;
  failedLedgerUnfinished: boolean;
  failedMigrationAtomic: boolean;
  resolvedAndRetried: boolean;
  failurePriorAccountPreserved: boolean;
}>;
