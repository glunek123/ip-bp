export type LeadBatchMigrationSource = Readonly<{
  name: string;
  sql: string;
  sha256: string;
}>;

export type LeadBatchMigrationSnapshot = Readonly<{
  relations: ReadonlyArray<Record<string, unknown>>;
  columns: ReadonlyArray<Record<string, unknown>>;
  constraints: ReadonlyArray<Record<string, unknown>>;
  functions: ReadonlyArray<Record<string, unknown>>;
  triggers: ReadonlyArray<Record<string, unknown>>;
  indexes: ReadonlyArray<Record<string, unknown>>;
  types: ReadonlyArray<Record<string, unknown>>;
  enums: ReadonlyArray<Record<string, unknown>>;
  sequences: ReadonlyArray<Record<string, unknown>>;
  schema: Record<string, unknown> | null;
  acls: ReadonlyArray<Record<string, unknown>>;
  data: ReadonlyArray<{ table: string; count: number; sha256: string }>;
}>;

export function admitLeadBatchPushMigration(
  environment: NodeJS.ProcessEnv,
): Readonly<{
  connectionString: string;
  tuple: Readonly<Record<string, string | number>>;
  pnpmVersion: string;
}>;
export function assertMigrationIsolation(sql: string): void;
export function leadBatchPushMigrationPlan(
  directory?: string,
): Promise<LeadBatchMigrationSource[]>;
export function ownedLeadBatchSchema(nonce: string, kind: string): string;
export function assertOwnedLeadBatchSchema(
  name: string,
  nonce: string,
  created: ReadonlySet<string>,
  actualComment: string | null,
  expectedComment: string,
): void;
export function injectLeadBatchMigrationFailure(sql: string): string;
export function splitLeadBatchMigrationPrelude(
  entry: LeadBatchMigrationSource,
): string[];
export function snapshotDigest(snapshot: LeadBatchMigrationSnapshot): string;
export function assertLeadBatchMigrationFailure(error: unknown): void;
export function assertPublicPredecessorLedger(
  rows: ReadonlyArray<{
    migration_name: string;
    checksum: string;
    finished_at: unknown;
    rolled_back_at: unknown;
  }>,
  plan: ReadonlyArray<LeadBatchMigrationSource>,
): void;
export function assertPreservedPredecessor(
  before: LeadBatchMigrationSnapshot,
  after: LeadBatchMigrationSnapshot,
): void;
export function verifyLeadBatchPushMigration(
  report?: (result: Record<string, unknown>) => void | Promise<void>,
): Promise<Record<string, unknown>>;
