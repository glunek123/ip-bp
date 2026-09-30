export function verifyNotaryListPreferenceMigration(): Promise<{
  emptyChain: boolean;
  previousSchemaPreserved: boolean;
  foreignKeyCode: string | null;
  restrictCode: string | null;
  failureCode: string | null;
  failedMigrationAtomic: boolean;
}>;
