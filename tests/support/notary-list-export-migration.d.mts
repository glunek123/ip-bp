export function verifyNotaryListExportMigration(): Promise<{
  emptyChain: boolean;
  previousSchemaPreserved: boolean;
  roleManagerGrantOnly: boolean;
  readerUnchanged: boolean;
  affectedRevisionOnly: boolean;
  failedDeployStatus: number | null;
  failedLedgerUnfinished: boolean;
  failedMigrationAtomic: boolean;
  resolvedAndRetried: boolean;
}>;
