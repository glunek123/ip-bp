export const externalEntryActionMigration: string;
export const externalEntryFoundationMigration: string;
export const externalEntryNormalGuardMigration: string;
export const oldCaseMigrations: string[];
export interface MigrationClient {
  query(
    query: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
}
export function withCaseExternalEntryMigrationDatabase<T>(
  operation: (client: MigrationClient) => Promise<T>,
): Promise<T>;
export function newCaseExternalEntrySchema(prefix: string): string;
export function createCaseExternalEntrySchema(
  client: MigrationClient,
  schema: string,
): Promise<void>;
export function dropCaseExternalEntrySchema(
  client: MigrationClient,
  schema: string,
): Promise<void>;
export function applyCaseExternalEntryMigration(
  client: MigrationClient,
  name: string,
): Promise<void>;
export function createCaseExternalFactSourceProbe(
  client: MigrationClient,
  schema: string,
): Promise<void>;
export function assertCaseExternalFactSourceProbe(
  client: MigrationClient,
  schema: string,
  caseId: string,
  departmentId: string,
  migrationApplied: boolean,
): Promise<void>;
export function failExternalEntryNormalGuardMigrationAtomically(
  client: MigrationClient,
  schema: string,
): Promise<{
  errorCode: string;
  before: string;
  after: string;
}>;
export function replayOldCaseMigrations(client: MigrationClient): Promise<void>;
export function copyOldCaseSchema(
  client: MigrationClient,
  schema: string,
): Promise<void>;
export function snapshotOldCaseRows(
  client: MigrationClient,
  schema: string,
  caseId: string,
  priorColumns?: Record<string, string[]>,
): Promise<{
  cases: Array<Record<string, unknown>>;
  columnManifest: Record<string, string[]>;
  [table: string]: unknown;
}>;
export function externalEntryActionGrantRows(
  client: MigrationClient,
  schema: string,
): Promise<Record<string, unknown>[]>;
export function assertSqlRejected(
  client: MigrationClient,
  operation: () => Promise<unknown>,
): Promise<void>;
