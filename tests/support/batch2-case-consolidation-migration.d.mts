export declare function cleanupBatch2CaseConsolidationMigration(
  client: {
    query(
      sql: string,
      values?: unknown[],
    ): Promise<{ rows: { count: number }[] }>;
    end(): Promise<void>;
  },
  schema: string,
  connected: boolean,
  created: boolean,
  primaryError?: unknown,
): Promise<void>;

export declare function verifyBatch2CaseConsolidationMigration(): Promise<{
  before: number;
  preserved: number;
  tables: number;
  incompleteRoot: string | null;
  rootAfterFailed: number;
  incompleteRootRetry: string | null;
  childProgress: string | null;
  immutableMember: string | null;
  mainProgress: string | null;
}>;
