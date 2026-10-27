export function beforeFinalCommit(sql: string): string;
export function apply191WithFault(
  client: { query(sql: string): Promise<unknown> },
  sql: string,
  beforeCommit: (client: {
    query(sql: string): Promise<unknown>;
  }) => Promise<void>,
): Promise<void>;
export function cleanupOwned191Schema(
  client: {
    query(sql: string, parameters?: unknown[]): Promise<unknown>;
    end(): Promise<void>;
  },
  schema: string,
  connected: boolean,
  created: boolean,
  primaryError?: Error,
): Promise<void>;
export function verifyBatch2DirectRemandFullChain(): Promise<{
  through: string;
  migrationCount: number;
  baselineTableCount: number;
  faultSqlstate: string;
  oldDefinitionRestored: boolean;
  helperRolledBack: boolean;
  retryInstalled: boolean;
}>;
