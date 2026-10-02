export function verifyNotaryReturnArchiveBatchMigration(): Promise<{
  migrationCount: number;
  emptyChain: boolean;
  previousSchemaPreserved: boolean;
  constraints: {
    duplicateCode: string;
    badActorCode: string;
    badKeyCode: string;
    mutateCode: string;
    deleteCode: string;
  };
  failedDeployStatus: number;
  failedMigrationAtomic: boolean;
  resolvedAndRetried: boolean;
}>;
