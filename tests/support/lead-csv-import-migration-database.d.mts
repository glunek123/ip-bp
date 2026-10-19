export type LeadCsvOwnedResult = {
  schemas: Array<{
    name: string;
    stage: 'passed-retained';
    rows: number;
    digest: string;
  }>;
  publicDigest: string;
  sourceCount: 166;
  groupCount: 176;
  retainedRows: 17;
};
export type LeadCsvBudget = {
  expiresAt: number;
  remaining(): number;
  child(milliseconds: number): LeadCsvBudget;
};
export type LeadCsvQueryResult = { rows: Array<Record<string, unknown>> };
export type LeadCsvSession = {
  connect(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<LeadCsvQueryResult>;
  end(): Promise<void>;
};
export type LeadCsvClientConfig = {
  connectionString: string;
  connectionTimeoutMillis: number;
  statement_timeout: number;
  lock_timeout: number;
  options: string;
};
export type LeadCsvRawClient = LeadCsvSession & {
  on(event: 'error', listener: () => void): unknown;
  connection: { stream: { destroy(): void } };
};
export type LeadCsvOfflinePlan = {
  source: Array<{ name: string; sha256: string; sql: string; parts: string[] }>;
  fixture: Record<string, unknown>;
  objects: Record<string, unknown>;
  fault: string;
};
export function createLeadCsvBudget(options?: {
  milliseconds?: number;
  now?: () => number;
  parent?: { expiresAt: number };
}): LeadCsvBudget;
export function createLeadCsvSession(
  Client: new (config: LeadCsvClientConfig) => LeadCsvRawClient,
  connectionString: string,
  budget: LeadCsvBudget,
  timers?: {
    schedule(callback: () => void, milliseconds: number): unknown;
    cancel(handle: unknown): void;
  },
): LeadCsvSession;
export function captureLeadCsvTarget(
  env: NodeJS.ProcessEnv,
  budget: LeadCsvBudget,
  dependencies?: {
    capture?: (
      root: string,
      options: { pnpmVersion: string },
    ) => {
      childEnvironment: NodeJS.ProcessEnv;
    };
    validate?: (url: string, root: string) => { connectionString: string };
  },
): { url: string; captured: { childEnvironment: NodeJS.ProcessEnv } };
export function withLeadCsvSession<T>(
  session: LeadCsvSession,
  operation: (session: LeadCsvSession) => Promise<T> | T,
): Promise<T>;
export function withLeadCsvTransaction<T>(
  session: LeadCsvSession,
  operation: (session: LeadCsvSession) => Promise<T> | T,
  readOnly?: boolean,
): Promise<T>;
export function withLeadCsvPublicPreservation<T, S = unknown>(
  session: LeadCsvSession,
  operation: () => Promise<T> | T,
  snapshot?: () => Promise<S>,
): Promise<{ before: S; result: T }>;
export function verifyLeadCsvFaultRollback(
  session: LeadCsvSession,
  sql: string,
  verifyRestored: () => Promise<void>,
): Promise<void>;
export function runLeadCsvOwnedScenario(
  session: LeadCsvSession,
  name: string,
  kind: 'empty' | 'upgrade' | 'fault',
  plan: LeadCsvOfflinePlan,
): Promise<LeadCsvOwnedResult['schemas'][number]>;
export function assertLeadCsvR2Binding(env: NodeJS.ProcessEnv): string;
export function assertOwnedSchema(
  name: string,
  nonce: string,
  kind: 'empty' | 'upgrade' | 'fault',
): string;
export function assertFrozenFixture(fixture: Record<string, unknown>): void;
export function injectLeadCsvFault(
  sql: string,
  fault: {
    originalPrefixLengthChars: number;
    injection: string;
    sha256: string;
  },
): string;
export function readLeadCsvOfflinePlan(options?: {
  frozen?: string;
  migrations?: string;
  budget?: LeadCsvBudget;
}): Promise<LeadCsvOfflinePlan>;
export function assertLeadCsvPublicLedger(
  identity: Array<{ db: string; schema: string; username: string }>,
  rows: Array<Record<string, unknown>>,
  source: Array<{ name: string; sha256: string }>,
  receipt: Record<string, unknown>,
): void;
export function verifyLeadCsvOwnedMigration(): Promise<LeadCsvOwnedResult>;
