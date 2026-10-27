export declare function verifyBatch2CaseConsolidationMigration(): Promise<{
  before: number;
  preserved: number;
  tables: number;
  incompleteRoot: string | null;
  childProgress: string | null;
  immutableMember: string | null;
  mainProgress: string | null;
}>;
