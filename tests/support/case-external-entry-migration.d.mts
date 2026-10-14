export const externalEntryActionMigration: string;
export const externalEntryFoundationMigration: string;
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
export function replayOldCaseMigrations(client: MigrationClient): Promise<void>;
export function copyOldCaseSchema(
  client: MigrationClient,
  schema: string,
): Promise<void>;
export function snapshotOldCaseRows(
  client: MigrationClient,
  schema: string,
  caseId: string,
): Promise<{
  cases: Array<Record<string, unknown>>;
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
